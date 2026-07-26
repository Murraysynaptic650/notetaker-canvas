import { describe, expect, it } from 'vitest'
import { ThinkFilter } from './thinkFilter'

/** Feed chunks through a filter and return everything it chose to emit. */
function run(chunks: string[]): string {
  const filter = new ThinkFilter()
  return chunks.map((chunk) => filter.push(chunk)).join('') + filter.flush()
}

describe('ThinkFilter', () => {
  it('drops an explicit <think>…</think> block', () => {
    expect(run(['<think>reasoning here</think>The answer.'])).toBe('The answer.')
  })

  it('drops an implicit block that only emits the closing tag', () => {
    // vLLM chat templates often open <think> themselves, so the model streams
    // reasoning with no opening tag at all.
    expect(run(['let me work through this</think>42'])).toBe('42')
  })

  it('passes plain answers through untouched when there is no reasoning', () => {
    expect(run(['Hello ', 'world.'])).toBe('Hello world.')
  })

  it('handles a closing tag split across chunk boundaries', () => {
    expect(run(['thinking</thi', 'nk>Done.'])).toBe('Done.')
  })

  it('strips leading whitespace between the tag and the answer', () => {
    expect(run(['x</think>\n\n  Answer'])).toBe('Answer')
  })

  it('streams everything after the tag without further buffering', () => {
    const filter = new ThinkFilter()
    expect(filter.push('reasoning</think>A')).toBe('A')
    expect(filter.push('B')).toBe('B')
    expect(filter.flush()).toBe('')
  })

  it('never emits reasoning text before the closing tag arrives', () => {
    const filter = new ThinkFilter()
    expect(filter.push('secret reasoning')).toBe('')
    expect(filter.push(' more reasoning')).toBe('')
  })

  it('ignores a second </think> appearing inside the answer', () => {
    expect(run(['r</think>answer with </think> literal'])).toBe('answer with </think> literal')
  })

  it('emits nothing at all for an empty stream', () => {
    expect(run([])).toBe('')
  })

  it('flushes buffered text only once', () => {
    const filter = new ThinkFilter()
    filter.push('unclosed reasoning')
    expect(filter.flush()).toBe('unclosed reasoning')
    expect(filter.flush()).toBe('')
  })
})
