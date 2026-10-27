// Push-to-talk recognizer manager: ONE SpeechRecognition at a time, with an explicit state machine and watchdogs, so the
// mic can never get stuck "listening", double-start, or wait forever for an onend that never comes.
//
//   idle --start()--> starting --(onstart/onaudiostart)--> listening --stop()/speech end--> finishing --onend--> idle
//   anything --cancel()--> idle (nothing is sent)
//
// callbacks: onListening(), onInterim(text), onDone(text, reason), onError(code, message)
const NO_SPEECH_MS = 9000, MAX_MS = 30000, START_MS = 4500, FINISH_MS = 2200;
export const ERRORS = {
  'not-allowed': 'Please allow the microphone, then tap again. (Tap the lock icon next to the address.)',
  'service-not-allowed': 'Please allow the microphone, then tap again. (Tap the lock icon next to the address.)',
  'audio-capture': "I can't find a working microphone. Check that it is plugged in and not used by another app.",
  network: 'Voice needs the internet. Check your connection, or type instead.',
  'language-not-supported': "This browser can't understand that language. Type to Sparky instead.",
};

export class Listener {
  constructor(o) { this.o = o; this.state = 'idle'; this.rec = null; this.gen = 0; this.t = {}; }
  get active() { return this.state !== 'idle'; }
  get listening() { return this.state === 'listening'; }
  clearTimers() { Object.values(this.t).forEach(clearTimeout); this.t = {}; }

  start() {
    if (this.state !== 'idle') return false;
    if (!this.o.SR) { this.o.onError('unsupported', 'Voice typing is not supported in this browser. Type to Sparky instead!'); return false; }
    this.state = 'starting'; this.final = ''; this.interim = ''; this.heard = false; this.retried = false; this.startedAt = Date.now();
    this._begin();
    return true;
  }
  _begin() {
    const gen = ++this.gen;
    let r;
    try { r = new this.o.SR(); } catch (e) { return this._fail('audio-capture'); }
    this.rec = r;
    r.lang = this.o.lang?.() || navigator.language || 'en-US';
    r.continuous = false; r.interimResults = true; r.maxAlternatives = 1;
    const live = () => gen === this.gen;
    const goLive = () => {
      if (!live() || this.state !== 'starting') return;
      this.state = 'listening'; clearTimeout(this.t.start);
      this.t.nospeech = setTimeout(() => { if (live() && !this.heard) this.stop('silence'); }, NO_SPEECH_MS);
      this.t.max = setTimeout(() => { if (live()) this.stop('max'); }, MAX_MS);
      this.o.onListening?.();
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
      if (text) { this.heard = true; clearTimeout(this.t.nospeech); this.o.onInterim?.(text); }
      // finalize as soon as the browser says the sentence is final (do not wait for it to close the mic)
      if (fin.trim() && !int.trim() && this.state === 'listening') this.stop('final');
    };
    r.onerror = (ev) => {
      if (!live()) return;
      const e = ev.error;
      if (e === 'no-speech') { this.reason = 'no-speech'; return; }              // onend follows; handled there
      if (e === 'aborted') { this.reason = this.reason || 'aborted'; return; }
      if (e === 'audio-capture' && !this.retried && Date.now() - this.startedAt < 1500) { // mic still being released by another recognizer
        this.retried = true; this._teardown(); setTimeout(() => { if (this.state !== 'idle') this._begin(); }, 350); return;
      }
      this._fail(e);
    };
    r.onend = () => { if (live()) this._finish(this.reason || 'end'); };
    this.t.start = setTimeout(() => { if (live() && this.state === 'starting') this._fail('audio-capture'); }, START_MS);
    try { r.start(); } catch (e) {
      // InvalidStateError: a recognizer is still open. Abort it and try once more shortly.
      try { r.abort(); } catch { /* ignore */ }
      if (!this.retried) { this.retried = true; this._teardown(); setTimeout(() => { if (this.state !== 'idle') this._begin(); }, 300); }
      else this._fail('audio-capture');
    }
  }
  _teardown() {
    this.gen++; clearTimeout(this.t.start); clearTimeout(this.t.nospeech); clearTimeout(this.t.max);
    const r = this.rec; this.rec = null;
    if (r) { r.onstart = r.onaudiostart = r.onspeechstart = r.onresult = r.onerror = r.onend = null; try { r.abort(); } catch { /* ignore */ } }
  }
  /** user tap / silence / final: ask the browser to wrap up; force-finish if it never says onend */
  stop(reason = 'tap') {
    if (this.state === 'idle') return;
    if (this.state === 'starting') return this.cancel();
    if (this.state === 'finishing') return;
    this.state = 'finishing'; this.reason = this.reason || reason;
    clearTimeout(this.t.nospeech); clearTimeout(this.t.max);
    try { this.rec && this.rec.stop(); } catch { /* ignore */ }
    this.t.finish = setTimeout(() => this._finish(this.reason), FINISH_MS);
  }
  _finish(reason) {
    if (this.state === 'idle') return;
    const text = (this.final + ' ' + this.interim).replace(/\s+/g, ' ').trim();   // interim words count: do not lose what was said
    this.clearTimers(); this._teardown(); this.state = 'idle'; this.reason = '';
    this.o.onDone(text, reason);
  }
  _fail(code) {
    if (this.state === 'idle') return;
    this.clearTimers(); this._teardown(); this.state = 'idle'; this.reason = '';
    this.o.onError(code, ERRORS[code] || 'Voice did not work. You can type instead.');
    this.o.onDone('', 'error');
  }
  /** drop everything without sending */
  cancel() {
    if (this.state === 'idle') return;
    this.clearTimers(); this._teardown(); this.state = 'idle'; this.reason = '';
    this.o.onDone('', 'cancel');
  }
}
