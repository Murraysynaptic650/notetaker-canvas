# claude-bridge

Runs **Claude Code headless** and exposes it as an **OpenAI-compatible** endpoint,
so the notetaker chat can use it as a provider ("Claude Code (agent)"). It answers
general questions, can run commands and read/write files on this machine (scoped
to `./workspace`), and can see the whiteboard (the board image is written to a
temp file the agent reads).

> **Personal, single-user use only.** This is authenticated with *your own*
> subscription token running on *your own* machine. Anthropic does not allow
> offering claude.ai-subscription access to other users — do not expose this
> bridge as a shared service.

## Setup

1. Generate a subscription token (one time):
   ```bash
   claude setup-token          # prints a CLAUDE_CODE_OAUTH_TOKEN
   ```
   (Or use an API key instead via `ANTHROPIC_API_KEY`.)

2. Install and run:
   ```bash
   cd claude-bridge
   npm install
   CLAUDE_CODE_OAUTH_TOKEN=... npm start
   ```
   It listens on `http://localhost:8790` and prints the model + workspace path.

> Never run `sudo npm install` here — a root-owned `node_modules` breaks later
> installs and can corrupt the SDK's bundled binary (`spawn … EBADMACHO`). If it
> happened: `sudo rm -rf node_modules package-lock.json && npm install`.

## Use it from the app

The Vite dev server proxies `/agent` → `http://localhost:8790`, so on the Mac
*and* the iPad just pick **Provider → Claude Code (agent)** in the chat settings.
No base URL or key needed in the app (auth lives here on the server).

## How it works

- **OpenAI-compatible surface**: accepts `POST /v1/chat/completions` (streaming
  SSE) and `GET /v1/models`. The app talks to it exactly like vLLM/Gemini.
- **Headless invocation**: calls the Agent SDK's `query()` (see
  [`server.mjs`](./server.mjs)), which spawns Claude Code. Assistant text is
  re-emitted as OpenAI SSE chunks.
- **Real system prompt**: a custom `systemPrompt` tells the agent it's operating
  *inside a whiteboard* (not a terminal) and to answer **succinctly**. The app's
  own system message (board context + drawing-op format, including the
  "answer-on-board" directive when that toggle is on) is appended to it.
- **Vision**: any board image in the request is written to `./workspace` as a
  temp file; the agent is told to `Read` it, then it's deleted.
- **Drawing**: because the app parses ` ```tldraw ` blocks from any reply, the
  agent can draw on the board too (text/note/geo/arrow/line/image ops).
- **Tools**: `allowedTools: Bash, Read, Write, Edit, Glob, Grep` with
  `permissionMode: acceptEdits`, working inside `./workspace`, for real
  computation. Treat `./workspace` as scratch.
- **Speed**: reasoning is capped to the **lowest** thinking budget by default
  (`MAX_THINKING_TOKENS=1024`) so replies come back fast.

## Config (env vars)

| Var | Default | Purpose |
| --- | --- | --- |
| `CLAUDE_CODE_OAUTH_TOKEN` | – | Subscription token from `claude setup-token` |
| `ANTHROPIC_API_KEY` | – | Alternative to the OAuth token (billed per-token) |
| `CLAUDE_BRIDGE_PORT` | `8790` | Port to listen on |
| `CLAUDE_BRIDGE_MODEL` | `sonnet` | Model alias Claude Code runs |
| `MAX_THINKING_TOKENS` | `1024` | Reasoning budget — raise to trade speed for depth |
| `CLAUDE_BRIDGE_THINKING` | – | Convenience alias to set the budget |

Streaming is per-message (each assistant turn), not per-token, since the Agent
SDK yields whole messages; tool-use steps surface as the text between them.
