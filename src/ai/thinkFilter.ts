/**
 * Strips reasoning tokens out of a streamed token feed, so reasoning models
 * (e.g. Nemotron on local vLLM) don't dump their chain-of-thought into the chat
 * bubble or corrupt the drawing-action parser.
 *
 * Handles all three shapes seen in the wild:
 *  1. Explicit block:  `<think>…</think>answer`
 *  2. Implicit open:   `…reasoning…</think>answer`  (the chat template opens the
 *     think block itself, so the model only ever emits the CLOSING tag)
 *  3. No reasoning:    `answer`  (no tags at all)
 *
 * Strategy: everything up to and including the first `</think>` is reasoning and
 * is discarded; the answer after it streams normally. If the stream ends without
 * a `</think>`, we assume there was no reasoning block and emit what we buffered,
 * so a plain answer is never swallowed.
 */
export class ThinkFilter {
  private pastReasoning = false
  private buffer = ''

  /** Feed a raw chunk; returns the text that's safe to display now. */
  push(chunk: string): string {
    if (this.pastReasoning) return chunk

    this.buffer += chunk
    const idx = this.buffer.indexOf('</think>')
    if (idx === -1) return '' // still inside (or possibly no) reasoning — hold.

    this.pastReasoning = true
    const answer = this.buffer.slice(idx + '</think>'.length).replace(/^\s+/, '')
    this.buffer = ''
    return answer
  }

  /** Emit any buffered text once the stream ends. */
  flush(): string {
    if (this.pastReasoning) return ''
    // Never saw a closing tag → treat the whole thing as the answer rather than
    // dropping it (covers responses with no reasoning block).
    const text = this.buffer
    this.buffer = ''
    return text
  }
}
