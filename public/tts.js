// Speech output queue. One utterance at a time, in order, driven by our own queue instead of the browser's, because:
//  - Chrome silently drops utterances whose JS object was garbage collected (onend never fires)  -> we keep references
//  - Chrome stops one long utterance after ~15 s                                                  -> text is cut into short chunks
//  - cancel() immediately followed by speak() is often swallowed                                  -> small guard delay after a cancel
//  - some voices never fire onend / onerror                                                       -> per-utterance watchdog
//  - network voices can fail                                                                      -> one retry with the device's default voice
//  - speak() without any user activation is blocked (page reloaded with Hey Sparky on)             -> wait for the next tap, then continue
import { chunkForSpeech, speakMs } from './speech.js';
export const CANCEL_GUARD_MS = 80;

export class Speaker {
  /** o: { synth, prepare(u) (voice/pitch/rate/volume), onChange(pending), onFirstWord(kind), onNeedGesture(), log(kind,msg,level) } */
  constructor(o) {
    this.o = o; this.items = []; this.cur = null; this.gen = 0; this.refs = new Set(); this.blocked = false; this.lastCancel = 0; this.timer = null; this.wd = null;
  }
  get pending() { return this.items.length + (this.cur ? 1 : 0); }
  get busy() { return this.pending > 0; }
  /** add text (cleaned and cut into chunks); kind: 'reply' | 'narration' | 'test' */
  say(text, { kind = 'reply', chunked = false } = {}) {
    if (!this.o.synth) return 0;
    const parts = chunked ? [text] : chunkForSpeech(text);
    for (const p of parts) this.items.push({ text: p, kind, tries: 0, first: this.items.length === 0 && !this.cur });
    if (parts.length) { this.o.onChange?.(this.pending); this.pump(); }
    return parts.length;
  }
  cancel() {
    this.gen++; this.items = []; this.cur = null; clearTimeout(this.wd); clearTimeout(this.timer);
    this.lastCancel = Date.now(); this.blocked = false;
    try { this.o.synth && this.o.synth.cancel(); } catch { /* ignore */ }
    setTimeout(() => { if (!this.cur) this.refs.clear(); }, 400);
    this.o.onChange?.(0);
  }
  /** drop queued items of one kind and stop it if it is the one speaking (a reply is about to start) */
  drop(kind) {
    const wasCur = this.cur && this.cur.kind === kind;
    this.items = this.items.filter((i) => i.kind !== kind);
    if (wasCur) { this.gen++; this.cur = null; clearTimeout(this.wd); this.lastCancel = Date.now(); try { this.o.synth.cancel(); } catch { /* ignore */ } }
    this.o.onChange?.(this.pending);
    if (wasCur) this.pump();
  }
  /** a user gesture happened: if speech was blocked waiting for one, go on */
  unlock() { if (this.blocked) { this.blocked = false; this.pump(); } }
  pump() {
    if (this.cur || !this.items.length || this.blocked) return;
    const wait = CANCEL_GUARD_MS - (Date.now() - this.lastCancel);
    if (wait > 0) { clearTimeout(this.timer); this.timer = setTimeout(() => this.pump(), wait); return; }
    const item = this.cur = this.items.shift(), gen = this.gen, synth = this.o.synth;
    let u;
    try { u = new SpeechSynthesisUtterance(item.text); } catch (e) { this.cur = null; this.o.log?.('tts', 'cannot create utterance: ' + e.message, 'error'); return this.pump(); }
    this.o.prepare(u, item);
    if (item.tries > 0) { u.voice = null; }      // retry with the default voice
    this.refs.add(u);
    let done = false, started = false;
    const finish = (how) => {
      if (done) return; done = true; clearTimeout(this.wd); this.refs.delete(u);
      if (gen !== this.gen) return;                     // cancelled meanwhile: a newer queue owns the state
      this.cur = null;
      if (how === 'blocked') { this.items.unshift(item); this.blocked = true; this.o.log?.('tts', 'speech blocked: the browser needs a tap first', 'warn'); this.o.onNeedGesture?.(); this.o.onChange?.(this.pending); return; }
      if (how === 'retry') { item.tries++; this.items.unshift(item); }
      this.o.onChange?.(this.pending);
      this.pump();
    };
    u.onstart = () => { started = true; if (item.first) { item.first = false; this.o.onFirstWord?.(item.kind); } };
    u.onend = () => finish('end');
    u.onerror = (ev) => {
      const e = ev && ev.error;
      if (e === 'interrupted' || e === 'canceled') return finish('end');
      if (e === 'not-allowed') return finish('blocked');
      this.o.log?.('tts', `speech error "${e || 'unknown'}"${item.tries ? '' : ', retrying with the default voice'}`, 'error');
      finish(item.tries < 1 ? 'retry' : 'end');
    };
    clearTimeout(this.wd);
    this.wd = setTimeout(() => {   // onend never came (voice bug / GC): move on, and stop the stuck utterance
      this.o.log?.('tts', `no end event after ${Math.round(speakMs(item.text, u.rate || 1))} ms${started ? '' : ' (and it never started)'}, skipping`, 'warn');
      if (gen === this.gen) { this.lastCancel = Date.now(); try { synth.cancel(); } catch { /* ignore */ } }
      finish('end');
    }, speakMs(item.text, u.rate || 1));
    try {
      if (synth.paused) synth.resume();
      synth.speak(u);
    } catch (e) { this.o.log?.('tts', 'speak() threw: ' + e.message, 'error'); finish('end'); }
  }
}
