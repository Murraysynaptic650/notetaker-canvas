import { describe, expect, it } from 'vitest'
import { parseReply } from './boardActions'

describe('parseReply', () => {
  it('returns the text unchanged when there is no actions block', () => {
    const raw = 'Photosynthesis converts light into chemical energy.'
    expect(parseReply(raw)).toEqual({ text: raw, actions: [] })
  })

  it('extracts a ```tldraw block and strips it from the text', () => {
    const raw = `Here's a diagram.

\`\`\`tldraw
[{"op":"note","x":10,"y":20,"text":"Hello"}]
\`\`\``
    const { text, actions } = parseReply(raw)
    expect(text).toBe("Here's a diagram.")
    expect(actions).toEqual([{ op: 'note', x: 10, y: 20, text: 'Hello' }])
  })

  it('accepts a ```json fence', () => {
    const raw = 'Done.\n```json\n[{"op":"text","x":0,"y":0,"text":"hi"}]\n```'
    expect(parseReply(raw).actions).toHaveLength(1)
  })

  it('accepts a bare ``` fence', () => {
    const raw = 'Done.\n```\n[{"op":"text","x":0,"y":0,"text":"hi"}]\n```'
    expect(parseReply(raw).actions).toHaveLength(1)
  })

  it('falls back to a bare JSON array when the model forgets the fence', () => {
    const raw = 'Adding that now. [{"op":"geo","shape":"rectangle","x":5,"y":5,"w":10,"h":10}]'
    const { text, actions } = parseReply(raw)
    expect(text).toBe('Adding that now.')
    expect(actions).toHaveLength(1)
  })

  it('ignores a bare array that is not draw ops', () => {
    const raw = 'The data was [{"name":"Ada"},{"name":"Alan"}] in the table.'
    const { text, actions } = parseReply(raw)
    expect(actions).toEqual([])
    expect(text).toBe(raw)
  })

  it('ignores a fenced block that is not a JSON array', () => {
    const raw = 'Try this:\n```python\nprint("hi")\n```'
    expect(parseReply(raw)).toEqual({ text: raw, actions: [] })
  })

  it('ignores a fenced JSON object that is not an array of ops', () => {
    const raw = 'Config:\n```json\n{"key":"value"}\n```'
    expect(parseReply(raw).actions).toEqual([])
  })

  it('trims surrounding whitespace from the remaining text', () => {
    const raw = '  Look.  \n\n```tldraw\n[{"op":"note","x":0,"y":0,"text":"n"}]\n```\n\n  '
    expect(parseReply(raw).text).toBe('Look.')
  })

  it('uses the LAST fenced block when the reply also contains a code example', () => {
    // The system prompt tells the model to append the actions block at the very
    // END of the reply, so a code sample earlier in the answer must not be
    // mistaken for it — nor swallow the real actions block.
    const raw = `Here's the loop:

\`\`\`python
for i in range(3):
    print(i)
\`\`\`

And here it is on the board:

\`\`\`tldraw
[{"op":"note","x":100,"y":100,"text":"for loop"}]
\`\`\``
    const { text, actions } = parseReply(raw)
    expect(actions).toEqual([{ op: 'note', x: 100, y: 100, text: 'for loop' }])
    expect(text).toContain('for i in range(3):')
    expect(text).not.toContain('"op"')
  })

  it('picks the actions block over an earlier fenced JSON data array', () => {
    // Sharper than the case above: this earlier fence parses as a valid JSON
    // array, so a first-match parser accepts it and never reaches the real
    // actions block — the drawing silently never happens.
    const raw = `Your data:

\`\`\`json
[{"name":"Ada","born":1815},{"name":"Alan","born":1912}]
\`\`\`

Charted on the board:

\`\`\`tldraw
[{"op":"note","x":50,"y":50,"text":"Ada 1815"}]
\`\`\``
    const { text, actions } = parseReply(raw)
    expect(actions).toEqual([{ op: 'note', x: 50, y: 50, text: 'Ada 1815' }])
    expect(text).toContain('"name":"Ada"')
  })

  it('keeps a code example intact when there is no actions block at all', () => {
    const raw = 'Example:\n\n```python\nprint("hi")\n```\n\nThat prints hi.'
    const { text, actions } = parseReply(raw)
    expect(actions).toEqual([])
    expect(text).toBe(raw.trim())
  })

  it('handles an empty reply', () => {
    expect(parseReply('')).toEqual({ text: '', actions: [] })
  })

  it('handles a reply that is only an actions block', () => {
    const raw = '```tldraw\n[{"op":"note","x":1,"y":2,"text":"solo"}]\n```'
    const { text, actions } = parseReply(raw)
    expect(text).toBe('')
    expect(actions).toHaveLength(1)
  })

  it('parses a multi-op block preserving order', () => {
    const raw =
      '```tldraw\n[{"op":"geo","shape":"rectangle","x":0,"y":0,"w":10,"h":10},{"op":"arrow","x1":0,"y1":0,"x2":5,"y2":5}]\n```'
    const { actions } = parseReply(raw)
    expect(actions).toHaveLength(2)
    expect((actions[0] as { op: string }).op).toBe('geo')
    expect((actions[1] as { op: string }).op).toBe('arrow')
  })

  it('tolerates an unterminated fence without hanging or throwing', () => {
    const raw = 'Working on it:\n```tldraw\n[{"op":"note","x":0,"y":0,"text":"cut off"'
    expect(() => parseReply(raw)).not.toThrow()
  })
})
