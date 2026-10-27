// Theme (dark / OLED / light) + accent colour. Persisted per device; recolours the UI through CSS variables and the orb through orb.setAccent().
import { load, save } from './store.js';
export const KEY = 'sparky.theme.v1';
export const MODES = {
  dark: { label: 'Dark', meta: '#07090a' },
  oled: { label: 'OLED black', meta: '#000000' },
  light: { label: 'Light', meta: '#eaf3ee' },
};
export const ACCENTS = {
  emerald: { label: 'Emerald', hex: '#00C853', rgb: '0,200,83', lite: '#5cf2a0', liteRgb: '92,242,160', deep: '#00a846' },
  blue: { label: 'Electric blue', hex: '#2D8CFF', rgb: '45,140,255', lite: '#8cc4ff', liteRgb: '140,196,255', deep: '#1a6fe0' },
  violet: { label: 'Violet', hex: '#8B5CF6', rgb: '139,92,246', lite: '#c4aaff', liteRgb: '196,170,255', deep: '#6d3fe0' },
  orange: { label: 'Sunset orange', hex: '#FF7A1A', rgb: '255,122,26', lite: '#ffb27a', liteRgb: '255,178,122', deep: '#e05f00' },
  pink: { label: 'Hot pink', hex: '#FF2D95', rgb: '255,45,149', lite: '#ff9ccc', liteRgb: '255,156,204', deep: '#d6176f' },
};
export const DEFAULT = { mode: 'dark', accent: 'emerald' };
const darkDeep = { emerald: '#00a846', blue: '#1a6fe0', violet: '#6d3fe0', orange: '#e05f00', pink: '#d6176f' };

export function current() {
  const t = { ...DEFAULT, ...load(KEY, {}) };
  if (!MODES[t.mode]) t.mode = DEFAULT.mode;
  if (!ACCENTS[t.accent]) t.accent = DEFAULT.accent;
  return t;
}
/** apply to the page; orb is optional (set after it exists) */
export function apply(t, orb) {
  const a = ACCENTS[t.accent], root = document.documentElement, light = t.mode === 'light';
  root.dataset.theme = t.mode; root.dataset.accent = t.accent;
  root.style.setProperty('--ac', a.rgb);
  root.style.setProperty('--ac2', light ? hexToRgb(a.deep) : a.liteRgb);
  root.style.setProperty('--green', light ? a.deep : a.hex);
  root.style.setProperty('--green-2', light ? a.deep : a.lite);
  root.style.setProperty('--green-d', darkDeep[t.accent]);
  let m = document.querySelector('meta[name="theme-color"]');
  if (!m) { m = document.createElement('meta'); m.name = 'theme-color'; document.head.append(m); }
  m.content = MODES[t.mode].meta;
  if (orb) orb.setAccent(t.accent);
}
export function set(patch, orb) {
  const t = { ...current(), ...patch };
  save(KEY, t); apply(t, orb); return t;
}
function hexToRgb(h) { const n = parseInt(h.slice(1), 16); return `${n >> 16},${(n >> 8) & 255},${n & 255}`; }
