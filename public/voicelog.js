// Tiny ring buffer of voice events (mic, recognizer, wake word, speech output, latency) for the Voice diagnostics panel.
const MAX = 10;
let list = [];
const subs = new Set();
let last = { error: null, heard: '', firstWordMs: null, firstTokenMs: null };
export const events = () => list.slice();
export const lastInfo = () => ({ ...last });
export const onChange = (f) => subs.add(f);
/** kind: 'mic' | 'listen' | 'wake' | 'tts' | 'net'; level: 'info' | 'warn' | 'error' */
export function log(kind, msg, level = 'info') {
  list.push({ t: Date.now(), kind, msg: String(msg).slice(0, 160), level });
  if (list.length > MAX) list.shift();
  if (level === 'error') last.error = { t: Date.now(), kind, msg: String(msg).slice(0, 160) };
  subs.forEach((f) => f());
}
export function note(patch) { Object.assign(last, patch); subs.forEach((f) => f()); }
export const clear = () => { list = []; last = { error: null, heard: '', firstWordMs: null, firstTokenMs: null }; subs.forEach((f) => f()); };
export const clock = (t) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });
export const asText = () => list.map((e) => `${clock(e.t)} [${e.kind}${e.level === 'info' ? '' : ' ' + e.level}] ${e.msg}`).join('\n');
