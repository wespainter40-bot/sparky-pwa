// "Hey Sparky" hands-free mode: continuous Web Speech recognition that only listens for the wake phrase.
// Honest limits: foreground tab only, and only in browsers with SpeechRecognition (Chrome/Edge/Android Chrome; iOS Safari is unreliable).
import { load, save } from './store.js';
import { normLang, explain } from './listen.js';
export const KEY = 'sparky.wake.v1';
export const WAKE_RE = /\b(?:hey|hay|hi|okay|ok)\s*,?\s*(?:sparky|sparkie|sparkey|sparki|spark|sparkly)\b|\ba\s+(?:sparky|sparkie|sparkey)\b/i;
export const isOn = () => !!load(KEY, {}).on;

export class Wake {
  /** o: { SR, canListen():bool, onWake(rest), onStatus(status, detail) } ; status: off | starting | listening | paused | blocked | error | unsupported */
  constructor(o) {
    this.o = o; this.on = false; this.rec = null; this.gen = 0; this.fails = 0; this.status = o.SR ? 'off' : 'unsupported';
    this.timer = null; this.armTimer = null; this.resumeTimer = null;
  }
  get supported() { return !!this.o.SR; }
  set(status, detail) { if (this.status !== status || detail) { this.status = status; this.o.onStatus?.(status, detail); } }
  enable() {
    if (!this.o.SR) { this.set('unsupported'); return false; }
    this.on = true; this.fails = 0; save(KEY, { on: true }); this.sync(); return true;
  }
  /** diagnostics: try again right now */
  retryNow() { this.fails = 0; clearTimeout(this.timer); this.kill(); if (this.on) this.sync(); }
  disable() { this.on = false; save(KEY, { on: false }); this.kill(); this.set('off'); }
  /** call whenever Sparky's state changes: listens only while idle (never while speaking, thinking or in a normal mic turn) */
  sync() {
    clearTimeout(this.resumeTimer);
    if (!this.on) return;
    if (!this.o.canListen()) { this.kill(); this.set('paused'); this.resumeTimer = setTimeout(() => this.sync(), 800); return; }   // keep checking: the reason (a guard after Sparky's voice, a diagnostics test...) passes by itself
    if (this.rec) return;
    // short delay after Sparky stops talking so the tail of its own voice is not heard
    this.resumeTimer = setTimeout(() => { if (this.on && this.o.canListen() && !this.rec) this.start(); }, 650);
  }
  kill() {
    clearTimeout(this.timer); clearTimeout(this.armTimer); clearTimeout(this.resumeTimer); this.armed = false;
    const r = this.rec; this.rec = null; this.gen++;
    if (r) { r.onresult = r.onerror = r.onend = null; try { r.abort(); } catch { /* ignore */ } }
  }
  start() {
    if (this.rec || !this.on || !this.o.canListen()) return;   // never open the mic while a push-to-talk turn or Sparky's voice is active
    let r;
    try { r = new this.o.SR(); } catch { this.set('error', 'Could not start listening.'); return; }
    const gen = ++this.gen;
    r.continuous = true; r.interimResults = true; r.lang = normLang(this.o.lang?.() || navigator.language); r.maxAlternatives = 3;
    this.ignoreUntil = Date.now() + 500;      // the first moments can still contain the tail of Sparky's own voice
    r.onresult = (ev) => { if (gen === this.gen) this.result(ev); };
    r.onerror = (ev) => {
      if (gen !== this.gen) return;
      const e = ev.error;
      if (e !== 'no-speech' && e !== 'aborted') this.o.log?.('wake', `error: ${e}`, 'warn');
      if (e === 'not-allowed' || e === 'service-not-allowed') { this.on = false; save(KEY, { on: false }); this.kill(); this.set('blocked', explain(e, this.o.ctx?.() || {})); return; }
      if (e === 'no-speech' || e === 'aborted') return;
      this.fails++;
      // never give up for good (a flaky network comes back): show what is wrong and keep trying slowly in the background
      if (this.fails >= 4) this.set('error', explain(e, this.o.ctx?.() || {}));
    };
    r.onend = () => {
      if (gen !== this.gen) return;
      this.rec = null;
      if (!this.on) return;
      if (!this.o.canListen()) { this.set('paused'); return; }
      // Chrome ends continuous sessions every so often: quietly start a new one (slower after errors)
      this.timer = setTimeout(() => this.start(), Math.min(30000, 250 + this.fails * 1500));
    };
    this.rec = r;
    try { r.start(); this.set('listening'); this.o.log?.('wake', 'listening'); } catch { this.rec = null; this.fails++; this.timer = setTimeout(() => this.start(), Math.min(30000, 1200 + this.fails * 1500)); }
  }
  result(ev) {
    if (!this.o.canListen() || Date.now() < this.ignoreUntil) return;   // Sparky's own voice (or a late result from before it spoke) never counts
    this.fails = 0; if (this.status === 'error') this.set('listening');
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      const res = ev.results[i];
      for (let a = 0; a < Math.min(res.length, 3); a++) {
        const text = String(res[a].transcript || ''), m = WAKE_RE.exec(text);
        if (!m) continue;
        const rest = text.slice(m.index + m[0].length).replace(/^[\s,.!?-]+/, '');
        clearTimeout(this.armTimer);
        if (res.isFinal) return this.fire(rest);
        this.armed = true;                                    // interim hit: wait a beat for the rest of the sentence, then fire
        this.armTimer = setTimeout(() => this.fire(''), 1100);
        return;
      }
    }
  }
  fire(rest) {
    if (!this.armed && !rest && !this.rec) return;
    this.armed = false; clearTimeout(this.armTimer);
    this.o.log?.('wake', 'heard Hey Sparky');
    this.kill(); this.set('paused');
    this.o.onWake(String(rest || '').trim());
  }
}

/** a short two-note chime (no audio files needed) */
let ac = null;
export function chime() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    ac = ac || new AC(); if (ac.state === 'suspended') ac.resume().catch(() => {});
    const t0 = ac.currentTime;
    [[880, 0], [1320, 0.11]].forEach(([f, dt]) => {
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t0 + dt); g.gain.exponentialRampToValueAtTime(0.16, t0 + dt + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dt + 0.38);
      o.connect(g).connect(ac.destination); o.start(t0 + dt); o.stop(t0 + dt + 0.4);
    });
  } catch { /* audio blocked: the visual burst still shows */ }
}
