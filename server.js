import './src/env.js';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { streamReply, providerNames } from './src/providers.js';
import { lookup } from './src/search.js';
import { buildMessages } from './src/prompt.js';
import * as sessions from './src/sessions.js';
import * as drive from './src/drive.js';
import { makeZip } from './src/zip.js';

const PORT = Number(process.env.PORT) || 3000;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

// ---------- helpers ----------
const send = (res, code, body, type = 'application/json', extra = {}) => {
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store', ...extra });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
};
const sendJson = (res, code, obj) => send(res, code, JSON.stringify(obj, null, 2));

function readJson(req, limit = 16 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString() || '{}')); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

// Admin routes (list/export/sync) need ADMIN_TOKEN when it is set. Set it whenever the app is public.
function isAdmin(req, url) {
  if (!ADMIN_TOKEN) return true;
  const bearer = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  return [bearer, req.headers['x-admin-token'], url.searchParams.get('token')].includes(ADMIN_TOKEN);
}

const hits = new Map(); // simple per-IP rate limit: 30 chats / minute
function rateLimited(req) {
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').toString().split(',')[0].trim();
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < 60000);
  recent.push(now); hits.set(ip, recent);
  if (hits.size > 5000) hits.clear();
  return recent.length > 30;
}

// ---------- chat ----------
async function handleChat(req, res) {
  let body;
  try { body = await readJson(req); } catch { return sendJson(res, 400, { error: 'Bad JSON' }); }
  const sessionId = String(body.sessionId || '');
  const message = String(body.message || '').trim().slice(0, 1000);
  const source = body.source === 'voice' ? 'voice' : 'text';
  if (!sessions.ID_RE.test(sessionId)) return sendJson(res, 400, { error: 'sessionId must be 8-64 chars [A-Za-z0-9_-]' });
  if (!message) return sendJson(res, 400, { error: 'message is required' });
  if (rateLimited(req)) return sendJson(res, 429, { error: 'Too many messages, slow down a little!' });

  const history = sessions.getContext(sessionId);
  sessions.append(sessionId, { role: 'user', text: message, source });

  const streaming = body.stream !== false;
  if (streaming) res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', 'x-accel-buffering': 'no' });
  const emit = (event, data) => streaming && res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  const facts = await lookup(message);
  let reply = '', provider = 'local', aborted = false;
  res.on('close', () => { if (!res.writableEnded) aborted = true; });

  for await (const ev of streamReply(buildMessages(history, message, facts, body.memory))) {
    if (ev.type === 'meta') {
      provider = ev.provider;
      emit('meta', { provider, search: facts ? { source: facts.source, title: facts.title, url: facts.url } : null });
    } else {
      reply += ev.text;
      emit('token', { t: ev.text });
    }
    if (aborted) break; // client went away; still log what we have
  }

  reply = reply.trim();
  if (reply) sessions.append(sessionId, { role: 'assistant', text: reply, source: 'text', provider });
  drive.scheduleSync(sessionId);

  if (streaming) { emit('done', { provider }); res.end(); }
  else sendJson(res, 200, { reply, provider, search: facts ? { source: facts.source, title: facts.title } : null });
}

// ---------- routes ----------
async function handleApi(req, res, url) {
  const { pathname } = url;
  const m = req.method;

  if (m === 'POST' && pathname === '/api/chat') return handleChat(req, res);
  if (m === 'GET' && pathname === '/api/health') return sendJson(res, 200, { ok: true, providers: providerNames() });
  if (m === 'GET' && pathname === '/api/config')
    return sendJson(res, 200, {
      adminTokenRequired: Boolean(ADMIN_TOKEN),
      drive: { enabled: drive.status.enabled, mode: drive.status.mode, lastSync: drive.status.lastSync, lastError: drive.status.lastError },
    });

  // Owner download of their own chat (the unguessable session id acts as the key).
  let mm = pathname.match(/^\/api\/my\/([\w-]+)\.md$/);
  if (m === 'GET' && mm) {
    const s = sessions.get(mm[1]);
    if (!s) return sendJson(res, 404, { error: 'No messages in this session yet' });
    return send(res, 200, sessions.toMarkdown(s), 'text/markdown; charset=utf-8', { 'content-disposition': `attachment; filename="${sessions.mdFileName(s)}"` });
  }

  // Everything below is for Jarvis / admin sync.
  if (pathname === '/api/sessions' || pathname.startsWith('/api/sessions/') || pathname.startsWith('/api/export') || pathname === '/api/sync') {
    if (!isAdmin(req, url)) return sendJson(res, 401, { error: 'Admin token required' });

    if (m === 'GET' && pathname === '/api/sessions') return sendJson(res, 200, { sessions: sessions.list() });
    mm = pathname.match(/^\/api\/sessions\/([\w-]+)$/);
    if (m === 'GET' && mm) {
      const s = sessions.get(mm[1]);
      return s ? sendJson(res, 200, s) : sendJson(res, 404, { error: 'Not found' });
    }
    if (m === 'GET' && pathname === '/api/export')
      return sendJson(res, 200, { exportedAt: new Date().toISOString(), sessions: sessions.all() });
    if (m === 'GET' && pathname === '/api/export.zip') {
      const files = sessions.all().flatMap((s) => [
        { name: sessions.mdFileName(s), data: sessions.toMarkdown(s) },
        { name: `${s.sessionId}.jsonl`, data: s.messages.map((x) => JSON.stringify(x)).join('\n') + '\n' },
      ]);
      return send(res, 200, makeZip(files), 'application/zip', { 'content-disposition': 'attachment; filename="sparky-sessions.zip"' });
    }
    if (m === 'POST' && pathname === '/api/sync') return sendJson(res, 200, await drive.syncAll());
  }
  return sendJson(res, 404, { error: 'Not found' });
}

function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC + path.sep)) return send(res, 403, 'Forbidden', 'text/plain');
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, 'Not found', 'text/plain');
    const type = MIME[path.extname(file)] || 'application/octet-stream';
    // Revalidate the app shell so updates arrive; icons can be cached longer.
    const cache = file.includes(`${path.sep}icons${path.sep}`) ? 'public, max-age=86400' : 'no-cache';
    res.writeHead(200, { 'content-type': type, 'cache-control': cache });
    res.end(req.method === 'HEAD' ? undefined : data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) await handleApi(req, res, url);
    else if (req.method === 'GET' || req.method === 'HEAD') serveStatic(req, res, url);
    else send(res, 405, 'Method not allowed', 'text/plain');
  } catch (e) {
    console.error('[server]', e);
    if (!res.headersSent) sendJson(res, 500, { error: 'Server error' });
    else res.end();
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Sparky running on http://localhost:${PORT}`);
  console.log(`LLM chain: ${providerNames().join(' -> ')}`);
  console.log(`Drive sync: ${drive.status.enabled ? drive.status.mode : 'off (download only)'}`);
  console.log(`Admin token: ${ADMIN_TOKEN ? 'required' : 'NOT set (set ADMIN_TOKEN before hosting publicly)'}`);
});
