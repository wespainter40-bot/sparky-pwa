// Settings sheet (voice, look, hands-free, memory) and history sheet. All state lives in the small modules; this file is only UI.
import * as V from './voice.js';
import * as T from './themes.js';
import * as M from './memory.js';
import * as H from './history.js';

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
  const voiceSel = $('#voiceSel'), pitch = $('#pitch'), rate = $('#rate');
  let vs = ctx.voiceSettings();

  const fmt = (v) => `${(+v).toFixed(2).replace(/0$/, '')}x`;
  function paintSliders() {
    pitch.value = vs.pitch; rate.value = vs.rate;
    $('#pitchVal').textContent = fmt(vs.pitch); $('#rateVal').textContent = fmt(vs.rate);
    for (const [i, id] of [[pitch, 'pitch'], [rate, 'rate']]) { const [a, b] = V.LIMITS[id]; i.style.setProperty('--fill', `${((i.value - a) / (b - a)) * 100}%`); }
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
  for (const [inp, key] of [[pitch, 'pitch'], [rate, 'rate']]) {
    inp.addEventListener('input', () => commit({ [key]: +inp.value }));
    inp.addEventListener('change', () => { clearTimeout(pt); pt = setTimeout(ctx.preview, 60); });
  }
  $('#voicePreview').addEventListener('click', () => ctx.preview());
  $('#voiceReset').addEventListener('click', () => { vs = V.resetSettings(); ctx.setVoiceSettings(vs, true); paintSliders(); paintPersonas(); paintVoices(); ctx.toast('Voice reset to Friendly Sparky'); });

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

  // hands-free
  const wakeBtn = $('#wakeToggle');
  function paintWake(status = ctx.wake.status, detail) {
    const on = ctx.wake.on;
    wakeBtn.setAttribute('aria-checked', String(on));
    wakeBtn.disabled = !ctx.wake.supported;
    const sub = !ctx.wake.supported ? 'Not supported in this browser'
      : status === 'blocked' ? 'Microphone is blocked. Allow it in the browser settings, then try again.'
      : status === 'error' ? (detail || 'Something went wrong. Try turning it off and on.')
      : on ? (status === 'listening' ? 'Listening for "Hey Sparky" right now' : 'On. Listening again when Sparky is free') : 'Say "Hey Sparky" to talk without tapping';
    $('#wakeSub').textContent = sub;
  }
  wakeBtn.addEventListener('click', () => {
    if (ctx.wake.on) { ctx.wake.disable(); ctx.toast('Hey Sparky is off'); } else if (ctx.wake.enable()) ctx.toast('Hey Sparky is on. Allow the microphone if asked.');
    paintWake();
  });
  ctx.onWakeStatus.add(paintWake);

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

  // confirm bar (no browser popups)
  const cbar = $('#settingsConfirm');
  let pending = null;
  const ask = (msg, fn) => { pending = fn; $('#settingsConfirmMsg').textContent = msg; cbar.hidden = false; $('#settingsConfirmNo').focus(); };
  $('#settingsConfirmYes').addEventListener('click', () => { cbar.hidden = true; pending?.(); pending = null; });
  $('#settingsConfirmNo').addEventListener('click', () => { cbar.hidden = true; pending = null; });
  $('#memForget').addEventListener('click', () => ask('Forget everything Sparky knows about you?', () => { M.forgetAll(); paintMem(); ctx.memoryChanged(); ctx.toast('All forgotten'); }));
  $('#exportBtn').addEventListener('click', () => { dlg.close(); ctx.openExport(); });
  dlg.addEventListener('close', () => { cbar.hidden = true; pending = null; });

  $('#settingsBtn').addEventListener('click', () => {
    vs = ctx.voiceSettings(); paintSliders(); paintPersonas(); paintVoices(); paintLook(); paintWake(); paintMem();
    openDlg(dlg);
  });
  ctx.refreshSettings = () => { vs = ctx.voiceSettings(); paintSliders(); paintPersonas(); paintVoices(); paintMem(); };
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
