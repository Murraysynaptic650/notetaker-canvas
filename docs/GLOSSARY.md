# Glossary & Semantic Layer

The shared vocabulary for this project. Terms here mean *exactly* this
throughout the codebase, commits, and conversation — if a word appears in code
or a commit message and it's ambiguous, it should be defined here.

Read this before changing anything in `src/ai/`. Most of the non-obvious
behaviour in this app lives in how these concepts interact.

- [Core domain terms](#core-domain-terms)
- [AI collaboration terms](#ai-collaboration-terms)
- [Spatial grounding terms](#spatial-grounding-terms) ← how the AI places things precisely
- [Provider & transport terms](#provider--transport-terms)
- [Invariants](#invariants) ← the rules that must not be broken
- [Tunables](#tunables)
- [Module map](#module-map)
- [Known sharp edges](#known-sharp-edges)

---

## Core domain terms

| Term | Means |
|---|---|
| **Board** | The tldraw document — one infinite canvas. Persisted to IndexedDB under `notetaker-board-v1` (`PERSISTENCE_KEY` in `Whiteboard.tsx`). Survives reload, works offline. |
| **Shape** | A tldraw record: text, note (sticky), geo, arrow, line, image, or `draw` (a freehand/handwriting stroke). Handwriting is *shape props*, not pixels. |
| **Page** | tldraw's page concept. The app only ever works with the **current page** except when saving a `.tldr`, which captures the whole document. |
| **Selection** | The shapes the user currently has selected. Doubles as a *pointer*: see [Focus mode](#focus-mode). |
| **Pen mode** | tldraw state where only the Apple Pencil draws and fingers pan/zoom (palm rejection). Auto-enabled by tldraw on Pencil input; the app only exposes a *toggle*, never forces it — forcing it would lock out users with no Pencil. |
| **Overlay** | `CanvasOverlay` / `AiPanel`. Plain sibling `<div>`s positioned over the canvas via CSS — deliberately **not** tldraw's component-injection system, so the app depends only on `Editor` and `store.listen`, both stable low-level APIs. Top-left only: tldraw owns top-right (style panel) and bottom-right (zoom). |
| **Board file** | A `.tldr` save — a full `editor.getSnapshot()` as JSON. |
| **File-based continuity** | How a board moves between devices: save `.tldr` → iCloud Drive → "Load board" elsewhere. **There is no live sync server.** `package.json`'s description says "multi-device sync"; that is aspirational, not implemented. `Whiteboard.tsx` notes a "Phase 3" tldraw-sync plan. |

## AI collaboration terms

| Term | Means |
|---|---|
| **Board context** | Everything about the board sent to the model on a turn: the **placement note** + a **text summary** + a **snapshot**. Assembled by `buildContext` in `useAiChat.ts`. |
| **Placement note** | One line giving the visible viewport bounds in page coordinates, so shapes the model draws land on screen rather than off in the void. |
| **Text summary** | Plain text pulled from typed shapes (`props.text`, or flattened `props.richText`). Freehand drawings contribute nothing here — the snapshot covers those. Budgeted at 4000 chars, then truncated with `…`. |
| **Snapshot** | A rendered PNG of the board (or just the selection), downscaled to ≤1280px on its longest edge and re-encoded as JPEG to bound vision tokens. This is what lets a model read **handwriting**. Sent every turn. Returns `null` on failure — vision is a bonus and must never block the chat. |
| **Actions block** | A fenced ` ```tldraw ` code block holding a JSON array of **draw ops**, appended by the model at the very END of a reply. Parsed out by `parseReply`, applied by `applyBoardActions`, and stripped from the chat bubble. |
| **Draw op** | One entry in an actions block: `text`, `note`, `geo`, `arrow`, `line`, or `image`. Coordinates are absolute page coordinates (x right, y down). Unknown shapes fall back to `rectangle`, unknown colours to `black`. |
| **Fingerprint** | A cheap string over every shape's id, rounded position, rounded rotation and props. Changes iff the board meaningfully changed. Rounding position to whole pixels is deliberate: sub-pixel jitter must not re-trigger the AI. |
| **Auto-watch** (👁️) | Proactive mode. After the board is idle ~2500ms *and* the fingerprint actually changed, the app sends an `AUTO_PROMPT` turn on the user's behalf. Fires for handwriting too, not just typed text. |
| **Focus mode** (🎯) | Context narrows to the current selection — the snapshot is cropped to those shapes and the summary describes only them. Turns "explain this" into a workable prompt. The user's selection acts as a pointing finger. |
| **Board-reply mode** (🖊️) | The model answers *on the canvas* instead of in chat, by emitting an actions block. Appends `BOARD_REPLY_DIRECTIVE` to the system prompt. |
| **Compaction** | Only the last `MAX_HISTORY_MESSAGES` (8) turns go to the model; the full transcript stays in the UI. The window is never allowed to start on an assistant turn — the Anthropic API rejects that. |
| **Auto turn** | A message with `auto: true` — sent by auto-watch rather than typed by the user. |
| **Reasoning block** | `<think>…</think>` emitted by local reasoning models. Stripped by `ThinkFilter`. See the [implicit-open](#known-sharp-edges) sharp edge. |

## Spatial grounding terms

The vocabulary behind precise collaboration — "put a box at the end of *this*
arrow". Read this before changing how the AI positions anything.

**The core idea:** never ask the model for absolute coordinates. It sees a flat
image with no coordinate frame, so estimating numbers is the least reliable
thing it can do — while the app knows every shape's exact bounds. The model
names *what* to place and *where relative to what*; the app does the arithmetic.

| Term | Means |
|---|---|
| **Scene graph** | The board rendered as a numbered inventory for the prompt: every shape with a handle, kind, exact bounds and text. Replaces the old positionless list of strings. Built per turn in `boardScene.ts`, formatted in `sceneGraph.ts`. |
| **Handle** | A per-turn label for a shape: `S1`, `S2`, … assigned in reading order (top-to-bottom, left-to-right within a row). **Not** a persistent id — regenerated every request and mapped back to real shape ids when applying a reply. |
| **N-handle** | `N1`, `N2`, … — a shape *created by the current reply*, referenceable by later ops in the same batch. This is what lets one reply add a node and then connect an arrow to it, which "complete this flowchart" needs constantly. |
| **Pointer** | The shape the user is working at: their selection if any, else the shape they most recently drew or edited (`useLastEditedShape`). Announced in the prompt as `USER POINTER`. This is what turns "finish this" into a precise instruction. |
| **Anchor** | The handle a new shape is positioned relative to: `{"anchor":"S3","side":"right","gap":40}`. |
| **Side** | Where relative to the anchor: `right`, `left`, `above`, `below`, `center`, `tip`. |
| **Tip** | The arrowhead end of an arrow, plus its heading (the dominant axis of its vector). `side:"tip"` continues a flow from where the user's arrow points — the flagship case for this whole feature. Defaults to `gap: 0`, because a gap there would disconnect the flow exactly where precision matters. |
| **Occupancy** | The bounds placement de-conflicts against: existing shapes *plus* shapes placed earlier in the same batch. **Arrows, lines and highlights are exempt** — a flowchart is mostly arrows, and treating connectors as blockers would shove every new shape away from where it belongs. |
| **Arrow binding** | A real tldraw `arrow` binding created from `{"from":"S3","to":"S7"}`, so the arrow attaches to those shapes and follows them when moved — rather than being a floating line that merely looks connected. |
| **Update op** | `{"op":"update","target":"S3","text":"…"}` — rewrites an existing shape's text ("finish this label") instead of adding a near-duplicate beside it. |

## Provider & transport terms

| Term | Means |
|---|---|
| **Provider** | Which backend answers. Exactly four ids, and they are load-bearing strings: `anthropic`, `gemini`, `openai`, `claudecode`. |
| `anthropic` | Anthropic's hosted API via the SDK (`dangerouslyAllowBrowser`). Needs a key. The **only** provider not on the OpenAI-compatible code path. |
| `gemini` | Gemini through its OpenAI-compatible surface. Needs a key; base URL is fixed, not user-entered. |
| `openai` | Any OpenAI-compatible `/v1` endpoint — vLLM or Ollama on a GPU box. Needs a base URL + model; key optional. **The only provider that gets `ThinkFilter`.** |
| `claudecode` | The local Claude Code bridge. Needs nothing in-app: auth and model live on the bridge. |
| **Bridge** | `claude-bridge/server.mjs` — headless Claude Code wrapped in an OpenAI-compatible endpoint on `:8790`, with Bash/Read/Write in `claude-bridge/workspace`. Lets the chat run real computation on the Mac while still seeing the board. **Personal single-user use only** — it's your own token on your own machine; never expose it as a shared service. |
| **Relay / proxy** | The Vite dev server forwarding same-origin paths to hosts the browser can't reach: `/llm` → `LLM_TARGET` (vLLM), `/agent` → the bridge. Same-origin means no CORS, no mixed content, and no service-worker cross-origin trouble. |
| **Why the relay exists** | The iPad is on the LAN but the GPU box is on Tailscale. The iPad can't route there; the Mac can. So the app calls `/llm/v1` and the Mac relays. This is also why the dev server binds to all interfaces. |

---

## Invariants

Break one of these and something fails quietly rather than loudly. Each is
pinned by a test unless noted.

1. **The actions block is the LAST fenced block in a reply.**
   A reply may legitimately contain earlier fenced blocks (a code example, a
   JSON data array). Parsing must scan from the end and accept the first block
   that *looks like draw ops* (has an `op` field). Matching the first block
   instead lets a fenced JSON data array be applied as ops: nothing draws, the
   real block is never reached, and the data block vanishes from the chat.

2. **AI edits are applied inside `store.mergeRemoteChanges`.**
   Otherwise the AI's own drawing reads as a *user* edit, which re-triggers
   auto-watch, which makes the AI react to itself — forever.

3. **One bad draw op must not drop the batch.** Each op is applied in its own
   try/catch. A model that fumbles one shape still gets the rest drawn.

4. **Never use `crypto.randomUUID` for shape ids.** It's secure-context-only
   and the app is served over plain http on a LAN IP. Use tldraw's
   `createShapeId()`. (This one bit before; see README troubleshooting.)

5. **Vision must never block the chat.** Every failure path in snapshot
   capture/downscale falls back — to the original PNG, or to `null` and the
   text summary alone.

6. **The compaction window never starts on an assistant turn.** The Anthropic
   API rejects it.

7. **`MAX_TOKENS` must cover the reply text *and* a full actions block.** Too
   low truncates the JSON mid-block; it then fails to parse and the drawing is
   silently dropped. This is why it's 4096, not 1024.

8. **The board image attaches to the last user turn only** — not to earlier
   turns, and not to assistant turns.

9. **An aborted request is a cancel, not an error.** Keep whatever text
   streamed in; surface no error; drop the assistant bubble only if it's empty.

10. **API keys stay in `localStorage` and go only to the chosen provider.**
    Never logged, never committed, never sent anywhere else. *(Not test-pinned
    — enforced by review.)*

11. **Custom overlays depend only on `Editor` + `store.listen`.** Not on
    tldraw's `track`/`useEditor`. *(Not test-pinned — enforced by review.)*

12. **The scene passed to `applyBoardActions` must be the same one sent to the
    model.** Handles are per-turn labels; resolving a reply against a
    *different* scene would silently anchor to the wrong shapes.

13. **Connectors never count as occupancy.** Arrows, lines and highlights are
    excluded from collision avoidance. Including them pushes new shapes away
    from arrow tips — precisely where the user asked for them.

14. **`side: "tip"` defaults to `gap: 0`.** Any other default leaves a visible
    disconnect at the one place the user is being most precise about.

15. **The pointer is tracked with `source: 'user'`.** Otherwise the AI's own
    drawing becomes the pointer, and the next turn anchors to the AI's last
    output instead of the user's.

16. **`useLastEditedShape` returns a ref, not state.** It fires on every pen
    stroke; re-rendering the chat panel that often would stutter on an iPad.

---

## Tunables

| Where | Knob | Value | Trade-off |
|---|---|---|---|
| `boardContext.ts` | `MAX_IMAGE_EDGE` | 1280 | ↑ = better handwriting OCR, more vision tokens |
| `boardContext.ts` | `JPEG_QUALITY` | 0.85 | ↑ = clearer snapshot, bigger payload |
| `useAiChat.ts` | `MAX_HISTORY_MESSAGES` | 8 | ↑ = more memory, more tokens (each turn also carries an image) |
| `llmClient.ts` | `MAX_TOKENS` | 4096 | ↓ risks truncating an actions block — see invariant 7 |
| `useBoardWatcher.ts` | `DEFAULT_DELAY` | 2500ms | ↓ = twitchier auto-watch |
| `pwa.ts` | `UPDATE_POLL_MS` | 60000 | How often an open PWA checks for a new build |
| `exportBoard.ts` | `DEFAULT_PIXEL_RATIO` | 2 | Retina-crisp exports |
| vLLM | `--max-model-len` | — | Raise on "input length exceeds maximum context length" |
| Bridge | `MAX_THINKING_TOKENS` | 8000 | ↓ = faster agent replies |

## Module map

```
src/
  canvas/
    Whiteboard.tsx      tldraw host; owns PERSISTENCE_KEY; mounts the overlays
    ipadTuning.ts       touch detection, pen mode, iPad camera/snap defaults
    CanvasOverlay.tsx   floating controls: export / save / load / clear / pen toggle
    useEditorState.ts   subscribe to the tldraw store (useSyncExternalStore)
  export/
    exportBoard.ts      board or selection → PNG/SVG blob
    boardFile.ts        .tldr snapshot save/load
    shareOrDownload.ts  native share sheet on iPad, download elsewhere
    filename.ts         timestamped export filenames
    useExport.ts        \ React wrappers holding busy/error state
    useBoardFile.ts     /
  ai/
    AiPanel.tsx         chat UI + provider settings
    useAiChat.ts        conversation state, streaming, context, compaction, cancellation
    llmClient.ts        provider-agnostic streaming (Anthropic SDK + OpenAI SSE)
    settingsStore.ts    provider config in localStorage (+ legacy key migration)
    boardContext.ts     board → text summary, board → snapshot, fingerprint
    boardActions.ts     parse actions block → shapes, bindings, updates
    thinkFilter.ts      strip <think> from local reasoning models
    useBoardWatcher.ts  debounced change trigger for auto-watch
    useVoiceInput.ts    Web Speech API mic input
    — spatial grounding —
    geometry.ts         Bounds/Point helpers (tldraw-free)
    sceneGraph.ts       handles, reading order, arrow headings, prompt text (pure)
    boardScene.ts       Editor → scene adapter (the only tldraw-aware part)
    placement.ts        anchor+side → exact coordinates, with collision avoidance
    useLastEditedShape.ts  tracks the user's pointer shape
  pwa.ts                service-worker registration + update polling
  ErrorBoundary.tsx     top-level crash guard
claude-bridge/          headless Claude Code → OpenAI-compatible endpoint
docker-compose.yml      vLLM server for the local GPU model
```

## Known sharp edges

Things that look like bugs but are understood trade-offs, plus traps that have
actually bitten. The README's Troubleshooting table covers deployment symptoms;
these are *conceptual*.

- **ThinkFilter buffers the whole reply on the local provider.** A reasoning
  model may open its `<think>` block implicitly — the chat template emits the
  opening tag, so the model only ever sends the *closing* one. There's
  therefore no way to distinguish "reasoning in progress" from "a plain
  answer" until `</think>` arrives or the stream ends. Consequence: a
  *non*-reasoning local model shows nothing until its reply completes, with no
  token-by-token feel. Pinned by a test so nobody "fixes" it by accident.

- **`ThinkFilter` applies to `openai` only.** Gemini doesn't emit think tags,
  and filtering there would swallow a literal `<think>` in prose.

- **The bare-array fallback exists for small models** that forget the fence
  entirely. It's guarded by the has-an-`op`-field check so ordinary JSON in
  prose isn't hijacked, and its regex is greedy — worth revisiting if a reply
  ever contains two separate bare arrays.

- **Auto-watch + board-reply together are a loop risk.** Invariant 2 is the
  only thing preventing it.

- **Coverage excludes UI and browser-API wrappers on purpose.** Canvas capture,
  SpeechRecognition, service worker, file download/share. A unit test there
  asserts against its own mock, which buys percentage rather than confidence.
  They want Playwright; no E2E suite exists yet.

- **`npm run preview` ships a service worker** that can serve a stale bundle.
  Use `npm run dev` while iterating.

- **The scene is built *before* the model replies.** If the user edits the board
  while a reply streams, a handle can resolve to a moved — or deleted — shape.
  Unknown handles fall back to absolute coordinates rather than failing, but a
  long reply on a fast-changing board can still land slightly off.

- **The scene costs tokens**: roughly 20–40 per shape, every turn. There is no
  cap yet, so a very dense board will grow the prompt noticeably. If that bites,
  prioritise shapes near the pointer and the viewport and truncate the rest.

- **Handles renumber every turn.** S3 in one reply is not necessarily S3 in the
  next. They must never be persisted or referenced across turns.
