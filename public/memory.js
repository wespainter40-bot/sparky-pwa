// "What Sparky knows about you": a few short facts, kept only on this device and sent (sanitized) with each chat.
import { load, save, drop } from './store.js';
export const KEY = 'sparky.memory.v1';
const MAX_ITEMS = 30, MAX_LEN = 80;

// anything that looks like contact details, links, or instructions to the AI never gets stored
const BAD = /https?:|www\.|@|\d{4,}|\b(ignore|disregard|forget (all|previous)|system prompt|instruction|you are now|pretend|jailbreak|developer mode|override|act as|password|address|street|phone)\b/i;
let data = { name: '', items: [] };
function normalize(d) {
  const out = { name: '', items: [] };
  if (d && typeof d === 'object') {
    out.name = cleanName(d.name);
    if (Array.isArray(d.items)) for (const it of d.items) {
      const t = cleanFact(it?.text);
      if (t && !out.items.some((x) => x.text.toLowerCase() === t.toLowerCase())) out.items.push({ id: String(it.id || rid()), text: t });
    }
  }
  out.items = out.items.slice(0, MAX_ITEMS);
  return out;
}
const rid = () => Math.random().toString(36).slice(2, 9);
export function cleanName(n) {
  n = String(n || '').trim().replace(/\s+/g, ' ');
  if (!/^[\p{L}][\p{L}'-]{0,19}$/u.test(n) || BAD.test(n)) return '';
  return n[0].toUpperCase() + n.slice(1);
}
export function cleanFact(t) {
  t = String(t || '').replace(/[<>{}\[\]`\n\r]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_LEN);
  if (t.length < 3 || BAD.test(t)) return '';
  return t;
}
data = normalize(load(KEY, {}));
export const get = () => data;
const persist = () => save(KEY, data);
export function setName(n) { data.name = cleanName(n); persist(); return data.name; }
export function add(text) {
  const t = cleanFact(text);
  if (!t || data.items.some((x) => x.text.toLowerCase() === t.toLowerCase())) return null;
  if (data.items.length >= MAX_ITEMS) data.items.shift();
  const it = { id: rid(), text: t }; data.items.push(it); persist(); return it;
}
export function update(id, text) {
  const it = data.items.find((x) => x.id === id), t = cleanFact(text);
  if (it && t) { it.text = t; persist(); }
}
export function remove(id) { data.items = data.items.filter((x) => x.id !== id); persist(); }
export function forgetAll() { data = { name: '', items: [] }; drop(KEY); }
export const isEmpty = () => !data.name && !data.items.length;
/** compact payload for the server (the server sanitizes again) */
export const payload = () => (isEmpty() ? null : { name: data.name, items: data.items.map((x) => x.text) });

const STOP = new Set(['a', 'an', 'the', 'not', 'so', 'very', 'really', 'just', 'you', 'it', 'that', 'this', 'to', 'and', 'but', 'with', 'my', 'your', 'when', 'if', 'what', 'how']);
const trimFact = (s) => s.replace(/\s+(because|but|and i|so|when|if|cause)\b.*$/i, '').replace(/[.!?,;:]+$/g, '').trim();
/** simple client-side pattern matching on what the user said. Returns { name?, added: [text] } */
export function learn(text) {
  const res = { name: null, added: [] };
  const t = ' ' + String(text || '').replace(/\s+/g, ' ').trim() + ' ';
  let m;
  if ((m = /\b(?:my name is|my name's|call me|you can call me|i am called|i'm called|everyone calls me)\s+([A-Za-z][A-Za-z'-]{1,19})\b/i.exec(t)) && !STOP.has(m[1].toLowerCase())) {
    const n = cleanName(m[1]); if (n && n !== data.name) { setName(n); res.name = n; }
  }
  const tryAdd = (fact) => { const it = add(fact); if (it) res.added.push(it.text); };
  const likeRe = /\bi (?:really |just |also |absolutely )?(like|love|enjoy|adore)\s+([^.!?,;]{2,40})/ig;
  while ((m = likeRe.exec(t))) {
    const what = trimFact(m[2]);
    const first = what.split(' ')[0].toLowerCase();
    if (what.length < 2 || STOP.has(first) && first !== 'the' && first !== 'my' || /^(to ask|asking|talking|you)\b/i.test(what)) continue;
    tryAdd(`${/love/i.test(m[1]) ? 'loves' : 'likes'} ${what}`);
  }
  const notRe = /\bi (?:really )?(?:don't|do not|dont|hate|dislike)\s+(?:like\s+)?([^.!?,;]{2,40})/ig;
  while ((m = notRe.exec(t))) { const what = trimFact(m[1]); if (what.length > 2 && !STOP.has(what.split(' ')[0].toLowerCase())) tryAdd(`doesn't like ${what}`); }
  const favRe = /\bmy fav(?:ou?rite)?\s+([a-z ]{2,20}?)\s+(?:is|are)\s+([^.!?,;]{2,40})/ig;
  while ((m = favRe.exec(t))) tryAdd(`favorite ${m[1].trim()} is ${trimFact(m[2])}`);
  if (/\b(?:short|shorter|brief|quick)\s+(?:answers?|replies)\b/i.test(t) && /\b(like|want|prefer|please|give|use|keep)\b/i.test(t)) tryAdd('likes short answers');
  if (/\b(?:long|longer|detailed|more detail)\s+(?:answers?|replies|explanations?)\b/i.test(t) && /\b(like|want|prefer|please|give|use)\b/i.test(t)) tryAdd('likes longer, more detailed answers');
  return res;
}
