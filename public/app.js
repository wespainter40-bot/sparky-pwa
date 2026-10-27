import { Orb } from '/orb.js';

const $ = (s) => document.querySelector(s);
const orb = new Orb($('#core'), $('#plasma'), { back: $('#back'), dust: $('#dust') });
const synth = 'speechSynthesis' in window ? window.speechSynthesis : null;
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

if (new URLSearchParams(location.search).has('debug')) window.__orb = orb;
let sessionId = localStorage.getItem('sparkySession');
if (!sessionId) { sessionId = newId(); localStorage.setItem('sparkySession', sessionId); }
function newId() {
  return (crypto.randomUUID ? crypto.randomUUID() : [...Array(32)].map(() => Math.floor(Math.random() * 16).toString(16)).join(''));
}

let config = { childName: 'Pearson', drive: {} };
let busy = false, listening = false, recog = null, sparkTimer = null;
let muted = localStorage.getItem('sparkyMuted') === '1';
let pendingSpeech = 0;

// ---------- status ----------
const LABELS = { ready: 'Ready', listening: 'Listening', thinking: 'Thinking', speaking: 'Speaking' };
let state = 'ready';
function setState(s) {
  state = s;
  orb.setState(s);
  document.body.dataset.state = s;
  $('#statusText').textContent = LABELS[s];
  $('#micBtn').setAttribute('aria-pressed', String(s === 'listening'));
  $('#hint').textContent = hintFor(s);
}
function hintFor(s) {
  if (s === 'listening') return 'Listening... tap to stop';
  if (s === 'thinking') return 'Sparky is thinking...';
  if (s === 'speaking') return 'Tap to interrupt and talk';
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
function cancelSpeech() { if (synth) synth.cancel(); pendingSpeech = 0; }
function pickVoice() {
  const lang = (navigator.language || 'en-US').slice(0, 2);
  const voices = synth.getVoices().filter((v) => v.lang.startsWith(lang));
  return voices.find((v) => /natural|google|samantha|aria|jenny/i.test(v.name)) || voices[0];
}
function speak(text) {
  const clean = text.replace(/\p{Extended_Pictographic}/gu, '').replace(/[*_#`>]/g, '').trim();
  if (!synth || muted || !clean) return;
  const u = new SpeechSynthesisUtterance(clean);
  const v = pickVoice(); if (v) u.voice = v;
  u.rate = 1; u.pitch = 1.15;
  pendingSpeech++;
  const done = () => { pendingSpeech = Math.max(0, pendingSpeech - 1); if (!listening) settle(); };
  u.onend = done; u.onerror = done;
  synth.speak(u);
  if (!busy && !listening) setState('speaking');
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

// ---------- chat ----------
async function send(text, source = 'text') {
  text = text.trim();
  if (!text || busy) return;
  stopListening();
  cancelSpeech();
  busy = true;
  addCard('user', text);
  orb.burst(18);
  setState('thinking');
  const card = addCard('sparky', '');
  card.classList.add('typing');
  const speaker = makeSpeaker();
  let reply = '';
  try {
    const res = await fetch('/api/chat', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId, message: text, source }),
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
        if (ev !== 'token' || !data) continue;
        const t = JSON.parse(data).t;
        if (!reply) { orb.burst(22); orb.shockwave(1); } // reply arriving: shockwave
        reply += t;
        card.textContent = reply;
        above.scrollTop = above.scrollHeight; card.scrollTop = card.scrollHeight;
        speaker.push(t);
      }
    }
    speaker.flush();
  } catch (e) {
    reply ||= e.message === 'slow' ? 'Whoa, that was a lot of questions! Give me a tiny breather.' : "I can't reach my brain right now. Check the internet and try again!";
    card.textContent = reply;
    speaker.flush(); if (!muted && !pendingSpeech) speak(reply);
  }
  card.classList.remove('typing');
  busy = false;
  settle();
}

// ---------- mic level meter (real input level drives the core's ripples; falls back to a simulated level) ----------
const IOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
let meter = null, meterTok = 0;
async function startMeter() {
  const tok = ++meterTok;
  if (IOS || localStorage.getItem('sparkyNoMeter') === '1' || !navigator.mediaDevices?.getUserMedia) return;
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

// ---------- voice input ----------
function startListening() {
  if (!SR) { toast('Voice typing is not supported in this browser. Type to Sparky instead!'); $('#input').focus(); return; }
  cancelSpeech();
  recog = new SR();
  recog.lang = navigator.language || 'en-US';
  recog.interimResults = true; recog.continuous = false;
  let finalText = '', retryMic = false;
  recog.onresult = (ev) => {
    let interim = '';
    for (const r of ev.results) (r.isFinal ? (finalText += r[0].transcript) : (interim += r[0].transcript));
    $('#input').value = finalText + interim;
  };
  recog.onerror = (ev) => {
    if (ev.error === 'audio-capture' && meter) { // the mic meter and the recognizer fought over the mic: never use the meter again, retry quietly
      localStorage.setItem('sparkyNoMeter', '1'); stopMeter(); retryMic = true;
      return;
    }
    if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') toast('Microphone is blocked. Allow it in the browser, or type instead.');
    else if (ev.error === 'no-speech') toast("I didn't hear anything. Tap and try again!");
    else if (ev.error !== 'aborted') toast('Voice did not work. You can type instead.');
  };
  recog.onend = () => {
    if (retryMic) { retryMic = false; try { recog.start(); return; } catch { /* fall through and finish */ } }
    listening = false; clearInterval(sparkTimer); stopMeter();
    const text = (finalText || $('#input').value).trim();
    $('#input').value = '';
    if (text && !busy) send(text, 'voice'); else settle();
  };
  try { recog.start(); } catch { return; }
  listening = true; setState('listening');
  orb.burst(14);
  setTimeout(() => { if (listening) startMeter(); }, 250);
  sparkTimer = setInterval(() => orb.burst(3), 450);
}
function stopListening() {
  if (!listening) return;
  listening = false; clearInterval(sparkTimer); stopMeter();
  try { recog.onend = null; recog.abort(); } catch { /* ignore */ }
  $('#input').value = '';
}

// ---------- UI wiring ----------
function talk() {
  orb.burst(10);
  if (synth && !synth.speaking) synth.speak(new SpeechSynthesisUtterance('')); // unlock audio on iOS
  if (busy) return;
  if (listening) { try { recog.stop(); } catch { /* ignore */ } return; } // stop -> onend sends
  startListening();
}
$('#coreBtn').addEventListener('click', talk);
$('#micBtn').addEventListener('click', talk);
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
$('#exportBtn').addEventListener('click', async () => {
  $('#dlgMsg').textContent = '';
  try { config = await (await fetch('/api/config')).json(); } catch { /* offline */ }
  $('#syncDrive').hidden = !config.drive?.enabled;
  dlg.showModal();
});
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
  sessionId = newId(); localStorage.setItem('sparkySession', sessionId);
  above.replaceChildren(); below.replaceChildren(); $('#input').value = ''; dlg.close(); greet();
});

// ---------- startup ----------
function greet() {
  addCard('sparky', `Hi ${config.childName}! I'm Sparky. Tap my glowing core and ask me anything!`);
  orb.burst(12);
}
setMuted(muted);
setState('ready');
fetch('/api/config').then((r) => r.json()).then((c) => { config = c; }).catch(() => {}).finally(greet);
if (synth) synth.getVoices(); // warm up the voice list
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
