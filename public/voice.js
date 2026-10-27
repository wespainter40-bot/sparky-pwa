// Voice picker logic: device voice list (async-safe), friendly names, personas, saved settings (sparky.voice.v1).
import { load, save, drop } from './store.js';
export const KEY = 'sparky.voice.v1';
export const DEFAULTS = { voiceURI: '', pitch: 1.15, rate: 1, persona: 'friendly', volume: 1, lang: '' };   // lang '' = the device language
export const LIMITS = { pitch: [0.5, 2], rate: [0.6, 1.6], volume: [0.2, 1] };
export const LANGS = [['', 'Automatic (device language)'], ['en-US', 'English (United States)'], ['en-GB', 'English (United Kingdom)'], ['en-AU', 'English (Australia)'], ['en-CA', 'English (Canada)'], ['en-IN', 'English (India)'], ['es-US', 'Spanish (United States)'], ['es-ES', 'Spanish (Spain)'], ['fr-FR', 'French'], ['de-DE', 'German']];
export const PERSONAS = [
  { id: 'friendly', label: 'Friendly Sparky', icon: '😊', note: 'Bright and cheerful', pitch: 1.15, rate: 1.0, prefer: /natural.*(aria|jenny|ava)|aria|jenny|samantha|google us english|\bava\b|zira|allison/i },
  { id: 'robot', label: 'Robot', icon: '🤖', note: 'Deep and slow', pitch: 0.6, rate: 0.85, prefer: /david|\bmark\b|\balex\b|fred|daniel|\bguy\b|ryan|google uk english male|\bmale\b/i },
  { id: 'chipmunk', label: 'Chipmunk', icon: '🐿️', note: 'High and fast', pitch: 1.9, rate: 1.3, prefer: /zira|samantha|aria|jenny|karen|female|google us english/i },
  { id: 'story', label: 'Calm Storyteller', icon: '📖', note: 'Slow and cozy', pitch: 0.95, rate: 0.85, prefer: /natural.*(guy|ryan|libby|sonia)|\bdaniel\b|\bguy\b|ryan|libby|sonia|serena|google uk english/i },
];
const clamp = (v, [a, b]) => Math.min(b, Math.max(a, Number.isFinite(+v) ? +v : a));
export const keyOf = (v) => v.voiceURI || `${v.name}|${v.lang}`;

export function loadSettings() {
  const s = { ...DEFAULTS, ...load(KEY, {}) };
  s.pitch = clamp(s.pitch, LIMITS.pitch); s.rate = clamp(s.rate, LIMITS.rate); s.volume = clamp(s.volume, LIMITS.volume);
  if (!LANGS.some(([c]) => c === s.lang)) s.lang = '';
  if (!PERSONAS.some((p) => p.id === s.persona)) s.persona = '';
  return s;
}
export const saveSettings = (s) => save(KEY, s);
export const resetSettings = () => { drop(KEY); return { ...DEFAULTS }; };

/** how "nice" a voice probably sounds (natural/neural cloud voices first) */
export function score(v) {
  const n = v.name;
  if (/natural|neural/i.test(n)) return 100;
  if (/microsoft/i.test(n) && /online/i.test(n)) return 95;
  if (/google/i.test(n)) return 90;
  if (/premium|enhanced/i.test(n)) return 85;
  if (/samantha|aria|jenny|\bava\b|allison|karen|daniel|moira|tessa|serena|zira|\bguy\b|libby|sonia|ryan|\balex\b/i.test(n)) return 70;
  return 0;
}
const REGION = { 'en-US': 'US', 'en-GB': 'UK', 'en-AU': 'Australia', 'en-IN': 'India', 'en-CA': 'Canada', 'en-IE': 'Ireland', 'en-ZA': 'South Africa', 'en-NZ': 'New Zealand' };
/** "Microsoft Aria Online (Natural) - English (United States)" -> "Aria (natural, US)" */
export function friendlyName(v) {
  let n = v.name, tags = [];
  if (/\(Natural\)|neural/i.test(n)) tags.push('natural');
  n = n.replace(/^Microsoft\s+/i, '').replace(/\s+Online\s+\(Natural\)/i, '').replace(/\s+-\s+English\s+\([^)]*\)/i, '').replace(/\s+Online$/i, '').trim();
  const r = REGION[(v.lang || '').replace('_', '-')];
  if (r && !/\b(US|UK|English)\b/.test(n)) tags.push(r);
  return tags.length ? `${n} (${tags.join(', ')})` : n;
}

/** Device voice list. Chrome/Android fill it in late: listen for voiceschanged and poll for a few seconds. */
export class Voices {
  constructor(synth) {
    this.synth = synth; this.all = []; this.subs = new Set();
    if (!synth) return;
    this.refresh();
    try { synth.addEventListener('voiceschanged', () => this.refresh()); } catch { synth.onvoiceschanged = () => this.refresh(); }
    let tries = 0;
    const poll = setInterval(() => { this.refresh(); if (this.all.length || ++tries > 20) clearInterval(poll); }, 300);
  }
  refresh() {
    let v = [];
    try { v = [...this.synth.getVoices()]; } catch { /* ignore */ }
    if (v.length !== this.all.length || v.some((x, i) => this.all[i] !== x)) { this.all = v; this.subs.forEach((f) => f(v)); }
  }
  get supported() { return !!this.synth; }
  onChange(f) { this.subs.add(f); }
  /** English voices first (the device's own language if it is not English); if none match, everything */
  usable() {
    const own = (navigator.language || 'en-US').slice(0, 2).toLowerCase();
    const langs = own === 'en' ? ['en'] : ['en', own];
    const m = this.all.filter((v) => langs.includes((v.lang || '').slice(0, 2).toLowerCase()));
    return m.length ? m : this.all;
  }
  sorted() {
    return this.usable().slice().sort((a, b) => score(b) - score(a) || Number(b.default) - Number(a.default) || a.name.localeCompare(b.name));
  }
  find(key) { return key ? this.all.find((v) => keyOf(v) === key) || null : null; }
  /** the voice to actually use for these settings (saved choice, else the best natural-sounding one) */
  resolve(s) {
    const saved = this.find(s.voiceURI);
    if (saved) return saved;
    const lang = (navigator.language || 'en-US').toLowerCase();
    const pool = this.usable();
    const sameLang = pool.filter((v) => (v.lang || '').toLowerCase().replace('_', '-') === lang);
    const best = (a) => a.slice().sort((x, y) => score(y) - score(x))[0];
    return (sameLang.length ? best(sameLang) : best(pool)) || null;
  }
  /** voice a persona likes, if the device has one */
  forPersona(p) { return this.usable().filter((v) => p.prefer.test(v.name)).sort((a, b) => score(b) - score(a))[0] || null; }
}
