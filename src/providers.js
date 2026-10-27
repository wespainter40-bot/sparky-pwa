// Provider chain: Groq -> OpenRouter -> custom OpenAI-compatible -> Pollinations (no key) -> local canned reply.
// Add a provider by pushing another openAICompatible({...}) entry into `chain`.
const env = process.env;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class HttpError extends Error { constructor(status, retryAfter) { super(`HTTP ${status}`); this.status = status; this.retryAfter = retryAfter; } }

// Streams plain text pieces. A "reasoning" model (Pollinations' default) first streams `delta.reasoning` for a while: those chunks are
// NOT answer text, so the first-token timer keeps running until real `delta.content` arrives. A 429/5xx/timeout gets one quick retry
// (`attempts`), and a provider that yields {status:'retry'} lets the caller tell the user.
function openAICompatible({ name, url, key, model, headers = {}, firstTokenMs = 5500, retryTokenMs = 4500, attempts = 1, extraBody = {} }) {
  async function* once(messages, opts, firstMs, state) {
    const ctrl = new AbortController();
    let timer = setTimeout(() => ctrl.abort(), firstMs);
    try {
      const res = await fetch(url, {
        method: 'POST',
        signal: ctrl.signal,
        headers: { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}), ...headers },
        body: JSON.stringify({ model, messages, stream: true, max_tokens: opts.maxTokens || 350, temperature: 0.7, ...extraBody }),
      });
      if (!res.ok) throw new HttpError(res.status, Number(res.headers.get('retry-after')) || 0);

      // Some servers ignore stream:true and answer with plain JSON.
      if (!(res.headers.get('content-type') || '').includes('text/event-stream')) {
        const j = await res.json();
        const text = j.choices?.[0]?.message?.content;
        if (text) { state.started = true; yield text; }
        return;
      }

      const decoder = new TextDecoder();
      let buf = '';
      for await (const chunk of res.body) {
        buf += decoder.decode(chunk, { stream: true });
        let nl;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (data === '[DONE]') return;
          try {
            const t = JSON.parse(data).choices?.[0]?.delta?.content;
            if (t) {
              state.started = true;
              clearTimeout(timer); timer = setTimeout(() => ctrl.abort(), 12000); // idle timeout between answer chunks
              yield t;
            }
          } catch { /* ignore keep-alives / partial JSON */ }
        }
      }
    } finally {
      clearTimeout(timer);
    }
  }
  return {
    name,
    model,
    async *stream(messages, opts = {}) {
      for (let attempt = 1; ; attempt++) {
        const state = { started: false };
        try {
          yield* once(messages, opts, attempt === 1 ? firstTokenMs : retryTokenMs, state);
          return;
        } catch (e) {
          const retryable = e instanceof HttpError ? (e.status === 429 || e.status >= 500) : (e.name === 'AbortError' || e.name === 'TimeoutError' || /abort|fetch failed|terminated/i.test(e.message));
          if (state.started || attempt >= attempts || !retryable) throw e;
          console.warn(`[llm] ${name} attempt ${attempt} failed (${e.message}), retrying`);
          yield { status: 'retry' };
          await sleep(Math.min(2000, (e.retryAfter || 0) * 1000 || 600));
        }
      }
    },
  };
}

export function buildChain() {
  const chain = [];
  if (env.GROQ_API_KEY)
    chain.push(openAICompatible({
      name: 'groq',
      url: 'https://api.groq.com/openai/v1/chat/completions',
      key: env.GROQ_API_KEY,
      model: env.GROQ_MODEL || 'llama-3.1-8b-instant',
    }));
  if (env.OPENROUTER_API_KEY)
    chain.push(openAICompatible({
      name: 'openrouter',
      url: 'https://openrouter.ai/api/v1/chat/completions',
      key: env.OPENROUTER_API_KEY,
      model: env.OPENROUTER_MODEL || 'meta-llama/llama-3.3-70b-instruct:free',
      headers: { 'HTTP-Referer': 'https://github.com/sparky-app', 'X-Title': 'Sparky' },
    }));
  if (env.CUSTOM_BASE_URL && env.CUSTOM_MODEL)
    chain.push(openAICompatible({
      name: 'custom',
      url: env.CUSTOM_BASE_URL.replace(/\/+$/, '') + '/chat/completions',
      key: env.CUSTOM_API_KEY,
      model: env.CUSTOM_MODEL,
    }));
  chain.push(openAICompatible({
    name: 'pollinations',
    url: env.POLLINATIONS_URL || 'https://text.pollinations.ai/openai',
    model: env.POLLINATIONS_MODEL || 'openai',
    attempts: 2,                               // the free anonymous tier answers 429 / stalls now and then: one quick retry
    extraBody: { reasoning_effort: 'low' },    // its default model is a reasoning model; 'low' cuts the silent thinking time a lot
  }));
  return chain;
}

const chain = buildChain();
export const providerNames = () => [...chain.map((p) => p.name), 'local'];

const LOCAL_REPLIES = [
  "Oh no, my thinking-wires got a little tangled! Can you ask me again in a moment?",
  "Zzzap! My brain can't reach the internet right now. Let's try again soon!",
  "My energy core needs a tiny recharge. Ask me again in a few seconds!",
];
function localReply(userText) {
  if (/\b(hi|hello|hey)\b/i.test(userText)) return "Hi there! I'm Sparky. My big brain is warming up, so ask me again in a moment!";
  return LOCAL_REPLIES[Math.floor(Math.random() * LOCAL_REPLIES.length)];
}

/**
 * Yields {type:'meta', provider} once, then {type:'token', text} pieces.
 * Falls through the chain until one provider produces output.
 */
export async function* streamReply(messages, opts = {}) {
  let tried = 0;
  for (const p of chain) {
    let started = false;
    if (tried++) yield { type: 'status', stage: 'fallback', provider: p.name }; // previous provider failed: trying the next one
    try {
      for await (const item of p.stream(messages, opts)) {
        if (typeof item === 'object') { yield { type: 'status', stage: item.status, provider: p.name }; continue; }
        if (!started) { started = true; yield { type: 'meta', provider: p.name, model: p.model }; }
        yield { type: 'token', text: item };
      }
      if (started) return;
    } catch (e) {
      console.warn(`[llm] ${p.name} failed: ${e.message}`);
      if (started) return; // already sent partial text; keep it rather than switching mid-answer
    }
  }
  const last = [...messages].reverse().find((m) => m.role === 'user');
  yield { type: 'status', stage: 'fallback', provider: 'local' };
  yield { type: 'meta', provider: 'local' };
  yield { type: 'token', text: localReply(last?.content || '') };
}
