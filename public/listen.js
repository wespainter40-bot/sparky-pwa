// Push-to-talk recognizer manager: ONE SpeechRecognition at a time, with an explicit state machine and watchdogs, so the
// mic can never get stuck "listening", double-start, or wait forever for an onend that never comes.
//
//   idle --start()--> starting --(onstart/onaudiostart)--> listening --stop()/speech end--> finishing --onend--> idle
//   anything --cancel()--> idle (nothing is sent)
//
// callbacks: onListening(), onInterim(text), onDone(text, reason), onError(code, message)
const NO_SPEECH_MS = 9000, MAX_MS = 30000, START_MS = 4500, FINISH_MS = 2200, END_SILENCE_MS = 1500;

/** recognition language: the saved choice, else the device language ("en" or nothing -> en-US) */
export function normLang(l) {
  l = String(l || '').replace('_', '-').trim();
  if (!l || l.toLowerCase() === 'en') return 'en-US';
  return l;
}

/** specific, actionable text for a recognizer error. ctx: { perm: 'granted'|'denied'|'prompt'|'', secure: bool, brave: bool } */
export function explain(code, ctx = {}) {
  const lock = 'Click the lock icon in the address bar, set Microphone to Allow, then tap again.';
  switch (code) {
    case 'not-allowed':
      if (ctx.secure === false) return 'Voice only works on a secure (https) page. Open Sparky from its https address.';
      if (ctx.perm === 'denied') return `Microphone blocked. ${lock}`;
      return 'Please allow the microphone: click Allow when the browser asks. If it did not ask, ' + lock.charAt(0).toLowerCase() + lock.slice(1);
    case 'service-not-allowed':
      return `The browser's speech service is blocked or turned off. ${ctx.perm === 'denied' ? lock : 'Check the browser settings (voice typing / speech services), then tap again.'}`;
    case 'audio-capture':
      return "I can't get the microphone. Check that it is plugged in and chosen in your system Sound settings, and that no other app (Teams, Zoom, Discord) is using it.";
    case 'network':
      return ctx.brave
        ? "Brave blocks the browser's speech service, so voice can't work here. Use Chrome or Edge, or type to Sparky."
        : "The browser's speech service couldn't connect. Check your internet connection and try again. (Chrome and Edge send your voice to an online service.)";
    case 'language-not-supported':
      return "This browser can't understand that language. Pick another in Settings > Voice diagnostics, or type to Sparky.";
    case 'unsupported':
      return 'Voice typing is not supported in this browser. Use Chrome or Edge, or type to Sparky.';
    default:
      return `Voice stopped unexpectedly (${code || 'unknown'}). Tap to try again, or type to Sparky.`;
  }
}
export const ERRORS = new Proxy({}, { get: (_, code) => explain(String(code)) });   // kept for older imports

export class Listener {
  constructor(o) { this.o = o; this.state = 'idle'; this.rec = null; this.gen = 0; this.t = {}; }
  get active() { return this.state !== 'idle'; }
  get listening() { return this.state === 'listening'; }
  clearTimers() { Object.values(this.t).forEach(clearTimeout); this.t = {}; }

  start() {
    if (this.state !== 'idle') return false;
    if (!this.o.SR) { this.o.onError('unsupported', explain('unsupported')); return false; }
    this.state = 'starting'; this.final = ''; this.interim = ''; this.heard = false; this.retried = false; this.netRetried = false; this.startedAt = Date.now(); this.o.log?.('listen', 'start');
    this._begin();
    return true;
  }
  _begin() {
    const gen = ++this.gen;
    let r;
    try { r = new this.o.SR(); } catch (e) { return this._fail('audio-capture'); }
    this.rec = r;
    r.lang = normLang(this.o.lang?.() || navigator.language);
    r.continuous = false; r.interimResults = true; r.maxAlternatives = 1;
    const live = () => gen === this.gen;
    const goLive = () => {
      if (!live() || this.state !== 'starting') return;
      this.state = 'listening'; clearTimeout(this.t.start);
      this.t.nospeech = setTimeout(() => { if (live() && !this.heard) this.stop('silence'); }, NO_SPEECH_MS);
      this.t.max = setTimeout(() => { if (live()) this.stop('max'); }, MAX_MS);
      this.o.onListening?.(); this.o.log?.('listen', `listening (${r.lang})`);
    };
    r.onstart = goLive; r.onaudiostart = () => { goLive(); this.o.onAudio?.(); };
    r.onspeechstart = () => { if (live()) { this.heard = true; clearTimeout(this.t.nospeech); } };
    r.onresult = (ev) => {
      if (!live()) return;
      goLive();                                   // some browsers skip onstart
      let fin = '', int = '';
      for (let i = 0; i < ev.results.length; i++) { const res = ev.results[i]; (res.isFinal ? (fin += res[0].transcript) : (int += res[0].transcript)); }
      this.final = fin; this.interim = int;
      const text = (fin + (fin && int ? ' ' : '') + int).trim();
      if (text) {
        this.heard = true; clearTimeout(this.t.nospeech); this.o.onInterim?.(text);
        // the browser can take a long time to close the mic after you stop: end it ourselves after a short silence
        clearTimeout(this.t.silence);
        this.t.silence = setTimeout(() => { if (live() && this.state === 'listening') { this.o.log?.('listen', 'silence after words, finishing'); this.stop('silence-end'); } }, END_SILENCE_MS);
      }
      // finalize as soon as the browser says the sentence is final (do not wait for it to close the mic)
      if (fin.trim() && !int.trim() && this.state === 'listening') this.stop('final');
    };
    r.onerror = (ev) => {
      if (!live()) return;
      const e = ev.error;
      this.o.log?.('listen', `error: ${e}`, e === 'no-speech' || e === 'aborted' ? 'info' : 'warn');
      if (e === 'no-speech') { this.reason = 'no-speech'; return; }              // onend follows; handled there
      if (e === 'aborted') { this.reason = this.reason || 'aborted'; return; }
      if (e === 'network' && !this.netRetried && Date.now() - this.startedAt < 6000) { // often a one-off blip: one quiet retry before telling anyone
        this.netRetried = true; this._teardown(); this.o.log?.('listen', 'network error, retrying once'); setTimeout(() => { if (this.state !== 'idle') this._begin(); }, 450); return;
      }
      if (e === 'audio-capture' && !this.retried && Date.now() - this.startedAt < 1500) { // mic still being released by another recognizer
        this.retried = true; this._teardown(); setTimeout(() => { if (this.state !== 'idle') this._begin(); }, 350); return;
      }
      this._fail(e);
    };
    r.onend = () => { if (live()) this._finish(this.reason || 'end'); };
    r.onsoundstart = () => { if (live()) this.sound = true; };
    this.t.start = setTimeout(() => { if (live() && this.state === 'starting') this._fail('audio-capture'); }, START_MS);
    try { r.start(); } catch (e) {
      // InvalidStateError: a recognizer is still open. Abort it and try once more shortly.
      try { r.abort(); } catch { /* ignore */ }
      if (!this.retried) { this.retried = true; this._teardown(); setTimeout(() => { if (this.state !== 'idle') this._begin(); }, 300); }
      else this._fail('audio-capture');
    }
  }
  _teardown() {
    this.gen++; clearTimeout(this.t.start); clearTimeout(this.t.nospeech); clearTimeout(this.t.max); clearTimeout(this.t.silence);
    const r = this.rec; this.rec = null;
    if (r) { r.onstart = r.onaudiostart = r.onspeechstart = r.onsoundstart = r.onresult = r.onerror = r.onend = null; try { r.abort(); } catch { /* ignore */ } }
  }
  /** user tap / silence / final: ask the browser to wrap up; force-finish if it never says onend */
  stop(reason = 'tap') {
    if (this.state === 'idle') return;
    if (this.state === 'starting') return this.cancel();
    if (this.state === 'finishing') return;
    this.state = 'finishing'; this.reason = this.reason || reason;
    clearTimeout(this.t.nospeech); clearTimeout(this.t.max); clearTimeout(this.t.silence);
    try { this.rec && this.rec.stop(); } catch { /* ignore */ }
    this.t.finish = setTimeout(() => this._finish(this.reason), FINISH_MS);
  }
  _finish(reason) {
    if (this.state === 'idle') return;
    const text = (this.final + ' ' + this.interim).replace(/\s+/g, ' ').trim();   // interim words count: do not lose what was said
    const heard = this.heard;
    this.clearTimers(); this._teardown(); this.state = 'idle'; this.reason = '';
    this.o.log?.('listen', `done (${reason}), ${text ? `heard "${text.slice(0, 40)}"` : 'no text'}`);
    // the mic closed on its own having detected speech but produced no words: say so, instead of a vague "didn't hear anything"
    this.o.onDone(text, !text && heard && (reason === 'end' || reason === 'no-speech') ? 'nothing' : reason);
  }
  _fail(code) {
    if (this.state === 'idle') return;
    this.clearTimers(); this._teardown(); this.state = 'idle'; this.reason = '';
    this.o.log?.('listen', `failed: ${code}`, 'error');
    this.o.onError(code, explain(code, this.o.ctx?.() || {}));
    this.o.onDone('', 'error');
  }
  /** drop everything without sending */
  cancel() {
    if (this.state === 'idle') return;
    this.clearTimers(); this._teardown(); this.state = 'idle'; this.reason = '';
    this.o.onDone('', 'cancel');
  }
}
