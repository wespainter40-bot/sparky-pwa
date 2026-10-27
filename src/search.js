// Free, no-key lookup tool: DuckDuckGo Instant Answer, then Wikipedia.
const LOOKUP_RE =
  /^(who|what|when|where|which|why|how (many|much|tall|far|old|big|long|fast|high|deep|hot|cold|heavy))\b|\b(tell me about|look ?up|search for|capital of|facts? about|latest|news|meaning of|define|definition of)\b/i;
const PERSONAL_RE = /\b(you|your|yours|sparky|me|my|i)\b/i;
const LEAD_RE =
  /^(please\s+)?(can you\s+)?(tell me about|look ?up|search for|who (is|was|are|were)|what (is|are|was|were)|what's|who's|where (is|are)|when (is|was|did)|how (many|much|tall|far|old|big|long|fast|high|deep|hot|cold|heavy)( is| are| was| do| does)?|why (is|are|do|does)|which)\s+/i;

export function looksLikeLookup(text) {
  const t = text.trim();
  if (t.split(/\s+/).length < 3 || t.length > 160) return false;
  return LOOKUP_RE.test(t) && !PERSONAL_RE.test(t);
}

export function toQuery(text) {
  return text
    .trim()
    .replace(LEAD_RE, '')
    .replace(/^(a|an|the)\s+/i, '')
    .replace(/[?!.]+$/, '')
    .trim();
}

async function getJson(url, ms = 2400) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(ms),
    headers: { 'user-agent': 'SparkyKidAssistant/1.0 (personal project)' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function duckDuckGo(q) {
  const j = await getJson(
    `https://api.duckduckgo.com/?q=${encodeURIComponent(q)}&format=json&no_html=1&skip_disambig=1&no_redirect=1`
  );
  const text = j.Answer || j.AbstractText || j.Definition;
  if (!text) return null;
  return { source: 'DuckDuckGo', title: j.Heading || q, text: String(text).slice(0, 900), url: j.AbstractURL || '' };
}

async function wikipedia(q) {
  const j = await getJson(
    'https://en.wikipedia.org/w/api.php?action=query&format=json&origin=*&generator=search&gsrlimit=1' +
      `&gsrsearch=${encodeURIComponent(q)}&prop=extracts&exintro=1&explaintext=1&exsentences=4`
  );
  const page = Object.values(j.query?.pages || {})[0];
  if (!page?.extract) return null;
  return {
    source: 'Wikipedia',
    title: page.title,
    text: page.extract.slice(0, 900),
    url: `https://en.wikipedia.org/?curid=${page.pageid}`,
  };
}

/** Returns {source,title,text,url} or null. Never throws. Both sources are asked at once and the whole lookup is capped at `capMs`
 *  (a slow lookup must never hold up the spoken answer). DuckDuckGo wins if both answer. */
export async function lookup(text, capMs = 2500) {
  if (!looksLikeLookup(text)) return null;
  const q = toQuery(text);
  if (!q) return null;
  const ask = (fn) => fn(q).catch((e) => { console.warn(`[search] ${fn.name} failed: ${e.message}`); return null; });
  const both = Promise.all([ask(duckDuckGo), ask(wikipedia)]).then(([d, w]) => d || w || null);
  const cap = new Promise((r) => setTimeout(() => r(null), capMs));
  return Promise.race([both, cap]);
}
