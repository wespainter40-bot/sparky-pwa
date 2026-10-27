// Per-device chat history (localStorage). The server keeps logging sessions as before; this copy is the reliable one on ephemeral hosting.
import { load, save } from './store.js';
export const KEY = 'sparky.history.v1';
const MAX_CONVOS = 100, MAX_MSGS = 200, MAX_TEXT = 2000;
let list = load(KEY, []);
if (!Array.isArray(list)) list = [];
const persist = () => {
  while (!save(KEY, list) && list.length > 1) list.pop(); // storage full: drop the oldest until it fits
};
export const all = () => list.slice().sort((a, b) => b.updated - a.updated);
export const get = (id) => list.find((c) => c.id === id) || null;
export function add(id, role, text) {
  text = String(text || '').trim().slice(0, MAX_TEXT);
  if (!id || !text) return;
  let c = get(id);
  if (!c) { c = { id, started: Date.now(), updated: Date.now(), msgs: [] }; list.push(c); }
  c.msgs.push({ r: role === 'user' ? 'u' : 's', t: text, ts: Date.now() });
  if (c.msgs.length > MAX_MSGS) c.msgs.splice(0, c.msgs.length - MAX_MSGS);
  c.updated = Date.now();
  if (list.length > MAX_CONVOS) { list.sort((a, b) => b.updated - a.updated); list.length = MAX_CONVOS; }
  persist();
}
export const title = (c) => {
  const m = c.msgs.find((x) => x.r === 'u');
  const t = (m ? m.t : (c.msgs[0]?.t || 'New chat')).replace(/\s+/g, ' ');
  return t.length > 60 ? t.slice(0, 57) + '...' : t;
};
export const remove = (id) => { list = list.filter((c) => c.id !== id); persist(); };
export const clear = () => { list = []; persist(); };
export function search(q) {
  q = String(q || '').trim().toLowerCase();
  const a = all();
  return q ? a.filter((c) => c.msgs.some((m) => m.t.toLowerCase().includes(q))) : a;
}
export function when(ts) {
  const d = new Date(ts), now = new Date(), same = d.toDateString() === now.toDateString();
  const y = new Date(now - 864e5).toDateString() === d.toDateString();
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return same ? `Today, ${time}` : y ? `Yesterday, ${time}` : `${d.toLocaleDateString([], { month: 'short', day: 'numeric', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' })}, ${time}`;
}
