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

async function getJson(url, ms = 1100) {
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

// Circuit breaker for DuckDuckGo: it times out from Render most of the time, so after 2 failures in a row it is skipped for 10 minutes.
export const LOOKUP_CAP_MS = 1200;
const BREAKER = { fails: 0, until: 0, threshold: 2, pauseMs: 10 * 60 * 1000 };
export const breakerState = () => ({ fails: BREAKER.fails, open: Date.now() < BREAKER.until, until: BREAKER.until });
export const resetBreaker = () => { BREAKER.fails = 0; BREAKER.until = 0; };
const SOURCES = { duckDuckGo, wikipedia };
export const _setSources = (o) => { Object.assign(SOURCES, o); };   // tests only

/** Returns {source,title,text,url} or null. Never throws. Wikipedia and DuckDuckGo are asked at once; the first one with a useful answer
 *  wins (the slower one is not waited for) and the whole lookup is capped at `capMs`, so a slow lookup never holds up the spoken answer.
 *  DuckDuckGo is skipped while its breaker is open. */
export async function lookup(text, capMs = LOOKUP_CAP_MS) {
  if (!looksLikeLookup(text)) return null;
  const q = toQuery(text);
  if (!q) return null;
  const useDdg = Date.now() >= BREAKER.until;
  return new Promise((resolve) => {
    let pending = 0, done = false, timer;
    const finish = (v) => { if (done) return; done = true; clearTimeout(timer); resolve(v); };
    const run = (name, isDdg) => {
      pending++;
      Promise.resolve().then(() => SOURCES[name](q)).then(
        (r) => {
          if (isDdg) BREAKER.fails = 0;
          if (r) finish(r); else if (--pending === 0) finish(null);
        },
        (e) => {
          console.warn(`[search] ${name} failed: ${e.message}`);
          if (isDdg && ++BREAKER.fails >= BREAKER.threshold && Date.now() >= BREAKER.until) {
            BREAKER.until = Date.now() + BREAKER.pauseMs;
            console.warn(`[search] duckDuckGo failed ${BREAKER.fails}x in a row: skipping it for ${BREAKER.pauseMs / 60000} min`);
          }
          if (--pending === 0) finish(null);
        });
    };
    run('wikipedia', false);
    if (useDdg) run('duckDuckGo', true);
    timer = setTimeout(() => finish(null), capMs);
  });
}
