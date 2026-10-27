import { Orb } from '/orb.js';
import * as Theme from '/themes.js';
import * as Mem from '/memory.js';
import * as Hist from '/history.js';
import * as Voice from '/voice.js';
import { Wake, chime, isOn as wakeWasOn } from '/wake.js';
import { Listener } from '/listen.js';
import * as Night from '/night.js';
import * as Narr from '/narrate.js';
import * as Topics from '/topics.js';
import { initSettings, initHistory } from '/panels.js';

const $ = (s) => document.querySelector(s);
const orb = new Orb($('#core'), $('#plasma'), { back: $('#back'), dust: $('#dust'), accent: Theme.current().accent });
Theme.apply(Theme.current(), orb);
const synth = 'speechSynthesis' in window ? window.speechSynthesis : null;
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

if (new URLSearchParams(location.search).has('debug')) window.__orb = orb;
let sessionId = localStorage.getItem('sparkySession');
// v7: start a fresh server-side conversation once, so earlier replies that called the user by the wrong name do not steer the model
if (localStorage.getItem('sparkySessionV') !== '7') { sessionId = null; localStorage.setItem('sparkySessionV', '7'); }
if (!sessionId) { sessionId = newId(); localStorage.setItem('sparkySession', sessionId); }
function newId() {
  return (crypto.randomUUID ? crypto.randomUUID() : [...Array(32)].map(() => Math.floor(Math.random() * 16).toString(16)).join(''));
}

let config = { drive: {} };
let busy = false, listening = false, sparkTimer = null, micCard = null;
let muted = localStorage.getItem('sparkyMuted') === '1';
let pendingSpeech = 0;

// ---------- status ----------
const LABELS = { ready: 'Ready', listening: 'Listening', thinking: 'Thinking', speaking: 'Speaking' };
let state = 'ready';
const settingsCtx = { onWakeStatus: new Set() };

// ---------- "Hey Sparky" hands-free wake word (opt-in) ----------
const wake = new Wake({
  SR,
  canListen: () => state === 'ready' && !busy && !listening && pendingSpeech === 0 && !document.hidden,
  onStatus: (st, detail) => {
    paintStatus();
    settingsCtx.onWakeStatus.forEach((f) => f(st, detail));
    if (st === 'blocked') toast('Microphone is blocked, so Hey Sparky is off. Allow it in the browser, then turn it on again.', 5200);
    else if (st === 'error') toast(detail || 'Hey Sparky stopped. You can turn it on again in Settings.', 5200);
  },
  onWake: (rest) => {
    chime(); orb.burst(26); orb.shockwave(0.6);
    if (rest && rest.length > 2) setTimeout(() => send(rest, 'voice'), 250);          // "Hey Sparky, what is the moon?" in one go
    else setTimeout(() => { if (!busy && !listening) beginListening({ quiet: true }); else wake.sync(); }, 380);
  },
});
document.addEventListener('visibilitychange', () => wake.sync());
function setState(s) {
  state = s;
  orb.setState(s);
  document.body.dataset.state = s;
  $('#micBtn').setAttribute('aria-pressed', String(s === 'listening'));
  paintStatus();
  wake.sync();
}
const wakeLive = () => wake.on && wake.status === 'listening' && state === 'ready';
function paintStatus() {
  const st = $('#statusText');
  if (wakeLive()) { if (!st.querySelector('.say')) { const b = document.createElement('span'); b.className = 'say'; b.textContent = 'Say '; st.replaceChildren(b, 'Hey Sparky'); } }
  else st.textContent = LABELS[state];
  $('#hint').textContent = hintFor(state);
  document.body.dataset.wake = wakeLive() ? '1' : '0';
}
function hintFor(s) {
  if (s === 'listening') return 'Listening... tap to stop';
  if (s === 'thinking') return 'Sparky is thinking...';
  if (s === 'speaking') return 'Tap to interrupt and talk';
  if (wakeLive()) return 'Say "Hey Sparky" or tap the glow';
  return SR ? 'Tap the glow to talk' : 'Voice not supported here. Type below!';
}
function settle() { // pick the right resting state
  if (listening) setState('listening');
  else if (busy) setState('thinking');
  else if (pendingSpeech > 0) setState('speaking');
  else setState('ready');
}

// ---------- cards ----------
const above = $('#above'), below = $('#below');
function addCard(who, text) {
  const zone = who === 'user' ? below : above;
  const card = document.createElement('div');
  card.className = `card ${who}` + (who === 'user' ? ' clamp' : '');
  card.textContent = text;
  zone.append(card);
  const keep = who === 'user' ? 2 : 3; // floating cards: older ones fade away, full log lives on the server
  const live = () => [...zone.children].filter((c) => !c.classList.contains('leaving'));
  live().slice(0, Math.max(0, live().length - keep)).forEach(leave);
  live().reverse().forEach((c, i) => {
    c.classList.toggle('fade1', i === 1);
    c.classList.toggle('fade2', i >= 2);
  });
  return card;
}
function leave(card) { // smooth exit: fade + collapse, then remove
  card.style.setProperty('--h', card.offsetHeight + 'px');
  card.classList.add('leaving');
  setTimeout(() => card.remove(), 420);
}
function toast(msg, ms = 3200) {
  const t = $('#toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), ms);
}

// ---------- speech output ----------
function setMuted(m) {
  muted = m;
  localStorage.setItem('sparkyMuted', m ? '1' : '0');
  $('#muteBtn').setAttribute('aria-pressed', String(m));
  $('#muteBtn').setAttribute('aria-label', m ? "Unmute Sparky's voice" : "Mute Sparky's voice");
  if (m) cancelSpeech();
}
let speechGen = 0; // utterances cancelled earlier must not touch the count of newer ones
function cancelSpeech() { speechGen++; if (synth) synth.cancel(); pendingSpeech = 0; }
// ---------- voice settings (picker) ----------
const voices = new Voice.Voices(synth);
let voiceSettings = Voice.loadSettings();
function applyVoice(u) {
  const v = voices.resolve(voiceSettings);
  if (v) { u.voice = v; u.lang = v.lang; }
  u.rate = voiceSettings.rate; u.pitch = voiceSettings.pitch;
  u.volume = Night.active() ? Night.VOLUME : 1;   // night light: a bit quieter
}
function speak(text, { force = false } = {}) {
  const clean = text.replace(/\p{Extended_Pictographic}/gu, '').replace(/[*_#`>]/g, '').trim();
  if (!synth || (muted && !force) || !clean) return;
  const u = new SpeechSynthesisUtterance(clean);
  applyVoice(u);
  pendingSpeech++;
  let finished = false; const gen = speechGen;
  const done = () => { if (finished || gen !== speechGen) return; finished = true; pendingSpeech = Math.max(0, pendingSpeech - 1); if (!listening) settle(); };
  u.onend = done; u.onerror = done;
  setTimeout(done, 4000 + (clean.length * 95) / Math.max(0.5, voiceSettings.rate)); // some browsers never fire onend: do not stay 'speaking' forever
  synth.speak(u);
  if (!busy && !listening) setState('speaking');
}
function previewVoice() {
  if (!synth) return;
  cancelSpeech();
  speak("Hi, I'm Sparky!", { force: true });
  orb.burst(8);
}
// speak as sentences arrive, so voice starts before the full reply is done
function makeSpeaker() {
  let buf = '';
  return {
    push(t) {
      buf += t;
      let m;
      while ((m = buf.match(/^([\s\S]*?[.!?]+["')\]]*)(\s+|$)/)) && buf.length > m[1].length) {
        speak(m[1]); buf = buf.slice(m[0].length);
      }
    },
    flush() { speak(buf); buf = ''; },
  };
}

// ---------- narration (playful status lines driven by the real request stages) ----------
let narrSpeaking = false;
const narrator = new Narr.Narrator({
  settings: Narr.settings,
  show(text) {
    const t = $('#ticker');
    if (!text) { clearTimeout(show_t); t.classList.remove('show', 'swap'); return; }
    if (t.textContent === text && t.classList.contains('show')) return;
    t.classList.add('swap');
    clearTimeout(show_t);
    show_t = setTimeout(() => { t.textContent = text; t.classList.remove('swap'); t.classList.add('show'); }, t.classList.contains('show') ? 140 : 0);
  },
  speak(text) {
    if (!synth || muted || pendingSpeech > 0) return;
    const u = new SpeechSynthesisUtterance(text);
    applyVoice(u); u.volume *= 0.85; narrSpeaking = true;
    u.onend = u.onerror = () => { narrSpeaking = false; };
    synth.speak(u);     // deliberately outside pendingSpeech: it must never hold up or block the real reply
  },
  cancelSpoken() { if (narrSpeaking) { narrSpeaking = false; try { synth.cancel(); } catch { /* ignore */ } } },
});
let show_t = 0;

/** what we send along with each chat: remembered facts + the top 3 favorite topics (the server validates and limits it again) */
function memoryPayload() {
  const m = Mem.payload(), tp = Topics.payload(3);
  if (!m && !tp.length) return null;
  return { name: m?.name || '', items: m?.items || [], topics: tp };
}

// ---------- chat ----------
async function send(text, source = 'text', cardEl = null) {
  text = text.trim();
  if (!text || busy) { if (cardEl) cardEl.remove(); return; }
  micCard = null; stopListening();
  cancelSpeech();
  busy = true;
  hideSuggest();
  Topics.learn(text, [Mem.get().name, 'sparky']);
  const learned = Mem.learn(text);
  if (learned.name) { toast(`Nice to meet you, ${learned.name}! I'll remember that.`); settingsCtx.refreshSettings?.(); }
  else if (learned.added.length) { toast(`Got it! I'll remember: ${learned.added[0]}`); settingsCtx.refreshSettings?.(); }
  Hist.add(sessionId, 'user', text);
  if (cardEl) { cardEl.classList.remove('interim'); cardEl.textContent = text; } else addCard('user', text);
  orb.burst(18);
  setState('thinking');
  const card = addCard('sparky', '');
  card.classList.add('typing');
  const speaker = makeSpeaker();
  let reply = '';
  narrator.start();
  try {
    const ctl = new AbortController(), kill = setTimeout(() => ctl.abort(), 90000); // never stay in 'thinking' forever
    const res = await fetch('/api/chat', {
      signal: ctl.signal, method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId, message: text, source, memory: memoryPayload() }),
    });
    if (!res.ok) throw new Error(res.status === 429 ? 'slow' : 'http');
    const reader = res.body.getReader(), dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, i); buf = buf.slice(i + 2);
        const ev = /event: (\w+)/.exec(block)?.[1], data = /data: (.*)/.exec(block)?.[1];
        if (ev === 'status' && data) { try { narrator.stage(JSON.parse(data).stage); } catch { /* ignore */ } continue; }
        if (ev !== 'token' || !data) continue;
        const t = JSON.parse(data).t;
        if (!reply) { orb.burst(22); orb.shockwave(1); narrator.token(); } // reply arriving: shockwave
        reply += t;
        card.textContent = reply;
        above.scrollTop = above.scrollHeight; card.scrollTop = card.scrollHeight;
        speaker.push(t);
      }
    }
    clearTimeout(kill);
    speaker.flush();
  } catch (e) {
    reply ||= e.message === 'slow' ? 'Whoa, that was a lot of questions! Give me a tiny breather.' : "I can't reach my brain right now. Check the internet and try again!";
    card.textContent = reply;
    speaker.flush(); if (!muted && !pendingSpeech) speak(reply);
  }
  narrator.stop();
  card.classList.remove('typing');
  if (reply) Hist.add(sessionId, 'sparky', reply);
  busy = false;
  settle();
}

// ---------- mic level meter (desktop only, real input level drives the core's ripples; phones use the simulated level) ----------
// Opening a second getUserMedia stream next to SpeechRecognition makes many Android/Windows browsers drop the recognizer
// ("audio-capture" / ends instantly), so it is skipped on touch devices and switched off for good at the first sign of trouble.
const IOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const COARSE = matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
let meter = null, meterTok = 0;
async function startMeter() {
  const tok = ++meterTok;
  if (IOS || COARSE || localStorage.getItem('sparkyNoMeter') === '1' || !navigator.mediaDevices?.getUserMedia) return;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!listening || tok !== meterTok || !AC) { stream.getTracks().forEach((t) => t.stop()); return; }
    const ctx = new AC(), an = ctx.createAnalyser(), buf = new Uint8Array(512);
    an.fftSize = 512;
    ctx.createMediaStreamSource(stream).connect(an);
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    meter = { stream, ctx };
    orb.setLevelProvider(() => {
      an.getByteTimeDomainData(buf);
      let s = 0;
      for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; s += v * v; }
      return Math.min(1, Math.sqrt(s / buf.length) * 6);
    });
  } catch { /* no mic access or no support: the simulated level stays */ }
}
function stopMeter() {
  meterTok++;
  orb.setLevelProvider(null);
  if (meter) { meter.stream.getTracks().forEach((t) => t.stop()); meter.ctx.close().catch(() => {}); meter = null; }
}

// ---------- floating cards lean toward the touch (layered parallax, set as CSS variables) ----------
const mainEl = $('main');
orb.onTilt = (x, y) => {
  const ang = Math.hypot(x, y) * 5; // degrees
  mainEl.style.setProperty('--tx', x.toFixed(3));
  mainEl.style.setProperty('--ty', y.toFixed(3));
  mainEl.style.setProperty('--rot', ang < 0.02 ? '0 1 0 0deg' : `${(-y).toFixed(3)} ${(-x).toFixed(3)} 0 ${ang.toFixed(2)}deg`);
};

// ---------- voice input (push to talk) ----------
// One state machine (listen.js) owns the recognizer. app.js only reacts to its callbacks.
const buzz = (ms = 14) => { try { navigator.vibrate && navigator.vibrate(ms); } catch { /* not supported */ } };
function showInterim(text) {
  if (!micCard || !micCard.isConnected) { micCard = addCard('user', text); micCard.classList.add('interim'); }
  else micCard.textContent = text;
  below.scrollTop = below.scrollHeight;
}
function dropMicCard() { if (micCard) { const c = micCard; micCard = null; c.classList.contains('leaving') || leave(c); } }
function endListeningUi() {
  listening = false; clearInterval(sparkTimer); stopMeter();
}
const listener = new Listener({
  SR,
  lang: () => navigator.language || 'en-US',
  onListening: () => { orb.burst(14); clearInterval(sparkTimer); sparkTimer = setInterval(() => orb.burst(3), 450); },
  onAudio: () => setTimeout(() => { if (listener.listening) startMeter(); }, 500),
  onInterim: showInterim,
  onError: (code, msg) => {
    if (code === 'audio-capture') localStorage.setItem('sparkyNoMeter', '1');    // never let the meter compete again
    toast(msg, code === 'not-allowed' || code === 'service-not-allowed' ? 6500 : 4200);
  },
  onDone: (text, reason) => {
    endListeningUi();
    if (text && !busy && reason !== 'cancel' && reason !== 'error') { const c = micCard; micCard = null; send(text, 'voice', c); return; }
    if (reason === 'no-speech' || reason === 'silence') { if (!listener.quiet) toast("I didn't hear anything. Tap the glow and try again!"); }
    dropMicCard(); settle();
  },
});
/** start a push-to-talk turn. The UI flips instantly; the recognizer starts a beat later so the wake word recognizer and any
 *  speech output have let go of the audio hardware first. */
function beginListening({ quiet = false } = {}) {
  if (!SR) { toast('Voice typing is not supported in this browser. Type to Sparky instead!'); $('#input').focus(); return; }
  if (listener.active || busy) return;
  const wasTalking = pendingSpeech > 0 || (synth && synth.speaking);
  cancelSpeech();                                  // Sparky stops talking the moment you tap
  listener.quiet = quiet;
  listening = true;                                // wake word recognizer is released by setState -> wake.sync()
  setState('listening');
  orb.burst(10);
  $('#input').value = '';
  const delay = wasTalking || wake.on ? 320 : 90;
  setTimeout(() => { if (listening && !listener.active) listener.start(); }, delay);
}
function stopListening() {                         // abandon without sending (typing, mute, new chat)
  if (listener.active) listener.cancel();
  if (listening) { endListeningUi(); }
  dropMicCard();
}

// ---------- UI wiring ----------
let lastTap = 0;
function talk() {
  const now = performance.now();
  if (now - lastTap < 380) return;                 // debounce: double taps / pointer+click pairs must not start-then-stop
  lastTap = now;
  buzz();
  if (synth && IOS && !synth.speaking) { try { synth.speak(new SpeechSynthesisUtterance('')); } catch { /* ignore */ } } // iOS needs speech unlocked by a tap
  if (listening) {                                 // tap again = "I'm done": finalize and send what was heard
    if (listener.listening) listener.stop('tap'); else listener.cancel();
    return;
  }
  if (busy) { toast('One moment, Sparky is still thinking...', 1800); return; }
  beginListening();
}
// pointerup gives an instant response on touch; the click that follows a touch is ignored (no ghost double toggle).
// keyboard "click" (Enter/Space) still works.
let lastPointerTap = -1e9;
for (const id of ['#coreBtn', '#micBtn']) {
  const b = $(id);
  b.addEventListener('pointerup', (e) => { if (e.button > 0) return; lastPointerTap = performance.now(); e.preventDefault(); talk(); });
  b.addEventListener('click', (e) => { if (performance.now() - lastPointerTap < 700) { e.preventDefault(); return; } talk(); });
}
$('#form').addEventListener('submit', (e) => {
  e.preventDefault();
  const v = $('#input').value;
  $('#input').value = '';
  send(v, 'text');
});
$('#input').addEventListener('input', () => { if (Math.random() < 0.35) orb.burst(1); });
$('#muteBtn').addEventListener('click', () => setMuted(!muted));

// export dialog
const dlg = $('#exportDlg');
const adminHeaders = () => (sessionStorage.sparkyAdmin ? { 'x-admin-token': sessionStorage.sparkyAdmin } : {});
async function adminFetch(url, init = {}) {
  let res = await fetch(url, { ...init, headers: { ...adminHeaders() } });
  if (res.status === 401) {
    const tok = prompt('Parent token needed (ADMIN_TOKEN):');
    if (!tok) return res;
    sessionStorage.sparkyAdmin = tok;
    res = await fetch(url, { ...init, headers: adminHeaders() });
  }
  return res;
}
async function download(url, name, admin) {
  const res = admin ? await adminFetch(url) : await fetch(url);
  if (!res.ok) { $('#dlgMsg').textContent = res.status === 404 ? 'Nothing to save yet. Chat first!' : 'Could not download.'; return; }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(await res.blob()); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  $('#dlgMsg').textContent = 'Saved!';
}
async function openExport() {
  $('#dlgMsg').textContent = '';
  try { config = await (await fetch('/api/config')).json(); } catch { /* offline */ }
  $('#syncDrive').hidden = !config.drive?.enabled;
  if (!dlg.open) dlg.showModal();
}
$('#dlgClose').addEventListener('click', () => dlg.close());
$('#dlThis').addEventListener('click', () => download(`/api/my/${sessionId}.md`, `sparky-${sessionId.slice(0, 8)}.md`, false));
$('#dlAll').addEventListener('click', () => download('/api/export.zip', 'sparky-sessions.zip', true));
$('#syncDrive').addEventListener('click', async () => {
  $('#dlgMsg').textContent = 'Syncing...';
  const res = await adminFetch('/api/sync', { method: 'POST' });
  const j = res.ok ? await res.json() : null;
  $('#dlgMsg').textContent = j ? `Drive: ${j.synced} synced, ${j.failed} failed.` : 'Sync not allowed.';
});
$('#newChat').addEventListener('click', () => {
  cancelSpeech();
  sessionId = newId(); localStorage.setItem('sparkySession', sessionId);
  above.replaceChildren(); below.replaceChildren(); $('#input').value = ''; dlg.close(); greet();
});

// ---------- night light ----------
function applyNight() {
  Theme.apply(Theme.current(), orb);
  $('#nightBtn').setAttribute('aria-pressed', String(Night.active()));
  settingsCtx.refreshNight?.();
}
function toggleNight() {
  const s = Night.settings();
  if (Night.active() && !s.on) { Night.set({ auto: false }); toast('Automatic night light turned off'); }   // it is on only because of the schedule
  else Night.set({ on: !s.on });
  applyNight();
}
$('#nightBtn').addEventListener('click', toggleNight);
let nightWas = Night.active();
setInterval(() => { const a = Night.active(); if (a !== nightWas) { nightWas = a; applyNight(); } }, 30000);   // the schedule

// ---------- favorite-topic suggestion (a tappable chip, never sent by itself) ----------
let suggestion = null;
function hideSuggest() { $('#suggest').hidden = true; suggestion = null; document.body.dataset.suggest = '0'; }
function showSuggest() {
  const sg = Topics.suggestion();
  if (!sg || busy) { hideSuggest(); return; }
  suggestion = sg; $('#suggestText').textContent = sg.text; $('#suggest').hidden = false; document.body.dataset.suggest = '1';
}
$('#suggestGo').addEventListener('click', () => { const sg = suggestion; hideSuggest(); if (sg && !busy) send(sg.send, 'text'); });
$('#suggestX').addEventListener('click', hideSuggest);

// ---------- settings, history, theme, memory wiring ----------
Object.assign(settingsCtx, {
  orb, voices, wake, toast, openExport,
  voiceSettings: () => voiceSettings,
  setVoiceSettings: (v, reset) => { voiceSettings = v; if (!reset) Voice.saveSettings(v); },
  preview: previewVoice,
  setTheme: (patch) => Theme.set(patch, orb),
  setNight: (patch) => { Night.set(patch); applyNight(); },
  toggleNight,
  narrationChanged: () => { if (!Narr.settings().on) narrator.stop(); },
  memoryChanged: () => { if (Mem.isEmpty() && !Topics.hasData()) hideSuggest(); },
  continueChat: (id) => {
    const c = Hist.get(id); if (!c) return;
    cancelSpeech(); sessionId = id; localStorage.setItem('sparkySession', id);
    above.replaceChildren(); below.replaceChildren(); $('#input').value = '';
    const sp = c.msgs.filter((m) => m.r === 's').slice(-1), us = c.msgs.filter((m) => m.r === 'u').slice(-1);
    for (const m of c.msgs.slice(-4)) if ((m.r === 's' && sp.includes(m)) || (m.r === 'u' && us.includes(m))) addCard(m.r === 'u' ? 'user' : 'sparky', m.t);
    addCard('sparky', `Welcome back${Mem.get().name ? ', ' + Mem.get().name : ''}! Let's keep chatting.`);
    orb.burst(12); hideSuggest();
  },
});
initSettings(settingsCtx);
initHistory(settingsCtx);

// ---------- startup ----------
function greet() {
  const nm = Mem.get().name;
  addCard('sparky', `${nm ? `Hi ${nm}!` : 'Hi there!'} I'm Sparky. Tap my glowing core and ask me anything!`);
  orb.burst(12);
  showSuggest();
}
Topics.backfill(Hist.all().flatMap((c) => c.msgs.filter((m) => m.r === 'u').map((m) => m.t)), [Mem.get().name, 'sparky']);
applyNight();
setMuted(muted);
setState('ready');
fetch('/api/config').then((r) => r.json()).then((c) => { config = c; }).catch(() => {}).finally(greet);
if (wakeWasOn() && SR) wake.enable(); // hands-free was turned on earlier: resume it quietly (the browser asks for the mic only if it must)
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
