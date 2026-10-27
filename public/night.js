// Night light: a very dim, warm, blue-free look for bedtime / dark rooms. Overrides every theme + accent (it is not a theme itself).
// Settings live in localStorage; "auto" switches it on between two hours of the day.
import { load, save } from './store.js';
export const KEY = 'sparky.night.v1';
export const DEFAULT = { on: false, auto: false, from: 20, to: 7 };
export const META = '#0a0402';
export const VOLUME = 0.6;
export function settings() {
  const s = { ...DEFAULT, ...load(KEY, {}) };
  s.on = !!s.on; s.auto = !!s.auto;
  s.from = hour(s.from, DEFAULT.from); s.to = hour(s.to, DEFAULT.to);
  return s;
}
const hour = (v, d) => (Number.isInteger(+v) && +v >= 0 && +v <= 23 ? +v : d);
export function set(patch) { const s = { ...settings(), ...patch }; save(KEY, s); return settings(); }
/** is hour h inside the [from, to) window (the window may wrap past midnight) */
export function inWindow(h, from, to) { return from === to ? false : from < to ? h >= from && h < to : h >= from || h < to; }
export function active(now = new Date()) { const s = settings(); return s.on || (s.auto && inWindow(now.getHours(), s.from, s.to)); }
export const hourLabel = (h) => `${h % 12 || 12} ${h < 12 ? 'AM' : 'PM'}`;
