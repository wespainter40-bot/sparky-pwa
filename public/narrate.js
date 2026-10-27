// "Sparky narrates": short, playful status lines driven by the real stages of a request. Kid friendly and varied (never the same line twice in a row).
import { load, save } from './store.js';
export const KEY = 'sparky.narrate.v1';
export const DEFAULT = { on: true, speak: false };
export const settings = () => { const s = { ...DEFAULT, ...load(KEY, {}) }; return { on: !!s.on, speak: !!s.speak }; };
export const set = (patch) => { save(KEY, { ...settings(), ...patch }); return settings(); };

export const LINES = {
  received: ['Charging the core...', 'Warming up my sparks...', 'Spinning up my big brain...', 'Powering up...'],
  lookup: ['Looking that up...', 'Checking the big library...', 'Searching for facts...', 'Asking the internet nicely...'],
  found: ['Found something! Putting it together...', 'Ooh, got some facts! Mixing them in...', 'Look what I found! Thinking it over...'],
  nolookup: ['Hmm, thinking it through myself...', 'Using my own spark of an idea...'],
  thinking: ['Crackling up an answer...', 'Thinking hard...', 'Connecting the wires...'],
  fallback: ['Trying another brain...', 'Switching to my backup battery...', 'One more try, hang on...'],
  token: ['Here it comes!', 'Got it! Zapping the answer out...', 'Zapping the answer out...'],
  streaming: ['Zapping the answer out...', 'Words are flowing...', 'Writing it out...'],
  wait: ['Still thinking, almost there...', 'Just a tiny bit longer...', 'Good ideas take a moment...', 'My sparks are busy...'],
};
const spokenStages = new Set(['lookup', 'found', 'wait']);   // only a few lines are ever spoken, to avoid chatter

export class Narrator {
  /** o: { show(text|''), speak(text), settings() } */
  constructor(o) { this.o = o; this.last = ''; this.idx = {}; this.running = false; this.spoken = 0; }
  pick(stage) {
    const pool = LINES[stage] || LINES.thinking;
    let i = (this.idx[stage] ?? Math.floor(Math.random() * pool.length)) % pool.length;
    let line = pool[i];
    if (line === this.last && pool.length > 1) { i = (i + 1) % pool.length; line = pool[i]; }
    this.idx[stage] = i + 1; this.last = line;
    return line;
  }
  start() {
    this.stop(); this.running = true; this.spoken = 0; this.t0 = Date.now(); this.gotToken = false; this.stageNow = '';
    this.say('received');
    this.waitTimer = setInterval(() => { if (this.running && !this.gotToken && this.stageNow !== 'waking') this.say('wait'); }, 3800);
  }
  stage(name) {
    if (!this.running || this.gotToken) return;
    if (name === 'received') { this.stageNow = this.stageNow === 'waking' ? 'received' : this.stageNow; return; }                                  // the client already said its own opening line
    if (name === 'thinking' && this.stageNow && this.stageNow !== 'received') return;   // do not talk over 'found something'
    this.say(name);
  }
  /** the server is slow to answer (probably waking up): shown even when narration is off, because otherwise it just looks broken */
  waking() {
    if (!this.running || this.gotToken) return;
    this.stageNow = 'waking';
    this.o.show('Waking Sparky up... one moment!');
  }
  token() {
    if (!this.running) return;
    if (!this.gotToken) { this.gotToken = true; clearTimeout(this.speakTimer); this.o.cancelSpoken?.(); this.say('token'); this.streamTimer = setTimeout(() => this.running && this.say('streaming'), 1400); }
  }
  say(stage) {
    const s = this.o.settings();
    if (!s.on) { this.o.show(''); return; }
    this.stageNow = stage;
    const line = this.pick(stage);
    this.o.show(line);
    if (s.speak && spokenStages.has(stage) && this.spoken < 2) {   // wait a moment: if the real answer is quick, stay quiet
      clearTimeout(this.speakTimer);
      this.speakTimer = setTimeout(() => { if (this.running && !this.gotToken) { this.spoken++; this.o.speak(line.replace(/\.\.\.$/, '')); } }, 1300);
    }
  }
  stop() {
    this.running = false; clearInterval(this.waitTimer); clearTimeout(this.speakTimer); clearTimeout(this.streamTimer);
    this.o.show('');
  }
}
