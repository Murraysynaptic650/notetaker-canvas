# Notetaker Canvas — working notes

iPad-first infinite-canvas whiteboard on tldraw, with an AI study partner that
sees the board, chats about it, and draws on it. React 18 + TypeScript + Vite,
shipped as a PWA. Personal, single-user app.

## Read this first

**[`docs/GLOSSARY.md`](docs/GLOSSARY.md) is the semantic layer** — the shared
vocabulary (board context, snapshot, actions block, draw op, fingerprint,
auto-watch, focus mode, compaction, provider, bridge, relay), the **invariants**
that must not be broken, the tunables, and the known sharp edges.

Read it before touching `src/ai/`. Most of what's non-obvious here is not in any
single file — it's in how these concepts interact, and that's only written down
in the glossary.

`README.md` is the user-facing manual: setup, provider config, vLLM/Tailscale
notes, and a deployment troubleshooting table.

## Commands

```bash
npm run dev        # dev server, LAN + proxies, no service worker ← use while iterating
npm run verify     # typecheck + lint + coverage — the gate; run before committing
npm test           # unit tests
npm run build      # tsc -b && vite build
```

`npm run preview` serves the built PWA but ships a service worker that can hand
back a stale bundle — don't use it to check a code change.

Reaching the app from the iPad: `npm run dev` binds all interfaces; open
`http://<mac-ip>:5173`. With a local GPU model:
`LLM_TARGET=http://100.x.x.x:8000 npm run dev`, then set the app's base URL to
`/llm/v1`.

## Conventions

- **Immutable updates.** Never mutate a record in place; build a new one.
- **Small focused modules.** Roughly 200–400 lines; extract rather than grow.
- **Comments explain *why*.** The existing code is unusually well commented and
  that's deliberate — match it. Prefer a sentence on the trade-off over a
  restatement of the code.
- **Errors are handled at every level** and surfaced to the user in language
  they can act on. `llmClient`'s translation of an opaque `TypeError` into
  "check mixed content / CORS / reachability" is the model to follow.
- **No `console.log`** in production code (lint-enforced; `warn`/`error` are
  allowed).
- **Validate at boundaries.** Anything from the model, `localStorage`, or a
  loaded file is untrusted and gets coerced — see `settingsStore.normalize` and
  the `num`/`str`/`pickColor` helpers in `boardActions`.
- **Conventional commits** (`feat:`, `fix:`, `test:`, `chore:`, `refactor:`,
  `docs:`). Explain the *why* in the body; these commits are the project's only
  history.

## Testing

TDD where it's practical: write the failing test, watch it fail, then fix. The
`parseReply` and cancellation work both went in that way, and the abort fix was
verified by reverting the wiring to confirm 5 tests went red.

The coverage gate (80%) is scoped in `vitest.config.ts` to the **logic layer**
only — `ai/` parsing, streaming, board context, settings, plus
`export/filename`. UI components and thin browser-API wrappers are deliberately
excluded; see the glossary's sharp-edges section for why. If you add a module
that is real logic, add it to the coverage `include` list.

Test the *behaviour a user would notice*, not the implementation. Every
invariant in the glossary that can be pinned by a test already is — if you
change one deliberately, update the glossary in the same commit.

## State of things

- 115 unit tests; `npm run verify` green; production build + PWA generation OK.
- Vite 7 / Vitest 3. Staying off `@vitejs/plugin-react` 6 — it requires Vite 8
  and pulls `@babel/core` 8.0.0-rc.
- One transitive advisory remains (`brace-expansion` DoS, dev-only, reachable
  only via ESLint's and Vitest's glob handling). Fixing needs `--force` across
  minimatch majors; judged not worth it.
- **No E2E tests.** The biggest gap. Playwright driving a real browser would
  cover the canvas/voice/export/service-worker paths that unit tests can't.
- **No live sync**, despite `package.json`'s description. Continuity is
  file-based (`.tldr` via iCloud Drive). `Whiteboard.tsx` notes a "Phase 3"
  tldraw-sync plan.
- Not yet exercised on the iPad since the Vite 7 upgrade.
