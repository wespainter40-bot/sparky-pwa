// Favorite topics: simple keyword / short-phrase frequency across what the user asked, kept only on this device.
// Pin a topic to keep it on top, hide one so Sparky never brings it up, rename or delete any of them.
import { load, save } from './store.js';
import { cleanFact } from './memory.js';
export const KEY = 'sparky.topics.v1';
const MAX = 60, MIN_FAVORITE = 2;

const STOP = new Set(`a about above after again all also am an and any are aren't as at be because been before being below between both but by can can't could did do does doing don't down during each few for from further get gets give go going good got had has have having he her here hers him his how i i'm if in into is isn't it it's its just know let's like little look lot make many may me more most much my myself need new no nor not now of off oh ok okay on once one only or other our out over own please really right said same say see she should so some something such tell than that the their them then there these they thing things think this those through to too under until up us use very want was we were what what's when where which while who whom why will with won't would yes yeah you your yours love loves loved likes liked hate hates hey hi hello thanks thank sparky more another fact facts story stories favorite favourite cool fun awesome wow tell talk today tomorrow yesterday name`.split(/\s+/));
const GENERIC = new Set(['hear', 'told', 'ask', 'asked', 'answer', 'question', 'questions', 'word', 'words', 'time', 'times', 'kind', 'kinds', 'part', 'way', 'ways', 'example', 'idea', 'ideas', 'long', 'big', 'small', 'lot', 'lots', 'best', 'play', 'help', 'real', 'mean', 'means', 'called', 'name', 'make', 'made', 'work', 'works', 'come', 'comes', 'find', 'found', 'does', 'much', 'many', 'live', 'lives', 'take', 'takes', 'show', 'explain', 'describe', 'learn', 'teach', 'story']);

let data = { items: {}, bf: 0 };   // bf: history was already scanned once (so 'Forget everything' stays forgotten)
const norm = (d) => {
  const out = { items: {}, bf: d?.bf ? 1 : 0 };
  for (const [k, v] of Object.entries(d?.items || {})) {
    const w = clean(k);
    if (w && v && typeof v === 'object') out.items[w] = { n: Math.max(0, Math.min(9999, +v.n | 0)), last: +v.last || 0, pinned: !!v.pinned, hidden: !!v.hidden, form: clean(v.form) || w };
  }
  return out;
};
export function clean(t) {
  if (!cleanFact(t)) return '';        // links, long numbers, instructions...: judged on the raw text
  t = String(t || '').toLowerCase().replace(/[^\p{L}' -]/gu, ' ').replace(/\s+/g, ' ').trim();
  if (!/^[\p{L}][\p{L}' -]{2,29}$/u.test(t)) return '';
  return cleanFact(t) ? t : '';
}
data = norm(load(KEY, {}));
const persist = () => save(KEY, data);
const stem = (w) => (w.length > 4 && w.endsWith('ies') ? w.slice(0, -3) + 'y' : w.length > 4 && w.endsWith('s') && !w.endsWith('ss') && !w.endsWith('us') ? w.slice(0, -1) : w);

/** candidate topics in one message: single keywords and two-word phrases made of adjacent keywords */
export function extract(text, skip = []) {
  const toks = String(text || '').toLowerCase().replace(/[^\p{L}' ]/gu, ' ').split(/\s+/).filter(Boolean);
  const skipSet = new Set(skip.map((x) => String(x).toLowerCase()));
  const keep = (w) => w.length >= 4 && !STOP.has(w) && !GENERIC.has(w) && !skipSet.has(w) && !/^'|'$/.test(w) && !STOP.has(stem(w));
  const out = new Map();   // key (stemmed) -> surface form as the user wrote it ("dinosaur" -> "dinosaurs")
  for (let i = 0; i < toks.length; i++) {
    const w = toks[i];
    if (!keep(w)) continue;
    out.set(stem(w), w);
    const nx = toks[i + 1];
    if (nx && keep(nx)) out.set(`${w} ${stem(nx)}`, `${w} ${nx}`);
  }
  return out;
}
export function learn(text, skip = []) {
  const now = Date.now();
  for (const [raw, form] of extract(text, skip)) {
    const w = clean(raw); if (!w) continue;
    const it = data.items[w] || (data.items[w] = { n: 0, last: 0, pinned: false, hidden: false });
    it.n++; it.last = now; it.form = clean(form) || w;
  }
  prune(); persist();
}
function prune() {
  const keys = Object.keys(data.items);
  if (keys.length <= MAX) return;
  keys.filter((k) => !data.items[k].pinned && !data.items[k].hidden)
    .sort((a, b) => data.items[a].n - data.items[b].n || data.items[a].last - data.items[b].last)
    .slice(0, keys.length - MAX).forEach((k) => delete data.items[k]);
}
/** first-run: derive topics from conversations already on this device. msgs: array of strings (user messages) */
export function backfill(msgs, skip = []) { if (data.bf || Object.keys(data.items).length) return; for (const m of msgs) learn(m, skip); data.bf = 1; persist(); }
export const hasData = () => Object.keys(data.items).length > 0;
/** every tracked word, including one-offs (tests / debugging) */
export const all = () => Object.entries(data.items).map(([t, v]) => ({ t, ...v }));

const rank = (a, b) => (b.pinned - a.pinned) || (b.n - a.n) || (b.last - a.last);
/** topics for the settings list: favorites (mentioned twice or more), pinned and hidden ones. Pinned first, hidden last. */
export function list() {
  return Object.entries(data.items).map(([t, v]) => ({ t, ...v })).filter((x) => x.pinned || x.hidden || x.n >= MIN_FAVORITE).sort((a, b) => (a.hidden - b.hidden) || rank(a, b));
}
/** favorites: visible topics that are pinned or mentioned at least twice. A phrase hides a single word with the same count that it contains. */
export function top(k = 3) {
  const c = list().filter((x) => !x.hidden && (x.pinned || x.n >= MIN_FAVORITE));
  const out = [];
  for (const x of c) {
    const words = x.t.split(' ');
    if (out.some((y) => (y.t.includes(x.t) || x.t.includes(y.t)) && !x.pinned && Math.abs(y.n - x.n) <= 1)) continue;
    if (words.length === 1 && c.some((y) => y !== x && y.t.split(' ').length > 1 && y.t.split(' ').includes(x.t) && y.n >= x.n && !y.hidden)) continue;
    out.push(x);
    if (out.length >= k) break;
  }
  return out;
}
export const payload = (k = 3) => top(k).map((x) => x.t);
export function rename(t, to) {
  const n = clean(to), it = data.items[t];
  if (!it || !n || n === t) return false;
  const ex = data.items[n];
  data.items[n] = ex ? { n: ex.n + it.n, last: Math.max(ex.last, it.last), pinned: ex.pinned || it.pinned, hidden: ex.hidden || it.hidden, form: n } : { ...it, form: n };
  delete data.items[t]; persist(); return true;
}
export function toggle(t, key) { const it = data.items[t]; if (it) { it[key] = !it[key]; if (key === 'pinned' && it.pinned) it.hidden = false; if (key === 'hidden' && it.hidden) it.pinned = false; persist(); } }
export function remove(t) { delete data.items[t]; persist(); }
export function forgetAll() { data = { items: {}, bf: 1 }; persist(); }

const ASKS = [
  (t) => `Want to hear a fun fact about ${t}?`,
  (t) => `Should we talk about ${t} again?`,
  (t) => `Ask me something new about ${t}!`,
  (t) => `Ready for more ${t}?`,
];
let ai = Math.floor(Math.random() * ASKS.length);
/** a friendly suggestion from the best topic, or null. Tapping it sends `send` (it is never sent by itself). */
export function suggestion() {
  const [first] = top(1);
  if (!first) return null;
  const t = first.form || first.t;
  ai = (ai + 1) % ASKS.length;
  return { topic: first.t, text: ASKS[ai](t), send: `Tell me something new and fun about ${t}!` };
}
