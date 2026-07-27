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
back onto an infinite canvas, running against a model on your own GPU, on an
iPad."** Every post should lead with that sentence.
