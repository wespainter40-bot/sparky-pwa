// Provider chain: Groq -> OpenRouter -> custom OpenAI-compatible -> Pollinations (no key) -> local canned reply.
// Add a provider by pushing another openAICompatible({...}) entry into `chain`.
const env = process.env;

function openAICompatible({ name, url, key, model, headers = {}, firstTokenMs = 12000 }) {
  return {
    name,
    model,
    async *stream(messages) {
      const ctrl = new AbortController();
      let timer = setTimeout(() => ctrl.abort(), firstTokenMs);
      try {
        const res = await fetch(url, {
          method: 'POST',
          signal: ctrl.signal,
          headers: { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}), ...headers },
          body: JSON.stringify({ model, messages, stream: true, max_tokens: 350, temperature: 0.7 }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        // Some servers ignore stream:true and answer with plain JSON.
        if (!(res.headers.get('content-type') || '').includes('text/event-stream')) {
          const j = await res.json();
          const text = j.choices?.[0]?.message?.content;
          if (text) yield text;
          return;
        }

        const decoder = new TextDecoder();
        let buf = '';
        for await (const chunk of res.body) {
          clearTimeout(timer);
          timer = setTimeout(() => ctrl.abort(), 15000); // idle timeout between chunks
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
              if (t) yield t;
            } catch { /* ignore keep-alives / partial JSON */ }
          }
        }
      } finally {
        clearTimeout(timer);
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
    url: 'https://text.pollinations.ai/openai',
    model: env.POLLINATIONS_MODEL || 'openai',
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
export async function* streamReply(messages) {
  let tried = 0;
  for (const p of chain) {
    let started = false;
    if (tried++) yield { type: 'status', stage: 'fallback', provider: p.name }; // previous provider failed: trying the next one
    try {
      for await (const text of p.stream(messages)) {
        if (!started) { started = true; yield { type: 'meta', provider: p.name, model: p.model }; }
        yield { type: 'token', text };
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
