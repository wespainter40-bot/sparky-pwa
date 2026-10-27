// Settings sheet (voice, look, hands-free, memory) and history sheet. All state lives in the small modules; this file is only UI.
import * as V from './voice.js';
import * as T from './themes.js';
import * as M from './memory.js';
import * as H from './history.js';
import * as N from './night.js';
import * as Nar from './narrate.js';
import * as Tp from './topics.js';
import * as VL from './voicelog.js';
import { Listener, explain, normLang } from './listen.js';

const $ = (s) => document.querySelector(s);
const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) { if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (v !== false && v != null) e.setAttribute(k, v === true ? '' : v); }
  e.append(...kids.filter((k) => k != null));
  return e;
};
function openDlg(d) { if (!d.open) d.showModal(); }
function sheetBehaviour(d, closeBtn) {
  closeBtn.addEventListener('click', () => d.close());
  d.addEventListener('click', (e) => { if (e.target === d) d.close(); }); // tap the dim backdrop to close
}

// ---------------------------------------------------------------- settings
export function initSettings(ctx) {
  const dlg = $('#settingsDlg');
  sheetBehaviour(dlg, $('#settingsClose'));
  const voiceSel = $('#voiceSel'), pitch = $('#pitch'), rate = $('#rate'), volume = $('#volume');
  let vs = ctx.voiceSettings();

  const fmt = (v) => `${(+v).toFixed(2).replace(/0$/, '')}x`;
  function paintSliders() {
    pitch.value = vs.pitch; rate.value = vs.rate; volume.value = vs.volume;
    $('#pitchVal').textContent = fmt(vs.pitch); $('#rateVal').textContent = fmt(vs.rate); $('#volumeVal').textContent = `${Math.round(vs.volume * 100)}%`;
    for (const [i, id] of [[pitch, 'pitch'], [rate, 'rate'], [volume, 'volume']]) { const [a, b] = V.LIMITS[id]; i.style.setProperty('--fill', `${((i.value - a) / (b - a)) * 100}%`); }
  }
  function commit(patch, { persona = false } = {}) {
    vs = { ...vs, ...patch }; if (!persona && !('persona' in patch)) vs.persona = ''; // fine-tuning leaves "custom"
    ctx.setVoiceSettings(vs); paintSliders(); paintPersonas();
  }

  // personas
  const pBox = $('#personas');
  function paintPersonas() {
    pBox.replaceChildren(...V.PERSONAS.map((p) => el('button', {
      type: 'button', class: 'chip' + (vs.persona === p.id ? ' on' : ''), role: 'radio', 'aria-checked': String(vs.persona === p.id), 'data-persona': p.id,
      onclick: () => {
        const v = ctx.voices.forPersona(p);
        commit({ persona: p.id, pitch: p.pitch, rate: p.rate, ...(v ? { voiceURI: V.keyOf(v) } : (p.id === 'friendly' ? { voiceURI: '' } : {})) }, { persona: true });
        paintVoices(); ctx.preview();
      },
    }, el('span', { class: 'chip-ico', 'aria-hidden': 'true' }, p.icon), el('span', { class: 'chip-t' }, el('b', {}, p.label), el('small', {}, p.note)))));
  }

  // voices
  function paintVoices() {
    const list = ctx.voices.sorted();
    voiceSel.replaceChildren();
    if (!ctx.voices.supported) { voiceSel.append(el('option', { value: '' }, 'Voice is not supported here')); voiceSel.disabled = true; $('#voicePreview').disabled = true; $('#voiceNote').textContent = 'This browser cannot speak out loud, so Sparky will only write. Try Chrome, Edge or Safari.'; return; }
    if (!list.length) {
      voiceSel.append(el('option', { value: '' }, 'Loading voices...')); voiceSel.disabled = true;
      $('#voiceNote').textContent = 'No voices found yet. Sparky will use the device\'s normal voice. They can take a moment to appear.';
      return;
    }
    voiceSel.disabled = false;
    const cur = ctx.voices.resolve(vs), curKey = cur ? V.keyOf(cur) : '';
    const opt = (v) => el('option', { value: V.keyOf(v), ...(V.keyOf(v) === curKey ? { selected: true } : {}) }, V.friendlyName(v) + (v.default ? ' (default)' : ''));
    const best = list.filter((v) => V.score(v) > 0), rest = list.filter((v) => V.score(v) === 0);
    if (best.length && rest.length) {
      voiceSel.append(el('optgroup', { label: 'Best sounding' }, ...best.map(opt)), el('optgroup', { label: 'More voices' }, ...rest.map(opt)));
    } else voiceSel.append(...list.map(opt));
    voiceSel.value = curKey;
    const eng = list.some((v) => /^en/i.test(v.lang));
    $('#voiceNote').textContent = `${list.length} voice${list.length === 1 ? '' : 's'} on this device${eng ? '' : ' (no English voices found, showing all)'}. Every phone and computer has its own list.`;
  }
  voiceSel.addEventListener('change', () => { commit({ voiceURI: voiceSel.value }); ctx.preview(); });
  ctx.voices.onChange(paintVoices);
  let pt; // sliders: live values while dragging, a short sample when released
  for (const [inp, key] of [[pitch, 'pitch'], [rate, 'rate'], [volume, 'volume']]) {
    inp.addEventListener('input', () => commit({ [key]: +inp.value }));
    inp.addEventListener('change', () => { clearTimeout(pt); pt = setTimeout(ctx.preview, 60); });
  }
  $('#voicePreview').addEventListener('click', () => ctx.preview());
  $('#voiceReset').addEventListener('click', () => { vs = { ...V.resetSettings(), lang: vs.lang }; ctx.setVoiceSettings(vs, true); paintSliders(); paintPersonas(); paintVoices(); ctx.toast('Voice reset to Friendly Sparky'); });

  // look
  const modes = $('#modes'), acc = $('#accents');
  function paintLook() {
    const t = T.current();
    modes.replaceChildren(...Object.entries(T.MODES).map(([id, m]) => el('button', {
      type: 'button', role: 'radio', 'aria-checked': String(t.mode === id), class: 'seg-btn' + (t.mode === id ? ' on' : ''), 'data-mode': id,
      onclick: () => { ctx.setTheme({ mode: id }); paintLook(); },
    }, m.label)));
    acc.replaceChildren(...Object.entries(T.ACCENTS).map(([id, a]) => el('button', {
      type: 'button', role: 'radio', 'aria-checked': String(t.accent === id), 'aria-label': a.label, title: a.label, class: 'swatch' + (t.accent === id ? ' on' : ''), 'data-accent': id,
      style: `--sw:${a.hex}`, onclick: () => { ctx.setTheme({ accent: id }); paintLook(); },
    }, el('span', { class: 'sw-name' }, a.label))));
  }

  // night light + narration
  const sw = (btn, on) => btn.setAttribute('aria-checked', String(on));
  const nf = $('#nightFrom'), nt = $('#nightTo');
  for (const s of [nf, nt]) for (let h = 0; h < 24; h++) s.append(el('option', { value: String(h) }, N.hourLabel(h)));
  function paintNight() {
    const s = N.settings();
    sw($('#nightToggle'), N.active()); sw($('#nightAuto'), s.auto);
    nf.value = String(s.from); nt.value = String(s.to);
    $('#nightAutoSub').textContent = `Every day from ${N.hourLabel(s.from)} to ${N.hourLabel(s.to)}`;
    nf.disabled = nt.disabled = !s.auto;
  }
  $('#nightToggle').addEventListener('click', () => { ctx.toggleNight(); paintNight(); });
  $('#nightAuto').addEventListener('click', () => { ctx.setNight({ auto: !N.settings().auto }); paintNight(); });
  nf.addEventListener('change', () => { ctx.setNight({ from: +nf.value }); paintNight(); });
  nt.addEventListener('change', () => { ctx.setNight({ to: +nt.value }); paintNight(); });
  ctx.refreshNight = paintNight;
  function paintNarr() { const s = Nar.settings(); sw($('#narrToggle'), s.on); sw($('#narrSpeak'), s.on && s.speak); $('#narrSpeak').disabled = !s.on; }
  $('#narrToggle').addEventListener('click', () => { Nar.set({ on: !Nar.settings().on }); paintNarr(); ctx.narrationChanged(); });
  $('#narrSpeak').addEventListener('click', () => { Nar.set({ speak: !Nar.settings().speak }); paintNarr(); });

  // hands-free
  const wakeBtn = $('#wakeToggle');
  function paintWake(status = ctx.wake.status, detail) {
    const on = ctx.wake.on;
    wakeBtn.setAttribute('aria-checked', String(on));
    wakeBtn.disabled = !ctx.wake.supported;
    const sub = !ctx.wake.supported ? 'Not supported in this browser'
      : status === 'blocked' ? (detail || 'Microphone is blocked. Allow it in the browser settings, then try again.')
      : status === 'error' ? (detail || 'Something went wrong. Try turning it off and on.')
      : on ? (status === 'listening' ? 'Listening for "Hey Sparky" right now' : 'On. Listening again when Sparky is free') : 'Say "Hey Sparky" to talk without tapping';
    $('#wakeSub').textContent = sub;
  }
  wakeBtn.addEventListener('click', () => {
    if (ctx.wake.on) { ctx.wake.disable(); ctx.toast('Hey Sparky is off'); } else if (ctx.wake.enable()) ctx.toast('Hey Sparky is on. Allow the microphone if asked.');
    paintWake();
  });
  ctx.onWakeStatus.add((st, d) => { paintWake(st, d); paintDiag(); });

  // ---- voice diagnostics ----
  const diagInfo = $('#diagInfo'), dmsg = $('#diagMsg'), bar = $('#diagMeter');
  const browserName = () => {
    const ua = navigator.userAgent, b = navigator.userAgentData?.brands?.map((x) => x.brand + ' ' + x.version).filter((x) => !/Not.?A.?Brand/i.test(x)) || [];
    const nm = navigator.brave ? 'Brave' : /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Unknown';
    const ver = (/(?:Edg|OPR|Firefox|Chrome|Version)\/([\d.]+)/.exec(ua) || [])[1] || '';
    const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iP(hone|ad|od)/.test(ua) ? 'iOS' : /Mac/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '';
    return `${nm} ${ver.split('.')[0]}${os ? ' on ' + os : ''}${b.length && nm === 'Unknown' ? ' (' + b[0] + ')' : ''}`;
  };
  const row = (k, v, cls = '') => el('div', {}, el('dt', {}, k), el('dd', { class: cls }, v));
  function paintDiag() {
    if (!dlg.open) return;
    const SRc = ctx.SR, perm = ctx.micCtx().perm, last = VL.lastInfo(), cur = ctx.voices.resolve(ctx.voiceSettings());
    const fw = last.firstWordMs != null ? `${(last.firstWordMs / 1000).toFixed(1)} s` : null, ft = last.firstTokenMs != null ? `${(last.firstTokenMs / 1000).toFixed(1)} s` : null;
    diagInfo.replaceChildren(
      row('Speech recognition', SRc ? `Available (${window.SpeechRecognition ? 'SpeechRecognition' : 'webkitSpeechRecognition'})` : 'Not available in this browser', SRc ? 'good' : 'bad'),
      row('Speech output', ctx.voices.supported ? `Available, ${ctx.voices.all.length} voice${ctx.voices.all.length === 1 ? '' : 's'}${cur ? ' (using ' + V.friendlyName(cur) + ')' : ''}` : 'Not available', ctx.voices.supported ? 'good' : 'bad'),
      row('Microphone permission', perm || 'unknown (the browser will ask)', perm === 'granted' ? 'good' : perm === 'denied' ? 'bad' : 'warn'),
      row('Secure page (https)', window.isSecureContext ? 'yes' : 'NO: voice needs https', window.isSecureContext ? 'good' : 'bad'),
      row('Listening language', normLang(ctx.recLang())),
      row('Wake word', ctx.wake.supported ? (ctx.wake.on ? ctx.wake.status : 'off') : 'not supported', ctx.wake.status === 'error' || ctx.wake.status === 'blocked' ? 'bad' : ''),
      row('Browser', browserName()),
      row('Last error', last.error ? `${last.error.msg} (${VL.clock(last.error.t)})` : 'none', last.error ? 'bad' : 'good'),
      row('Last reply speed', fw ? `first words after ${fw}${ft ? ` (answer text after ${ft})` : ''}` : 'no reply yet'),
    );
    $('#diagLog').replaceChildren(...(VL.events().length ? VL.events().slice().reverse().map((e) => el('li', { class: e.level }, el('time', {}, VL.clock(e.t)), el('span', { class: 'k' }, e.kind), el('span', { class: 'm' }, e.msg))) : [el('li', {}, el('span', { class: 'm' }, 'Nothing yet. Try a test above or talk to Sparky.'))]));
  }
  VL.onChange(paintDiag);
  ctx.refreshDiag = paintDiag;
  const lang = $('#recLang');
  for (const [code, name] of V.LANGS) lang.append(el('option', { value: code }, name));
  lang.addEventListener('change', () => { commit({ lang: lang.value }, { persona: true }); paintDiag(); VL.log('listen', `language set to ${normLang(ctx.recLang())}`); });
  $('#meterToggle').addEventListener('click', () => {
    const on = localStorage.getItem('sparkyMeter') !== '1';
    if (on) localStorage.setItem('sparkyMeter', '1'); else localStorage.removeItem('sparkyMeter');
    localStorage.removeItem('sparkyNoMeter');
    $('#meterToggle').setAttribute('aria-checked', String(on));
  });
  const micMsg = (e) => ({
    NotAllowedError: 'Microphone blocked. Click the lock icon in the address bar, set Microphone to Allow, then test again.',
    SecurityError: 'Microphone blocked. Click the lock icon in the address bar, set Microphone to Allow, then test again.',
    NotFoundError: 'No microphone found. Plug one in or pick one in your system Sound settings.',
    NotReadableError: 'The microphone is busy or unavailable. Close other apps that use it (Teams, Zoom, Discord) and test again.',
    OverconstrainedError: 'The chosen microphone is not available. Pick another in your system Sound settings.',
  }[e && e.name] || `Could not open the microphone (${(e && (e.name || e.message)) || 'unknown'}).`);
  let stopTest = null;
  const busyBtns = (on, except) => ['#diagMic', '#diagListen', '#diagVoice'].forEach((id) => { const b = $(id); b.disabled = on && b !== except; });
  $('#diagMic').addEventListener('click', async () => {
    const btn = $('#diagMic');
    if (stopTest) return stopTest();
    if (!navigator.mediaDevices?.getUserMedia) { dmsg.textContent = 'This browser cannot open the microphone here (it needs https).'; VL.log('mic', 'getUserMedia not available', 'error'); return; }
    ctx.pauseVoice(); busyBtns(true, btn); dmsg.textContent = 'Opening the microphone... allow it if asked.';
    let stream, ac, raf, timer, peak = 0;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch (e) { const m = micMsg(e); dmsg.textContent = m; VL.log('mic', `test failed: ${e.name || e.message}`, 'error'); busyBtns(false); ctx.resumeVoice(); return; }
    const track = stream.getAudioTracks()[0], label = track?.label || 'default microphone';
    VL.log('mic', `opened "${label}"`);
    const AC = window.AudioContext || window.webkitAudioContext; ac = new AC();
    const an = ac.createAnalyser(); an.fftSize = 512; ac.createMediaStreamSource(stream).connect(an);
    const buf = new Uint8Array(512), t0 = performance.now();
    btn.textContent = 'Stop test'; btn.disabled = false;
    const tick = () => {
      an.getByteTimeDomainData(buf); let s = 0; for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; s += v * v; }
      const lv = Math.min(1, Math.sqrt(s / buf.length) * 6); peak = Math.max(peak, lv); bar.style.width = `${Math.round(lv * 100)}%`;
      const left = Math.max(0, 8 - (performance.now() - t0) / 1000);
      dmsg.textContent = `Say something. "${label}" is listening... ${left.toFixed(0)}s`;
      raf = requestAnimationFrame(tick);
    };
    tick();
    stopTest = () => {
      cancelAnimationFrame(raf); clearTimeout(timer); stream.getTracks().forEach((t) => t.stop()); ac.close().catch(() => {});
      bar.style.width = '0'; btn.textContent = 'Test microphone'; stopTest = null; busyBtns(false);
      const pc = Math.round(peak * 100);
      dmsg.textContent = peak > 0.08 ? `Microphone works: "${label}" (loudest ${pc}%).` : `The microphone opened but I heard almost nothing (loudest ${pc}%). It may be muted, too quiet, or not the one you speak into. Check the Windows/macOS Sound input settings.`;
      VL.log('mic', `test ended, peak ${pc}%`, peak > 0.08 ? 'info' : 'warn'); ctx.resumeVoice();
    };
    timer = setTimeout(() => stopTest && stopTest(), 8000);
  });
  $('#diagListen').addEventListener('click', () => {
    const btn = $('#diagListen');
    if (btn._l) { btn._l.stop('tap'); return; }
    if (!ctx.SR) { dmsg.textContent = explain('unsupported'); return; }
    ctx.pauseVoice(); busyBtns(true, btn); btn.textContent = 'Stop'; dmsg.textContent = 'Say something, like "hello Sparky"...';
    const end = () => { btn._l = null; btn.textContent = 'Test listening'; busyBtns(false); ctx.resumeVoice(); };
    const l = new Listener({
      SR: ctx.SR, lang: ctx.recLang, log: (k, m, lv) => VL.log(k, m, lv), ctx: ctx.micCtx,
      onInterim: (t) => { dmsg.textContent = `Hearing: "${t}"`; },
      onError: (code, msg) => { dmsg.textContent = msg; },
      onDone: (text, reason) => { if (text) { dmsg.textContent = `Heard: "${text}". Listening works!`; VL.note({ heard: text }); } else if (reason !== 'error') dmsg.textContent = reason === 'nothing' ? 'The mic detected sound but no words. Try speaking more clearly or closer.' : 'Heard nothing. Check the microphone test above.'; end(); },
    });
    btn._l = l; l.start();
  });
  $('#diagVoice').addEventListener('click', () => { dmsg.textContent = 'Playing a test sentence... you should hear Sparky now.'; ctx.testVoice(); });
  $('#diagCopy').addEventListener('click', async () => {
    const txt = `Sparky voice log\n${browserName()}\n${VL.asText()}`;
    try { await navigator.clipboard.writeText(txt); ctx.toast('Log copied'); } catch { ctx.toast('Could not copy. Select the text instead.'); }
  });
  $('#diagClear').addEventListener('click', () => VL.clear());
  $('#diagWake').addEventListener('click', () => { if (!ctx.wake.on) { ctx.toast('Turn on Hey Sparky first (Hands-free above).'); return; } ctx.wake.retryNow(); ctx.toast('Trying the wake word again'); });
  ctx.setDiagMsg = (m) => { dmsg.textContent = m; };

  // memory
  const list = $('#memList');
  function paintMem() {
    const d = M.get();
    const rows = [];
    rows.push(memRow('name-row', 'Name', d.name, (v) => { const n = M.setName(v); if (!n && v.trim()) ctx.toast('Just a first name, please (letters only).'); paintMem(); ctx.memoryChanged(); }, d.name ? () => { M.setName(''); paintMem(); ctx.memoryChanged(); } : null, 'Your first name'));
    for (const it of d.items) rows.push(memRow('', '', it.text, (v) => { if (v.trim()) M.update(it.id, v); else M.remove(it.id); paintMem(); ctx.memoryChanged(); }, () => { M.remove(it.id); paintMem(); ctx.memoryChanged(); }));
    if (!d.items.length && !d.name) rows.push(el('li', { class: 'mem-empty' }, 'Nothing yet. Tell Sparky "my name is..." or "I like..." and it will remember!'));
    list.replaceChildren(...rows);
  }
  function memRow(cls, label, value, onSave, onDelete, ph = '') {
    const inp = el('input', { type: 'text', maxlength: '80', value, placeholder: ph || 'Edit', 'aria-label': label ? `${label}` : `Remembered: ${value}`, class: 'mem-in' });
    inp.addEventListener('change', () => onSave(inp.value));
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); inp.blur(); } });
    return el('li', { class: 'mem-row ' + cls }, label ? el('span', { class: 'mem-label' }, label) : null, inp,
      onDelete ? el('button', { type: 'button', class: 'icon-btn mini', 'aria-label': 'Forget this', onclick: onDelete }, trash()) : null);
  }
  $('#memForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const inp = $('#memInput'), v = inp.value.trim(); if (!v) return;
    const r = M.learn(v); // "my name is Sam" / "I like cats" typed here work too
    if (!r.name && !r.added.length && !M.add(v)) ctx.toast("I can't save that one. Try something short and simple.");
    inp.value = ''; paintMem(); ctx.memoryChanged();
  });

  // favorite topics
  const tList = $('#topicList');
  const iconBtn = (cls, label, d, on, fn) => {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 24 24');
    const pa = document.createElementNS('http://www.w3.org/2000/svg', 'path'); pa.setAttribute('d', d); s.append(pa);
    return el('button', { type: 'button', class: `icon-btn mini ${cls}${on ? ' on' : ''}`, 'aria-label': label, 'aria-pressed': String(!!on), title: label, onclick: fn }, s);
  };
  function paintTopics() {
    const items = Tp.list();
    if (!items.length) { tList.replaceChildren(el('li', { class: 'mem-empty' }, 'No favorites yet. Chat with Sparky and the things you ask about most will show up here.')); return; }
    tList.replaceChildren(...items.slice(0, 20).map((x) => {
      const inp = el('input', { type: 'text', maxlength: '30', value: x.t, class: 'mem-in', 'aria-label': `Topic: ${x.t}` });
      inp.addEventListener('change', () => { if (!Tp.rename(x.t, inp.value) && inp.value.trim() && inp.value !== x.t) ctx.toast('Short words only, please.'); paintTopics(); ctx.memoryChanged(); });
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); inp.blur(); } });
      return el('li', { class: 'mem-row topic' + (x.hidden ? ' hid' : ''), 'data-topic': x.t }, inp, el('span', { class: 'topic-count', title: 'times mentioned' }, `${x.n}x`),
        iconBtn('pin', x.pinned ? 'Unpin' : 'Pin this topic', 'M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 16.9l-5.2 2.8 1-5.9L3.5 9.7l5.9-.8L12 3.5z', x.pinned, () => { Tp.toggle(x.t, 'pinned'); paintTopics(); ctx.memoryChanged(); }),
        iconBtn('hide', x.hidden ? 'Show this topic again' : 'Hide this topic', x.hidden ? 'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12zM12 9.2a2.8 2.8 0 1 0 0 5.6 2.8 2.8 0 0 0 0-5.6z' : 'M3 3l18 18M10.6 6a9 9 0 0 1 1.4-.1c6 0 9.5 6.1 9.5 6.1a16 16 0 0 1-3.1 3.8M6.6 7.7A16 16 0 0 0 2.5 12S6 18.5 12 18.5c1.5 0 2.8-.4 4-.9', x.hidden, () => { Tp.toggle(x.t, 'hidden'); paintTopics(); ctx.memoryChanged(); }),
        el('button', { type: 'button', class: 'icon-btn mini', 'aria-label': 'Remove topic', title: 'Remove topic', onclick: () => { Tp.remove(x.t); paintTopics(); ctx.memoryChanged(); } }, trash()));
    }));
  }

  // confirm bar (no browser popups)
  const cbar = $('#settingsConfirm');
  let pending = null;
  const ask = (msg, fn) => { pending = fn; $('#settingsConfirmMsg').textContent = msg; cbar.hidden = false; $('#settingsConfirmNo').focus(); };
  $('#settingsConfirmYes').addEventListener('click', () => { cbar.hidden = true; pending?.(); pending = null; });
  $('#settingsConfirmNo').addEventListener('click', () => { cbar.hidden = true; pending = null; });
  $('#memForget').addEventListener('click', () => ask('Forget everything Sparky knows about you?', () => { M.forgetAll(); Tp.forgetAll(); paintMem(); paintTopics(); ctx.memoryChanged(); ctx.toast('All forgotten'); }));
  $('#exportBtn').addEventListener('click', () => { dlg.close(); ctx.openExport(); });
  dlg.addEventListener('close', () => { cbar.hidden = true; pending = null; });

  $('#settingsBtn').addEventListener('click', () => {
    vs = ctx.voiceSettings(); paintSliders(); paintPersonas(); paintVoices(); paintLook(); paintNight(); paintNarr(); paintWake(); paintMem(); paintTopics();
    lang.value = vs.lang || ''; $('#meterToggle').setAttribute('aria-checked', String(localStorage.getItem('sparkyMeter') === '1'));
    openDlg(dlg); paintDiag();
  });
  ctx.refreshSettings = () => { vs = ctx.voiceSettings(); paintSliders(); paintPersonas(); paintVoices(); paintMem(); paintTopics(); };
}
const trash = () => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 24 24'); const p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', 'M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12M10.5 11v5M13.5 11v5'); s.append(p); return s; };

// ---------------------------------------------------------------- history
export function initHistory(ctx) {
  const dlg = $('#histDlg'), listV = $('#histListView'), detV = $('#histDetailView'), back = $('#histBack');
  sheetBehaviour(dlg, $('#histClose'));
  let openId = null;
  const cbar = $('#histConfirm'); let pending = null;
  const ask = (msg, yes, fn) => { pending = fn; $('#histConfirmMsg').textContent = msg; $('#histConfirmYes').textContent = yes; cbar.hidden = false; $('#histConfirmNo').focus(); };
  $('#histConfirmYes').addEventListener('click', () => { cbar.hidden = true; pending?.(); pending = null; });
  $('#histConfirmNo').addEventListener('click', () => { cbar.hidden = true; pending = null; });

  function showList() {
    openId = null; listV.hidden = false; detV.hidden = true; back.hidden = true; $('#histTitle').textContent = 'Chat history';
    const q = $('#histSearch').value, items = H.search(q), ul = $('#histList');
    ul.replaceChildren(...items.map((c) => {
      const sub = q.trim() ? matchSnippet(c, q) : '';
      return el('li', {}, el('button', { type: 'button', class: 'hist-item', 'data-id': c.id, onclick: () => showDetail(c.id) },
        el('span', { class: 'hist-t' }, H.title(c)),
        sub ? el('span', { class: 'hist-snip' }, sub) : null,
        el('span', { class: 'hist-m' }, `${H.when(c.updated)}  ·  ${c.msgs.length} message${c.msgs.length === 1 ? '' : 's'}`)));
    }));
    const empty = $('#histEmpty');
    empty.hidden = items.length > 0;
    empty.textContent = q.trim() ? 'No chats match that.' : 'No chats yet. Talk to Sparky and your chats will show up here.';
    $('#histClearAll').disabled = !H.all().length;
  }
  function matchSnippet(c, q) {
    const ql = q.trim().toLowerCase(), m = c.msgs.find((x) => x.t.toLowerCase().includes(ql));
    if (!m) return '';
    const i = m.t.toLowerCase().indexOf(ql), a = Math.max(0, i - 24);
    return (a ? '...' : '') + m.t.slice(a, i + ql.length + 40).replace(/\s+/g, ' ') + (i + ql.length + 40 < m.t.length ? '...' : '');
  }
  function showDetail(id) {
    const c = H.get(id); if (!c) return showList();
    openId = id; listV.hidden = true; detV.hidden = false; back.hidden = false; $('#histTitle').textContent = 'Chat';
    $('#histMeta').textContent = `${H.when(c.started)}  ·  ${c.msgs.length} message${c.msgs.length === 1 ? '' : 's'}`;
    $('#histTranscript').replaceChildren(...c.msgs.map((m) => el('div', { class: 'tmsg ' + (m.r === 'u' ? 'me' : 'sp') }, el('span', { class: 'who' }, m.r === 'u' ? 'You' : 'Sparky'), el('span', { class: 't' }, m.t))));
    $('#histTranscript').scrollTop = 0;
  }
  back.addEventListener('click', showList);
  $('#histSearch').addEventListener('input', showList);
  $('#histContinue').addEventListener('click', () => { if (openId) { ctx.continueChat(openId); dlg.close(); } });
  $('#histDelete').addEventListener('click', () => { const id = openId; ask('Delete this chat from this device?', 'Yes, delete', () => { H.remove(id); showList(); ctx.toast('Chat deleted'); }); });
  $('#histClearAll').addEventListener('click', () => ask('Delete ALL chats from this device?', 'Yes, delete all', () => { H.clear(); showList(); ctx.toast('History cleared'); }));
  $('#histExport').addEventListener('click', () => { dlg.close(); ctx.openExport(); });
  dlg.addEventListener('close', () => { cbar.hidden = true; pending = null; });
  $('#histBtn').addEventListener('click', () => { $('#histSearch').value = ''; showList(); openDlg(dlg); });
}
