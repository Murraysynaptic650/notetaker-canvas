# Notetaker Canvas

[![CI](https://github.com/powerpratik/notetaker-canvas/actions/workflows/ci.yml/badge.svg)](https://github.com/powerpratik/notetaker-canvas/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Built with tldraw](https://img.shields.io/badge/built%20with-tldraw-black)](https://tldraw.dev)

An infinite-canvas whiteboard (built on [tldraw](https://tldraw.dev)) for iPad and
desktop, with an **AI study partner** that can see the board, chat about it, draw
on it, listen to your voice, and run against multiple model backends — cloud
(Anthropic, Gemini), a local GPU model (vLLM/Ollama), or a headless Claude Code
agent on your Mac.

Installable as a PWA. Board state persists locally (IndexedDB) and works offline.

> **Working on the code?** [`docs/GLOSSARY.md`](docs/GLOSSARY.md) defines the
> project's vocabulary and the invariants the AI features depend on;
> [`CLAUDE.md`](CLAUDE.md) covers conventions and the verify gate.

---

## Quick start

```bash
npm install
npm run dev              # http://localhost:5173  (use this while iterating)
```

To use it on the **iPad** (same Wi-Fi), the dev server listens on the LAN:
open `http://<mac-ip>:5173`. Use **`npm run dev`, not `preview`**, while
developing — `preview` ships a service worker that can serve stale bundles.

Build / preview the production PWA:

```bash
npm run build
npm run preview          # http://localhost:4173 (with service worker)
```

---

## The AI study partner

Open the **💬 AI** button (bottom-left). Header controls:

| Button | Meaning |
|--------|---------|
| 🖊️ | **Answer on board** — when on, the AI writes its reply directly onto the canvas (as notes/shapes) instead of the chat. Toggle off for chat answers. |
| 🎯 | **Focus on selection** — context becomes only the shapes you've selected (a cropped image + their text). "Point at this and explain it." |
| 👁️ | **Auto-watch** — after you stop editing (~2.5s), the AI proactively reacts. Fires on handwriting/drawings too, not just typed text. |
| ⚙️ | Provider settings |
| 🗑️ | Clear the conversation |

Input row: **🎤 voice** (speech-to-text, auto-sends each phrase) and a text box.
While a reply is streaming, **Send** becomes **Stop** — cancelling keeps
whatever text already arrived.

### What it can do
- **See the board** — a snapshot image is sent every turn (downscaled to ≤1280px,
  JPEG, to bound tokens). Vision-capable models read handwriting/sketches.
- **Draw on the board** — the model may append a ` ```tldraw ` JSON block of ops,
  which we apply via `createShapes` (marked as non-user edits so auto-watch
  doesn't loop). Ops: `text`, `note`, `geo`, `arrow`, `line`, `image`, `update`.
- **Place things precisely** — the model gets a numbered inventory of every
  shape with its exact bounds, and positions new ones *relative to them*
  (`"anchor":"S3","side":"right"`) rather than guessing coordinates off the
  snapshot. Draw an arrow and ask it to continue: `side:"tip"` starts exactly at
  the arrowhead. Arrows given `"from"`/`"to"` are **bound** to their shapes, so
  they stay attached when you move things. Placement avoids overlaps for you.
- **Know where you're working** — whatever you have selected, or last drew,
  is passed as the "pointer", so "finish this" means the right spot.
- **Stream** replies token-by-token (or per-message for the Claude Code agent).
- **Compact** — only the last few turns are sent to the model; the full
  transcript stays in the UI. Clear at any time with 🗑️.

### Providers (⚙️ → Provider)

| Provider | Use | Config |
|----------|-----|--------|
| **Anthropic API** | Claude directly | `sk-ant-…` key + model (`claude-sonnet-5`) |
| **Google Gemini API** | Gemini via its OpenAI-compatible endpoint | `AIza…` key + model (`gemini-2.5-flash`) |
| **Local / OpenAI-compatible** | vLLM / Ollama on a GPU box | Base URL (`…/v1`) + model + optional key |
| **Claude Code (agent)** | Headless Claude Code on your Mac | none in-app (auth lives in the bridge) |

Keys/config live only in this browser's localStorage.

---

## Local GPU model (vLLM) over Tailscale

The GPU box runs vLLM (OpenAI-compatible). Because the browser can't reach a
Tailscale-only host from a LAN device (e.g. the iPad), the **Vite dev server
relays** it: the app calls same-origin `/llm/v1`, and Vite forwards to your vLLM.

Start the app pointing at your vLLM host:
```bash
LLM_TARGET=http://100.x.x.x:8000 npm run dev
```
Then in the app: **Provider → Local / OpenAI-compatible**, Base URL **`/llm/v1`**,
model `local-model`.

The vLLM container lives in [`docker-compose.yml`](./docker-compose.yml). Notes:
- The whole `command` **must stay wrapped in outer double-quotes** (exec-form
  `bash -c` word-splits an unquoted command → only `python3` runs → exit 0).
- CORS origins JSON must be **escaped**: `--allowed-origins '[\"*\"]'`.
- On a **MIG slice** the model must fit the slice, not the full H100 — use
  quantized (AWQ/fp8) weights and a modest `--max-model-len`.
- Reasoning models (e.g. Nemotron) emit `<think>…</think>`; the app strips it on
  the local-provider stream (`thinkFilter.ts`), handling the implicit-open case
  (`</think>` with no opening tag).

---

## Claude Code agent bridge

`claude-bridge/` runs **headless Claude Code** and exposes it as an
OpenAI-compatible endpoint, so the chat can answer general questions and run
real computation on the Mac (Bash/Read/Write in `claude-bridge/workspace`),
while still seeing the board.

```bash
claude setup-token                          # once — prints CLAUDE_CODE_OAUTH_TOKEN
cd claude-bridge && npm install
CLAUDE_CODE_OAUTH_TOKEN=... npm start        # listens on :8790, model = sonnet
```

Then start the dev server **with the relay explicitly enabled** — it is off by
default, so a bridge you left running can't be reached by accident:

```bash
ENABLE_AGENT_PROXY=1 npm run dev
```

Now pick **Provider → Claude Code (agent)** in the app (no URL/key needed).
Without the flag, `/agent` answers `503` and the chat says the relay is
disabled; the dev server prints a warning when you *do* enable it.

> **Personal, single-user use only** — your own token on your own machine. Do not
> expose the bridge as a shared service. Anyone who can reach the dev server
> while the relay is on can run commands on this machine.

Env: `CLAUDE_BRIDGE_PORT` (8790), `CLAUDE_BRIDGE_MODEL` (sonnet),
`MAX_THINKING_TOKENS` (8000 → medium effort for faster replies).

---

## Configuration

Nothing here is required to run the app against a cloud provider — `npm run dev`
plus a key pasted into ⚙️ is enough. The variables matter once you point it at
your own hardware.

**Dev server** (read by `vite.config.ts` at startup):

| Variable | Default | What it does |
|---|---|---|
| `LLM_TARGET` | `http://127.0.0.1:8000` | Where `/llm` is relayed to — your vLLM/Ollama host, typically a Tailscale address |
| `ENABLE_AGENT_PROXY` | *(unset — off)* | Set to `1` to enable the `/agent` relay. **Off by default**: it reaches an agent that can run commands on this machine |
| `CLAUDE_BRIDGE_TARGET` | `http://127.0.0.1:8790` | Where `/agent` is relayed to, when enabled |

**Bridge** (`claude-bridge/`, read by `server.mjs`):

| Variable | Default | What it does |
|---|---|---|
| `CLAUDE_CODE_OAUTH_TOKEN` | — | **Secret.** From `claude setup-token`. Never commit it |
| `CLAUDE_BRIDGE_PORT` | `8790` | Bridge listen port |
| `CLAUDE_BRIDGE_MODEL` | `sonnet` | Model the headless agent runs |
| `MAX_THINKING_TOKENS` | `8000` | Lower = faster replies |

**In-app** (⚙️, stored in that browser's `localStorage` under
`notetaker-ai-settings`): provider, model, base URL, API key. Per-browser and
per-device — never sent anywhere but the provider you selected, never written
to the repo.

**vLLM** — see [`docker-compose.yml`](./docker-compose.yml). Note that
`NVIDIA_VISIBLE_DEVICES` pins a **specific MIG slice UUID from the author's
machine**; change it to your own GPU or slice, or the container won't start.

---

## Network exposure — what listens, and what it relays

Worth understanding before you run this on a network you don't control.

```
    iPad / any device on your Wi-Fi
                │
                │  http://<mac-ip>:5173        ← no auth
                ▼
    ┌───────────────────────────────┐
    │  Vite dev server (your Mac)   │   server.host = true
    │  binds 0.0.0.0:5173           │   → LAN + Tailscale, not just localhost
    └───────────┬───────────┬───────┘
                │           │
        /llm    │           │   /agent
                ▼           ▼
        vLLM on GPU box   claude-bridge :8790
        (Tailscale)       (Bash/Read/Write on your Mac)
```

**The dev server binds to every interface.** `server.host: true` is what lets
the iPad reach it — and equally lets anyone else on the same Wi-Fi reach it.

**The proxies are unauthenticated relays.** They exist for a good reason: the
iPad is on your LAN, the GPU box is on your tailnet, and only the Mac can route
to both, so the browser calls same-origin `/llm/v1` and Vite forwards it.
Same-origin also sidesteps CORS, mixed content, and service-worker issues. But
it means anyone who can reach port 5173 can:

- **use your GPU** through `/llm` — always on, and
- **reach the Claude Code bridge** through `/agent` — which runs a headless
  agent with **Bash, Read and Write** in `claude-bridge/workspace`, on your
  token. **Off unless you set `ENABLE_AGENT_PROXY=1`.**

That second one is why it's opt-in. While it's on, treat "can reach :5173" as
"can run commands on my Mac".

Consequently:

- **Only run the dev server on networks you trust.** Home Wi-Fi, fine. Café,
  conference, campus — don't, or at least leave `/agent` off.
- **Enable `/agent` per session, not in your shell profile.** The whole point of
  the default is that a bridge you forgot about isn't reachable. Exporting the
  variable permanently gives that back.
- **Tunnels make this public.** `vite.config.ts` allows `.trycloudflare.com`,
  `.ngrok-free.app`, `.ngrok.io` and `.ts.net` hosts, so `npm run tunnel` puts
  the app — *and whichever proxies are live* — on the open internet behind
  nothing but an unguessable URL. A quick-tunnel URL is not a secret; treat it
  as one anyway and shut the tunnel down when you're done. **Never combine a
  tunnel with `ENABLE_AGENT_PROXY=1`.**
- **vLLM listens on `0.0.0.0:8000` with `--allowed-origins '["*"]'`.** Keep that
  box on the tailnet and off any public interface; the wide-open CORS assumes
  nothing untrusted can route to it.
- **The proxies are dev-only.** `vite build` does not include them, so the
  production PWA has no `/llm` or `/agent` route. A deployed build can only talk
  to a provider the user configures in their own browser.

Your Tailscale and LAN addresses are supplied at runtime through `LLM_TARGET`,
never committed — the repo only ever refers to them as `100.x.x.x`.

---

## Architecture

```
src/
  canvas/        tldraw host, iPad tuning, floating overlay (export/save/load/clear)
  export/        PNG/SVG export, .tldr save/load
  ai/
    AiPanel.tsx        chat UI + provider settings
    useAiChat.ts       conversation state, streaming, board context, compaction,
                       cancellation (AbortController per request)
    llmClient.ts       provider-agnostic streaming (Anthropic SDK + OpenAI SSE)
    settingsStore.ts   provider config in localStorage
    boardContext.ts    board→text summary, board→image snapshot (+ downscale)
    boardActions.ts    parse ```tldraw ops → shapes, arrow bindings, text updates
    thinkFilter.ts     strip <think>…</think> from local reasoning models
    useBoardWatcher.ts  debounced shape-change trigger for auto-watch
    useVoiceInput.ts    Web Speech API mic input
    sceneGraph.ts      board→labelled inventory (S1, S2…) with exact bounds
    boardScene.ts      tldraw→scene adapter; arrow tips and headings
    placement.ts       anchor+side→exact coordinates, avoiding overlaps
    geometry.ts        Bounds/Point helpers
    useLastEditedShape.ts  tracks the shape the user last drew (the "pointer")
  pwa.ts         durable service-worker auto-update (polls for new builds)
claude-bridge/   headless Claude Code → OpenAI-compatible endpoint (Node)
docker-compose.yml   vLLM server for the local GPU model
```

Request relays (dev server, `vite.config.ts`): `/llm` → vLLM, `/agent` → bridge.

### Tunables
- `boardContext.ts` — `MAX_IMAGE_EDGE` (1280), `JPEG_QUALITY` (0.85). **Raise the
  edge for better OCR/handwriting** (costs tokens).
- `useAiChat.ts` — `MAX_HISTORY_MESSAGES` (8).
- `llmClient.ts` — `MAX_TOKENS` (4096). Must cover the chat text *and* any
  trailing `tldraw` actions block; too low truncates the JSON mid-block and the
  drawing is silently dropped.
- vLLM — `--max-model-len`; bridge — `MAX_THINKING_TOKENS`.

---

## Tests

```bash
npm test           # unit tests (vitest)
npm run coverage   # + coverage report, gated at 80%
npm run lint       # eslint
npm run verify     # typecheck + lint + coverage — run this before committing
```

The coverage gate covers the **logic layer** (`ai/` parsing, streaming, board
context, settings; `export/filename`). UI components and thin browser-API
wrappers — canvas capture, SpeechRecognition, service-worker registration,
file download/share — are deliberately outside it: a unit test there only
asserts against its own mock. Those want an E2E suite (Playwright) driving a
real browser, which doesn't exist yet.

Two behaviours worth knowing, both pinned by tests:
- The AI's draw-actions block is taken from the **last** fenced block in a
  reply, so a code example earlier in the answer isn't mistaken for it.
- On the local provider, `ThinkFilter` can't tell "reasoning with an implicit
  `<think>`" from "a plain answer" until it sees `</think>` or the stream ends —
  so a *non*-reasoning local model delivers its reply in one lump rather than
  token by token.

---

## Troubleshooting

| Symptom | Cause / fix |
|---------|-------------|
| Chat "couldn't reach …", curl works | Browser-only block. **Mixed content** (https app → http server) or **CORS**. Serve app over http (dev) or give the server https; enable CORS. |
| "couldn't reach" but curl + browser-tab to `/v1/models` both work | **Service worker** serving stale/failed fetch — use `npm run dev`, or clear the SW. |
| iPad "couldn't reach" but Mac works | iPad isn't on the tailnet. Use the `/llm` proxy (base URL `/llm/v1`) so the Mac relays. |
| vLLM exits code 0, no logs | Outer quotes removed from the compose `command` → only `python3` ran. Keep the wrapping `"…"`. |
| `--allowed-origins: invalid loads value '[*]'` | Escape the JSON quotes: `'[\"*\"]'`. |
| `Input length exceeds maximum context length` | Raise `--max-model-len`, and/or lower `MAX_IMAGE_EDGE`. |
| vLLM `mm_hash` AssertionError | Multimodal cache wedged after an overflow. Restart the container; add `--mm-processor-cache-gb 0`. |
| `crypto.randomUUID is not a function` on draw | Secure-context-only API on a LAN http origin. Fixed — uses tldraw's `createShapeId()`. Clear the stale SW if it persists. |
| Claude Code bridge `spawn … -88` (EBADMACHO) | Corrupt vendored binary. `sudo rm -rf node_modules package-lock.json && npm install` (never `sudo npm install`). |

---

## Scripts

```bash
npm run dev        # dev server (LAN + proxies), no service worker
npm run build      # production build (tsc + vite)
npm run preview    # serve the built PWA
npm run verify     # typecheck + lint + coverage
npm test           # unit tests
npm run lint       # eslint
```

### Publishing to GitHub

[`scripts/publish-to-github.sh`](scripts/publish-to-github.sh) audits for
leaked credentials, then creates the repo and pushes.

```bash
DRY_RUN=1 bash scripts/publish-to-github.sh    # audit only, push nothing
bash scripts/publish-to-github.sh              # create + push
VISIBILITY=private bash scripts/publish-to-github.sh
```

It scans the **full commit history**, not just the working tree — a token in an
old commit is still a leaked token once the repo is public — and refuses to push
if it finds one, or if `claude-bridge/start_command` has stopped being ignored.

Authenticate with `gh auth login` (stores the token in the system keychain).
**Never embed a token in the remote URL** — `https://TOKEN@github.com/...` writes
it in cleartext to `.git/config`, where `git remote -v` and any screenshot will
happily reveal it. If you use a PAT, pipe it in instead:

```bash
gh auth login --with-token < ~/.config/gh-token     # or: export GH_TOKEN=...
```

A fine-grained PAT needs **Contents: read & write** on the repo, plus
**Administration: write** if you want the script to create it. A classic PAT
pushing this repo also needs the **`workflow`** scope, because it contains
`.github/workflows/ci.yml` — GitHub rejects workflow changes without it.

---

## Security

**Never commit credentials.** Model keys are entered in the app and live only in
your browser's `localStorage` — they are never written to the repo. The bridge's
token belongs in your environment: copy
[`claude-bridge/start_command.example`](claude-bridge/start_command.example) to
`start_command` (gitignored) or export the variable in your shell.

**The dev server and its proxies are the real exposure**, not the repo — see
[Network exposure](#network-exposure--what-listens-and-what-it-relays). In
short: `:5173` is unauthenticated, binds to every interface, and relays to the
Claude Code bridge, which can run commands on your Mac. Trusted networks only,
and don't leave the bridge running.

If a credential is ever committed, purging it from history is not enough —
**rotate it**. Assume anything that reached a commit is compromised.

If you find a security problem, please open an issue — or, for anything
sensitive, contact the maintainer directly rather than filing publicly.

## Contributing

Issues and pull requests are welcome. Run `npm run verify` before opening a PR —
CI runs the same gate (typecheck, lint, 80% coverage on the logic layer) plus a
production build. See [`CLAUDE.md`](CLAUDE.md) for conventions and
[`docs/GLOSSARY.md`](docs/GLOSSARY.md) for the vocabulary and invariants.

## License

[MIT](LICENSE) © Pratik Poudel

Built on [tldraw](https://tldraw.dev), which carries its own license — review
tldraw's terms before using this commercially.
