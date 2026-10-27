// Optional Google Drive sync (no dependencies). Uploads each session's Markdown file to one Drive folder.
// Auth: service account (GOOGLE_SERVICE_ACCOUNT_JSON) or OAuth refresh token. If neither is configured, it's a no-op.
import fs from 'node:fs';
import crypto from 'node:crypto';
import * as sessions from './sessions.js';

const env = process.env;
const FOLDER = env.GOOGLE_DRIVE_FOLDER_ID;
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

function serviceAccount() {
  const v = env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!v) return null;
  try { return JSON.parse(v.trim().startsWith('{') ? v : fs.readFileSync(v, 'utf8')); }
  catch (e) { console.warn('[drive] cannot read service account JSON:', e.message); return null; }
}
const sa = serviceAccount();
const oauth = env.GOOGLE_OAUTH_CLIENT_ID && env.GOOGLE_OAUTH_CLIENT_SECRET && env.GOOGLE_OAUTH_REFRESH_TOKEN;

export const driveEnabled = () => Boolean(FOLDER && (sa || oauth));
export const status = { enabled: driveEnabled(), mode: sa ? 'service-account' : oauth ? 'oauth' : null, lastSync: null, lastError: null };

let token = { value: null, exp: 0 };
async function accessToken() {
  if (token.value && Date.now() < token.exp - 60000) return token.value;
  let body;
  if (sa) {
    const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const now = Math.floor(Date.now() / 1000);
    const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({
      iss: sa.client_email, scope: 'https://www.googleapis.com/auth/drive', aud: TOKEN_URL, iat: now, exp: now + 3600,
    })}`;
    const sig = crypto.sign('RSA-SHA256', Buffer.from(unsigned), sa.private_key).toString('base64url');
    body = new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${sig}` });
  } else {
    body = new URLSearchParams({
      grant_type: 'refresh_token', client_id: env.GOOGLE_OAUTH_CLIENT_ID,
      client_secret: env.GOOGLE_OAUTH_CLIENT_SECRET, refresh_token: env.GOOGLE_OAUTH_REFRESH_TOKEN,
    });
  }
  const res = await fetch(TOKEN_URL, { method: 'POST', body, signal: AbortSignal.timeout(10000) });
  const j = await res.json();
  if (!res.ok) throw new Error(`token: ${j.error_description || j.error || res.status}`);
  token = { value: j.access_token, exp: Date.now() + j.expires_in * 1000 };
  return token.value;
}

const fileIds = new Map(); // file name -> Drive file id
async function api(url, init = {}) {
  const res = await fetch(url, {
    ...init, signal: AbortSignal.timeout(20000),
    headers: { authorization: `Bearer ${await accessToken()}`, ...init.headers },
  });
  if (!res.ok) throw new Error(`Drive ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

async function findId(name) {
  if (fileIds.has(name)) return fileIds.get(name);
  const q = `name='${name.replace(/'/g, "\\'")}' and '${FOLDER}' in parents and trashed=false`;
  const j = await api('https://www.googleapis.com/drive/v3/files?supportsAllDrives=true&includeItemsFromAllDrives=true&fields=files(id)&q=' + encodeURIComponent(q));
  const id = j.files?.[0]?.id;
  if (id) fileIds.set(name, id);
  return id;
}

async function upsert(name, text) {
  const id = await findId(name);
  if (id) {
    await api(`https://www.googleapis.com/upload/drive/v3/files/${id}?uploadType=media&supportsAllDrives=true`, {
      method: 'PATCH', headers: { 'content-type': 'text/markdown; charset=utf-8' }, body: text,
    });
    return;
  }
  const boundary = 'sparky' + crypto.randomUUID();
  const meta = JSON.stringify({ name, parents: [FOLDER], mimeType: 'text/markdown' });
  const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n` +
    `--${boundary}\r\nContent-Type: text/markdown; charset=UTF-8\r\n\r\n${text}\r\n--${boundary}--`;
  const j = await api('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id', {
    method: 'POST', headers: { 'content-type': `multipart/related; boundary=${boundary}` }, body,
  });
  fileIds.set(name, j.id);
}

async function syncOne(s) {
  try {
    await upsert(sessions.mdFileName(s), sessions.toMarkdown(s));
    status.lastSync = new Date().toISOString();
    status.lastError = null;
  } catch (e) {
    status.lastError = e.message;
    console.warn('[drive] sync failed:', e.message);
    throw e;
  }
}

const timers = new Map();
/** Debounced background sync of one session (after each chat turn). Safe to call when Drive isn't configured. */
export function scheduleSync(id) {
  if (!driveEnabled()) return;
  clearTimeout(timers.get(id));
  timers.set(id, setTimeout(() => {
    timers.delete(id);
    const s = sessions.get(id);
    if (s) syncOne(s).catch(() => {});
  }, 5000));
}

/** Sync every session now. Returns {synced, failed}. */
export async function syncAll() {
  if (!driveEnabled()) return { synced: 0, failed: 0, enabled: false };
  let synced = 0, failed = 0;
  for (const s of sessions.all()) {
    try { await syncOne(s); synced++; } catch { failed++; }
  }
  return { synced, failed, enabled: true };
}
