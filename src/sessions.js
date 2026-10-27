// Session logging: one JSONL (machine-readable) + one Markdown (Obsidian-friendly) file per session.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DIR = process.env.DATA_DIR || path.join(root, 'data', 'sessions');
const TZ = process.env.TIMEZONE || 'America/Chicago';
const CHILD = process.env.CHILD_NAME || 'Pearson';
fs.mkdirSync(DIR, { recursive: true });

export const ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const cache = new Map(); // id -> {sessionId, startedAt, updatedAt, messages[]}

const jsonlPath = (id) => path.join(DIR, `${id}.jsonl`);
const mdPath = (id) => path.join(DIR, `${id}.md`);

function load(id) {
  if (cache.has(id)) return cache.get(id);
  let messages = [];
  if (fs.existsSync(jsonlPath(id))) {
    messages = fs.readFileSync(jsonlPath(id), 'utf8').split('\n').filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  }
  const s = {
    sessionId: id,
    startedAt: messages[0]?.ts || null,
    updatedAt: messages.at(-1)?.ts || null,
    messages,
  };
  cache.set(id, s);
  return s;
}

/** Append one message to the session logs. Returns the stored entry. */
export function append(id, { role, text, source = 'text', provider }) {
  const s = load(id);
  const entry = { sessionId: id, ts: new Date().toISOString(), role, text, source };
  if (provider) entry.provider = provider;
  s.messages.push(entry);
  s.startedAt ||= entry.ts;
  s.updatedAt = entry.ts;
  fs.appendFileSync(jsonlPath(id), JSON.stringify(entry) + '\n');
  fs.writeFileSync(mdPath(id), toMarkdown(s));
  return entry;
}

/** Last N messages as chat-completion context. */
export function getContext(id, n = 12) {
  return load(id).messages.slice(-n).map((m) => ({ role: m.role, content: m.text }));
}

export function get(id) {
  if (!ID_RE.test(id) || !fs.existsSync(jsonlPath(id))) return null;
  return load(id);
}

export function list() {
  return fs.readdirSync(DIR).filter((f) => f.endsWith('.jsonl')).map((f) => load(f.slice(0, -6)))
    .filter((s) => s.messages.length)
    .map((s) => ({
      sessionId: s.sessionId, startedAt: s.startedAt, updatedAt: s.updatedAt, messageCount: s.messages.length,
      preview: s.messages.find((m) => m.role === 'user')?.text.slice(0, 80) || '',
    }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export const all = () => list().map((s) => load(s.sessionId));

const fmtDate = (iso) => new Date(iso).toLocaleDateString('en-CA', { timeZone: TZ }); // YYYY-MM-DD
const fmtTime = (iso) => new Date(iso).toLocaleTimeString('en-GB', { timeZone: TZ });

/** Nice file name for exports/Drive: "2026-10-27 Sparky 1a2b3c4d.md" */
export const mdFileName = (s) => `${fmtDate(s.startedAt)} Sparky ${s.sessionId.slice(0, 8)}.md`;

export function toMarkdown(s) {
  const head = [
    '---',
    `sessionId: ${s.sessionId}`,
    `date: ${fmtDate(s.startedAt)}`,
    `started: ${s.startedAt}`,
    `updated: ${s.updatedAt}`,
    `messages: ${s.messages.length}`,
    `timezone: ${TZ}`,
    'tags: [sparky, chat]',
    '---',
    '',
    `# Sparky chat - ${fmtDate(s.startedAt)}`,
    '',
  ];
  const body = s.messages.map((m) => {
    const who = m.role === 'user' ? `${CHILD}${m.source === 'voice' ? ' (voice)' : ''}` : 'Sparky';
    return `### ${fmtTime(m.ts)} - ${who}\n${m.text}\n`;
  });
  return [...head, ...body].join('\n');
}
