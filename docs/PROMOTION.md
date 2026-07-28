# Reaching an audience

Notes on getting Notetaker Canvas in front of people. Ordered by leverage, not
by effort — the first section is worth more than everything after it.

---

## 0. Before you post anywhere

Launch posts convert on the first three seconds. Right now the repo has no
visual, which caps every channel below at a fraction of its potential.

**Do these first — in this order:**

1. **A GIF at the top of the README.** Not a screenshot: a 10–15 second loop of
   you sketching a diagram with the Pencil, tapping 💬, and the AI *drawing an
   answer onto the board*. That last beat is the entire pitch and no text
   conveys it. Record on the iPad (Control Centre → Screen Recording), trim,
   convert to GIF or an MP4 (GitHub renders both inline).
2. **A live demo link.** Deploy the static build to Vercel/Netlify/GitHub
   Pages — it's a Vite SPA, so it's a one-command deploy. Users bring their own
   API key, so the demo costs you nothing to host. "Try it" beats "clone it" by
   an order of magnitude.
3. **A one-line description you can repeat verbatim** everywhere. Something
   like: *"An infinite whiteboard for iPad where the AI can see your
   handwriting and draw its answer back onto the canvas."* Lead with the
   behaviour, not the stack.

Sequencing matters: post *after* the GIF and demo exist. A launch is a one-shot
resource — you don't get a second front page.

---

## 1. Two honest blockers to resolve first

**tldraw's license.** tldraw v3's SDK is *not* MIT. Free use requires their
watermark; removing it needs a commercial license. Your own code being MIT
doesn't change that. Before you encourage anyone to build on this, read
tldraw's current terms and state the constraint plainly in the README — a
contributor who discovers it after investing a weekend will be justifiably
annoyed. This is a footnote if you're honest about it up front and a credibility
problem if you're not.

**The Claude Code bridge is personal-use only.** Anthropic doesn't permit
serving claude.ai-subscription access to other people. Your README already says
this — keep that warning prominent, because the single most likely
"contribution" someone will propose is hosting the bridge as a shared service.
That request needs a standing, visible "no".

---

## 2. Channels, ranked

### Highest signal

| Channel | Why it fits | How to approach it |
|---|---|---|
| **r/ipad, r/apple, r/GoodNotes** | The actual users. People there are *actively* dissatisfied with Notability/GoodNotes' AI features. | Post the GIF, lead with the iPad/Pencil experience, mention it's free and open-source at the *end*. These subs punish anything that reads as marketing. |
| **Hacker News (Show HN)** | Its audience is exactly "local-model, bring-your-own-key, PWA, no telemetry". | Title: `Show HN: Notetaker Canvas – an AI whiteboard for iPad that draws its answers`. Post Tue–Thu, ~9am ET. First comment should be *you* explaining the technical choices — the tldraw-ops parsing and the Vite relay for Tailscale are genuinely interesting and will drive the thread. |
| **r/LocalLLaMA** | Your vLLM/Ollama path is the hook. This community loves a real UI for a local model. | Frame it as *"a whiteboard front-end for your local vision model"*. The `docker-compose.yml` + MIG notes + `<think>` filtering are the content — that crowd rewards specifics. |
| **tldraw's own community** | Discord + their showcase. They actively signal-boost things built on the SDK. | Ask to be added to their community showcase. Low effort, durable traffic, and it reaches people already sold on canvas apps. |

### Worth doing, lower ceiling

- **X / Bluesky** — post the GIF as native video. Tag `@tldraw`. The AI-drawing
  moment is inherently shareable; the thread matters less than the clip.
- **Product Hunt** — good for a burst of non-technical users. Needs the demo
  link and 3–4 polished screenshots. Launch Tue–Thu.
- **Lobste.rs** — smaller than HN but higher-quality discussion. Needs an
  invite; don't self-promote there without other contributions first.
- **awesome-lists** — PRs to `awesome-tldraw`, `awesome-ai-tools`,
  `awesome-selfhosted`, `awesome-pwa`. Slow, compounding, near-zero effort.
- **A short write-up** — dev.to / your own blog. The strongest angle isn't the
  app, it's the *problem*: "getting an LLM to draw on a canvas" — the ops
  format, why the last fenced block wins, the snapshot/token trade-off. That
  post is linkable forever and pulls people back to the repo.

### Skip

Cold-emailing edtech newsletters, paid promotion, and Discord servers you
haven't participated in. Poor conversion, and the last one gets you banned.

---

## 3. Make the repo convert

Traffic is wasted on a repo that doesn't close.

- **Description + topics** — set by the publish script; they feed GitHub search.
- **`good first issue` labels** — file 3–5 small, genuinely scoped issues before
  launching. The E2E gap (`docs/GLOSSARY.md` sharp edges) is an ideal one; so is
  "add an Ollama preset". Contributors need a door.
- **Pin the repo** on your profile.
- **A `docs/` link in the sidebar** — `GLOSSARY.md` is unusually good and is
  strong evidence the project is seriously maintained. Say so in the README.
- **Respond within 24h** for the first two weeks. Early responsiveness is what
  turns a spike into a handful of regulars.

---

## 4. Realistic expectations

A well-executed Show HN for a project like this lands somewhere between 50 and
500 stars, and the number is mostly noise. What actually matters is the two or
three people who file a real issue or use it daily — that's the signal worth
optimising for.

The honest differentiator isn't "AI whiteboard" (crowded). It's **"AI that draws
back onto an infinite canvas, exactly where you point, running against a model
on your own GPU."** Every post should lead with that sentence.

---

## 5. Ready-to-post copy

Drafts, not scripts — rewrite them in your own voice before posting. Anything
that reads as copy-paste marketing gets downvoted on Reddit and ignored on
LinkedIn.

**Two rules that matter more than the wording:**

1. **Post the clip, not the repo.** Every one of these assumes a GIF/video of
   the AI drawing onto the board. Without it, halve your expectations.
2. **Disclose that you built it.** "I built" / "my project" in the first line.
   Reddit is unforgiving about undisclosed self-promotion, and most subs have a
   rule requiring it.

### Reddit

Read each sub's rules before posting — several require a flair, restrict
self-promo to specific days, or enforce a ratio of participation to promotion.
Space posts a few days apart; the same link across five subs in one hour reads
as spam and can get you site-wide filtered.

**r/SideProject / r/opensource** — the friendliest starting point.

> **Title:** I built an infinite whiteboard where the AI draws its answer back onto the canvas
>
> I kept sketching diagrams and then re-typing them into a chat box to ask about
> them. So I built the thing I wanted: a whiteboard where the model sees the
> board itself — handwriting included — and answers by drawing on it.
>
> The part that took longest was making placement *precise*. Asking a vision
> model for coordinates off a flat screenshot doesn't work; it guesses. So the
> model gets a labelled inventory of every shape with its exact bounds, and says
> "put a box at the tip of S2" — the app does the arithmetic. Draw an arrow, ask
> "what goes here?", and the answer lands at the arrowhead.
>
> Runs in any browser, installs as a PWA, board stays local. Bring your own key
> (Claude/Gemini), or point it at a local model on your own GPU.
>
> MIT, no account, no backend: <link>. Happy to answer anything.

**r/LocalLLaMA** — lead with the local-model angle; this crowd wants specifics.

> **Title:** A whiteboard front-end for your local vision model — it reads handwriting and draws back onto the canvas
>
> I wanted my local model to be useful for *studying*, not just chat. This is an
> infinite canvas that screenshots itself to the model each turn, so a vision
> model can read handwriting and sketches, then reply by drawing shapes onto the
> board.
>
> Local-model notes, since that's the interesting bit here:
> - OpenAI-compatible, so vLLM or Ollama works. `docker-compose.yml` included
>   (Qwen2.5-VL-7B-AWQ on a MIG slice).
> - Reasoning models emit `<think>`, sometimes with only the *closing* tag
>   because the chat template opens it. There's a filter for that.
> - Snapshots are capped at 1280px/JPEG to bound vision tokens — raise it for
>   better handwriting OCR at the cost of context.
> - The browser can't reach a Tailscale-only GPU box from an iPad, so the dev
>   server relays same-origin `/llm/v1` to it. No CORS, no mixed content.
>
> <link> — MIT. Curious what other people's local vision models make of
> handwriting; mine are hit-or-miss below 7B.

**r/ipad, r/GoodNotes, r/Notability** — no jargon at all. These are users.

> **Title:** I made a free whiteboard app where the AI can read your handwriting and draw on the page with you
>
> I got tired of note apps where the "AI" just summarises typed text. This one
> can actually see the page — handwriting, arrows, sketches — and answers by
> drawing onto it.
>
> The bit I use most: draw an arrow to an empty spot and ask what goes there.
> It fills in that exact spot.
>
> Works in Safari and installs to the Home Screen like a normal app. Apple
> Pencil with palm rejection. Free and open-source; you supply your own API key.
>
> <link>

### LinkedIn

Different game: no link in the first two lines (the feed suppresses posts with
early links — put it in the first comment), short paragraphs, and a point that
isn't "look at my project".

> Most "AI + notes" features summarise text you already typed.
>
> I wanted the opposite: an AI that works on the page *with* you. So I built an
> infinite whiteboard where the model sees the board as an image — handwriting
> and all — and replies by drawing on it.
>
> The hard part wasn't the model. It was placement.
>
> If you ask a vision model to put a shape at specific coordinates, it guesses,
> because it's reading a flat image with no coordinate frame. Results land
> "somewhere near" where you wanted. That's the difference between a demo and
> something you'd actually use.
>
> The fix was to stop asking. The model now receives a labelled inventory of
> every shape with its exact geometry, and positions things *relative* to them —
> "a box at the tip of that arrow." The app computes the coordinates. Draw an
> arrow, ask what goes next, and the answer lands at the arrowhead.
>
> A few things I'd do the same way again:
> → Bring-your-own-key. No accounts, no backend, nothing to host.
> → Runs against a local model on your own GPU if you'd rather nothing leave
>   your network.
> → Board data stays in the browser.
>
> Open-source (MIT). Link in the comments — I'd genuinely like feedback on the
> placement approach, which I suspect generalises beyond whiteboards.

### Hacker News

Covered in §2, but the first comment matters more than the post. Lead with the
thing an HN reader will actually argue about: *why absolute coordinates from a
vision model don't work, and what replaced them.* Mention the `<think>`
implicit-open case and the same-origin relay for Tailscale — both are concrete,
both invite the "actually, you could…" replies that keep a thread alive.

### After posting

- Answer every top-level comment for the first 6 hours. Response rate drives
  ranking on Reddit far more than upvote count.
- Expect "why not just use Excalidraw/tldraw/FigJam?" — have a one-line answer
  ready: *those are canvases; this is a canvas the model can read and draw on.*
- Expect "is my data going anywhere?" — no backend, keys in localStorage, board
  in IndexedDB. Say it plainly, and **don't overclaim**: a board snapshot does
  go to whichever provider the user picked, on every turn. Volunteer that
  before someone else points it out, and note that a local model keeps it on
  their own network. Getting caught overstating privacy is unrecoverable with
  this audience.
- Expect the tldraw licensing question. Answer it honestly (§1) rather than
  deflecting; getting caught hedging costs more than the constraint does.
