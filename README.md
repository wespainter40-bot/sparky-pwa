# Sparky

A free, kid-friendly PWA chat assistant with a glowing green "energy core". Built for Pearson (age 7), owned by Wesley Painter.

- Tap the core to talk (Web Speech API), or type. Sparky answers out loud (mute button) and in floating message cards.
- The core idles with a slow pulse, and pulses faster and brighter while Sparky is listening, thinking or speaking. Gold sparks fly on activity.
- Zero npm dependencies. Just Node 20+.
- Every chat is logged to JSONL and Obsidian-friendly Markdown, with optional Google Drive sync.

## Run it

```bash
cd /workspace/sparky
npm start                 # http://localhost:3000
PORT=8080 npm start       # custom port
```

With no keys at all, Sparky uses Pollinations (free, no key) and then a local canned reply. To add better providers, copy `.env.example` to `.env` (loaded automatically) or set environment variables.

On a phone: open the page over HTTPS (or `localhost`) and use "Add to Home Screen" / "Install". Voice input needs a browser with SpeechRecognition (Chrome, Edge, Safari). Where it's missing, Sparky says so and typing still works.

## How replies work

Provider chain, first one that answers wins (replies stream token by token):

1. **Groq** (`GROQ_API_KEY`, default model `llama-3.1-8b-instant`)
2. **OpenRouter** free models (`OPENROUTER_API_KEY`, default `meta-llama/llama-3.3-70b-instruct:free`)
3. **Custom** OpenAI-compatible endpoint (`CUSTOM_BASE_URL`, `CUSTOM_MODEL`, optional `CUSTOM_API_KEY`)
4. **Pollinations** (`https://text.pollinations.ai/openai`, no key)
5. **Local canned reply** if all of the above fail

Keys live only on the server (`.env` / host env vars) and are never sent to the browser. To add another provider, add an `openAICompatible({...})` entry in `src/providers.js`.

The system prompt (in `src/prompt.js`) makes Sparky friendly, curious, upbeat, short and clear, age-appropriate, and gently redirecting on unsafe topics. The last 12 messages of each session are sent as context.

**Lookup tool:** when a message looks like a factual question ("Who was...", "What is...", "Tell me about...", "How tall is..."), the server queries DuckDuckGo Instant Answer, then Wikipedia (both free, no key, 3 s timeout) and adds the result to the prompt as reference info. If the lookup fails, the chat just continues without it. See `src/search.js`.

### Free API setup

**Groq** (primary, very fast)
1. Sign in at <https://console.groq.com> and open **API Keys** -> **Create API Key**.
2. Put it in `.env`: `GROQ_API_KEY=gsk_...`
3. Optional: `GROQ_MODEL=llama-3.1-8b-instant` (or any model Groq offers). The free tier has rate limits; if hit, Sparky falls through to the next provider.

**OpenRouter** (second choice, free models)
1. Create a key at <https://openrouter.ai/keys>.
2. `OPENROUTER_API_KEY=sk-or-...`
3. Pick any model ending in `:free` from <https://openrouter.ai/models?q=free>, e.g. `OPENROUTER_MODEL=meta-llama/llama-3.3-70b-instruct:free`. Free models are rate limited and sometimes busy.

**Pollinations**: nothing to set up. Optional `POLLINATIONS_MODEL` (default `openai`).

## API

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/api/chat` | Body `{sessionId, message, source: "text"\|"voice", stream?: false}`. Default response is Server-Sent Events: `meta` (`provider`, `search`), many `token` (`{t}`), then `done`. With `"stream": false` it returns `{reply, provider, search}` JSON. `sessionId` is 8-64 chars `[A-Za-z0-9_-]` (the browser uses a UUID). |
| GET | `/api/health` | Status and the active provider chain |
| GET | `/api/config` | Child name, Drive status, whether an admin token is needed |
| GET | `/api/my/:sessionId.md` | Download one chat as Markdown (used by the UI button) |
| GET | `/api/sessions` | List sessions (admin) |
| GET | `/api/sessions/:id` | One session with all messages (admin) |
| GET | `/api/export` | All sessions as JSON, for "Jarvis" sync (admin) |
| GET | `/api/export.zip` | All sessions, `.md` + `.jsonl` in a zip (admin) |
| POST | `/api/sync` | Push all sessions to Google Drive now (admin) |

"Admin" routes require the `ADMIN_TOKEN` env var as `Authorization: Bearer <token>`, `x-admin-token` header, or `?token=`. If `ADMIN_TOKEN` is unset they are open, which is fine on localhost but **set it before hosting publicly**, because chats are private. Chats are limited to 30 messages per minute per IP.

## Session log schema

Files live in `data/sessions/` (override with `DATA_DIR`), two per session:

### `<sessionId>.jsonl`: one JSON object per line, append-only

```json
{"sessionId":"1a2b3c4d-...","ts":"2026-10-27T19:08:10.091Z","role":"user","text":"Why is the sky blue?","source":"voice"}
{"sessionId":"1a2b3c4d-...","ts":"2026-10-27T19:08:13.475Z","role":"assistant","text":"Sunlight scatters...","source":"text","provider":"groq"}
```

| Field | Type | Meaning |
| --- | --- | --- |
| `sessionId` | string | Browser-generated id (UUID), same as the file name |
| `ts` | string | ISO 8601 UTC timestamp of the message |
| `role` | `"user"` \| `"assistant"` | Who said it |
| `text` | string | Message text |
| `source` | `"text"` \| `"voice"` | How the user entered it. Assistant messages are always `"text"` |
| `provider` | string, assistant only | `groq`, `openrouter`, `custom`, `pollinations` or `local` |

### `<sessionId>.md`: readable, Obsidian-friendly (rewritten after every message)

```markdown
---
sessionId: 1a2b3c4d-...
date: 2026-10-27
started: 2026-10-27T19:08:10.091Z
updated: 2026-10-27T19:08:25.652Z
messages: 4
timezone: America/Chicago
tags: [sparky, chat]
---

# Sparky chat - 2026-10-27

### 14:08:10 - Pearson (voice)
Why is the sky blue?

### 14:08:13 - Sparky
Sunlight scatters...
```

Times in the Markdown use `TIMEZONE` (default `America/Chicago`); the child's name comes from `CHILD_NAME`. Exports and Drive use the file name `YYYY-MM-DD Sparky <first 8 of id>.md`, so you can drop the folder straight into an Obsidian vault.

`GET /api/export` returns `{ exportedAt, sessions: [{sessionId, startedAt, updatedAt, messages: [...]}] }` with the same message objects as the JSONL.

## Export and Google Drive sync

In the app, the download button in the header opens "Save chats": download the current chat as `.md`, download all chats as `.zip` (asks for the admin token if one is set), and, only when Drive is configured, "Sync to Google Drive". Without Drive config the app simply offers downloads.

When Drive is configured, each chat is uploaded (created or updated) about 5 seconds after every reply, as the Markdown file, into one Drive folder. Failures are logged and never break chatting; `/api/config` shows `drive.lastSync` / `drive.lastError`.

Set `GOOGLE_DRIVE_FOLDER_ID` (the long id at the end of the folder URL) plus **one** of the following. Both use only the Drive API and need no extra npm packages.

### Option A: service account (best with a Shared Drive)

> A service account has no storage quota of its own, so it can only write into a **Shared Drive** (Google Workspace). For a normal personal My Drive folder use Option B.

1. In <https://console.cloud.google.com>, create a project and enable the **Google Drive API**.
2. **IAM & Admin -> Service Accounts -> Create**, then **Keys -> Add key -> JSON** and download the file.
3. In Drive, add the service account's email (`...@...iam.gserviceaccount.com`) as a **Content manager** on the Shared Drive or the folder.
4. Set `GOOGLE_SERVICE_ACCOUNT_JSON=/path/to/key.json` (or paste the raw JSON in the variable on hosts that only offer env vars) and `GOOGLE_DRIVE_FOLDER_ID=...`.

### Option B: OAuth refresh token (personal Google Drive)

1. In Google Cloud, enable the **Google Drive API**, then **APIs & Services -> OAuth consent screen** (External, add yourself as a test user), then **Credentials -> Create OAuth client ID -> Web application** with redirect URI `https://developers.google.com/oauthplayground`.
2. Open <https://developers.google.com/oauthplayground>, click the gear, tick **Use your own OAuth credentials**, paste the client id and secret.
3. Authorize the scope `https://www.googleapis.com/auth/drive`, sign in as the Drive owner, then **Exchange authorization code for tokens** and copy the **refresh token**. (Apps in "Testing" mode expire refresh tokens after 7 days; click **Publish app** to keep it.)
4. Set `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REFRESH_TOKEN` and `GOOGLE_DRIVE_FOLDER_ID`.

Restart the server. The startup log says `Drive sync: service-account`, `oauth` or `off (download only)`.

## Hosting on a free tier

Sparky is a plain Node server with local files, so it fits any Node host. **Free hosts usually have an ephemeral disk**: logs vanish on redeploy or sleep. Turn on Drive sync, or periodically pull `/api/export`, if you host remotely.

- **Run locally (simplest and private):** `npm start` on a home machine or Raspberry Pi. To use it on a phone away from home, put it behind a free [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) (`cloudflared tunnel --url http://localhost:3000`) which also gives you the HTTPS that voice and install need.
- **Render:** New -> Web Service -> connect the repo. Build command empty (or `npm install`), start command `npm start`, add env vars (keys, `ADMIN_TOKEN`, Drive). The free plan sleeps after inactivity, so the first request is slow.
- **Railway:** New Project -> Deploy from repo, add the same env vars, and generate a public domain. Railway uses `PORT` automatically. Its free credit is limited, and you can add a Volume and set `DATA_DIR` to it to keep logs.
- **Cloudflare Workers:** not a drop-in for v1, because the server uses Node's filesystem and `http`. Moving it to a Worker means swapping `src/sessions.js` for KV or D1 storage and replacing `server.js` with a `fetch` handler (the provider, search and prompt modules use only `fetch` and would work as is). Use Tunnel (above) or Render/Railway until then.

Always set `ADMIN_TOKEN` on a public host, and keep API keys in the host's environment settings, never in the repo.

## Look and feel (v2)

The energy core (v3) is a true-3D scene built from layers: `#dust` (page-wide depth-sorted motes), `#back` (ground glow, floor ripples, far halves of the orbit rings, sparks behind the core), `#plasma` (WebGL glass sphere with real normals, key and rim lights, terminator occlusion and a raymarched inner plasma) and `#core` (near halves of the rings, shockwave, lightning, sparks in front). A small camera orbits the scene from touch/pointer (spring), device orientation (asked for on the first tap; iOS shows a permission prompt once) and a gentle idle sway; the floating cards lean and drift at different depths with the same input. Listening ripples follow the real microphone level (getUserMedia + AnalyserNode, skipped on iOS and switched off automatically if it ever fights the recognizer) and fall back to a simulated level. If WebGL is unavailable it falls back to a simple glowing disc. If the GPU can't hold ~50fps the plasma resolution is lowered automatically (add `?q=max` to disable that, `?debug` exposes `window.__orb`). It is tuned for a recent phone with modern Chrome or Safari. After changing front-end files, bump `CACHE` in `public/sw.js` so installed copies pick them up (now `sparky-shell-v3`).

## Project layout

```
server.js            HTTP server, routes, chat streaming (SSE), static files
src/env.js           tiny .env loader
src/providers.js     provider chain (Groq, OpenRouter, custom, Pollinations, local fallback)
src/prompt.js        kid-safe system prompt + message builder
src/search.js        DuckDuckGo / Wikipedia lookup tool
src/sessions.js      JSONL + Markdown logging, session store
src/drive.js         optional Google Drive sync (service account or OAuth)
src/zip.js           dependency-free zip writer for exports
public/              PWA: index.html, style.css, app.js, orb.js, sw.js, manifest.json, icons/
scripts/make_icons.py  regenerates the PNG icons (needs Pillow): npm run icons
```

## Known gaps (v1)

- Speech recognition and synthesis quality depend on the browser/OS. Firefox has no SpeechRecognition, and Chrome's recognition sends audio to Google.
- The service worker caches only the app shell. Offline, the app opens but Sparky can't answer until you're back online.
- Kid-safety relies on the system prompt of the chosen model plus a prompt-only lookup filter. There is no separate content-moderation pass or parental PIN yet.
- Only the latest few cards are shown on screen. Older ones live in the log and exports.
- No per-device auth: the session id in the browser is the key to that chat's download link.
