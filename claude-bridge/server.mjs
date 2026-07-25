import http from 'node:http'
import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { query } from '@anthropic-ai/claude-agent-sdk'

/**
 * Claude Code bridge.
 *
 * Exposes a headless Claude Code agent as an OpenAI-compatible
 * `/v1/chat/completions` endpoint, so the notetaker chat can route questions to
 * it as just another provider. It answers general Q&A, can run commands / read
 * & write files on this machine (scoped to ./workspace), and can see the
 * whiteboard (the board image is written to a temp file the agent can Read).
 *
 * Auth: set CLAUDE_CODE_OAUTH_TOKEN (from `claude setup-token`) or
 * ANTHROPIC_API_KEY in the environment. Personal, single-user use only.
 */

const PORT = Number(process.env.CLAUDE_BRIDGE_PORT || 8790)
const MODEL = process.env.CLAUDE_BRIDGE_MODEL || 'sonnet'
const ALLOWED_TOOLS = ['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep']

// Lowest reasoning effort → fastest replies. The board study-partner rarely
// needs deep chains of thought, so we cap thinking to the minimum budget.
// Bump MAX_THINKING_TOKENS / CLAUDE_BRIDGE_THINKING to trade speed for depth.
if (!process.env.MAX_THINKING_TOKENS) {
  process.env.MAX_THINKING_TOKENS = process.env.CLAUDE_BRIDGE_THINKING || '1024'
}

// The agent's system prompt (a custom string — the SDK sends only this, plus
// tool schemas). Makes the agent explicitly whiteboard-aware and succinct.
const BRIDGE_SYSTEM =
  'You are the AI study partner operating INSIDE a collaborative whiteboard app — not a terminal. ' +
  "A snapshot of the user's whiteboard is usually provided as an image file: read it and respond to what " +
  'is actually on the board, treating the notes and sketches there as the shared context. Answer SUCCINCTLY ' +
  'and conversationally by default; expand only when the user explicitly asks for depth. When a question needs ' +
  'real computation, you may run commands and read/write files in your working directory to work it out, then ' +
  'give the answer plainly. The instructions that follow (if any) describe how to collaborate on and draw on ' +
  'the board — honour them.'

const HERE = dirname(fileURLToPath(import.meta.url))
const WORKSPACE = join(HERE, 'workspace')
mkdirSync(WORKSPACE, { recursive: true })

if (!process.env.CLAUDE_CODE_OAUTH_TOKEN && !process.env.ANTHROPIC_API_KEY) {
  console.warn(
    '[claude-bridge] No CLAUDE_CODE_OAUTH_TOKEN or ANTHROPIC_API_KEY set — requests will fail auth.',
  )
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS)
    res.end()
    return
  }

  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`)

  if (req.method === 'GET' && url.pathname === '/v1/models') {
    res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' })
    res.end(
      JSON.stringify({
        object: 'list',
        data: [{ id: 'claude-code', object: 'model', owned_by: 'anthropic' }],
      }),
    )
    return
  }

  if (req.method === 'POST' && url.pathname === '/v1/chat/completions') {
    try {
      const body = await readJson(req)
      await handleChat(body, res)
    } catch (error) {
      sendError(res, error)
    }
    return
  }

  res.writeHead(404, CORS)
  res.end('Not found')
})

server.listen(PORT, () => {
  console.log(`[claude-bridge] listening on http://localhost:${PORT}  (model: ${MODEL})`)
  console.log(`[claude-bridge] workspace: ${WORKSPACE}`)
})

async function handleChat(body, res) {
  const messages = Array.isArray(body?.messages) ? body.messages : []
  const { systemText, prompt, imagePath } = buildPrompt(messages)
  const systemPrompt = systemText ? `${BRIDGE_SYSTEM}\n\n${systemText}` : BRIDGE_SYSTEM

  res.writeHead(200, {
    ...CORS,
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  })
  const id = `chatcmpl-${randomUUID()}`
  const send = (delta) => {
    const chunk = {
      id,
      object: 'chat.completion.chunk',
      choices: [{ index: 0, delta: { content: delta } }],
    }
    res.write(`data: ${JSON.stringify(chunk)}\n\n`)
  }

  let streamedAny = false
  try {
    for await (const message of query({
      prompt,
      options: {
        model: MODEL,
        systemPrompt,
        cwd: WORKSPACE,
        allowedTools: ALLOWED_TOOLS,
        permissionMode: 'acceptEdits',
        // Don't inherit the machine's global ~/.claude config into the bridge.
        settingSources: [],
      },
    })) {
      const text = extractAssistantText(message)
      if (text) {
        send(text)
        streamedAny = true
      } else if (message?.type === 'result' && !streamedAny && typeof message.result === 'string') {
        send(message.result)
        streamedAny = true
      }
    }
  } catch (error) {
    send(`\n\n[claude-bridge error: ${error?.message ?? error}]`)
  } finally {
    res.write('data: [DONE]\n\n')
    res.end()
    if (imagePath) {
      try {
        rmSync(imagePath, { force: true })
      } catch {
        /* best-effort temp cleanup */
      }
    }
  }
}

/**
 * Flatten an OpenAI-style messages array. Returns the app's system text (which
 * the caller puts into the real system prompt), the user prompt (conversation +
 * board-image note + the ask), and an optional temp board-image file path.
 */
function buildPrompt(messages) {
  let systemText = ''
  const turns = []
  let imagePath = null

  for (const message of messages) {
    const { text, imageDataUrl } = extractContent(message?.content)
    if (message?.role === 'system') {
      systemText += (systemText ? '\n\n' : '') + text
      continue
    }
    if (imageDataUrl && !imagePath) imagePath = saveImage(imageDataUrl)
    if (text) turns.push(`${message?.role === 'assistant' ? 'Assistant' : 'User'}: ${text}`)
  }

  const parts = []
  if (imagePath) {
    parts.push(
      `A snapshot of the user's whiteboard has been saved at "${imagePath}". ` +
        'If the question relates to the board, use the Read tool to view that image file.',
    )
  }
  if (turns.length) parts.push('Conversation so far:\n' + turns.join('\n'))
  parts.push('Respond to the latest User message.')
  return { systemText, prompt: parts.join('\n\n'), imagePath }
}

function extractContent(content) {
  if (typeof content === 'string') return { text: content, imageDataUrl: null }
  if (!Array.isArray(content)) return { text: '', imageDataUrl: null }

  let text = ''
  let imageDataUrl = null
  for (const part of content) {
    if (part?.type === 'text' && typeof part.text === 'string') {
      text += part.text
    } else if (part?.type === 'image_url' && typeof part.image_url?.url === 'string') {
      if (part.image_url.url.startsWith('data:')) imageDataUrl = part.image_url.url
    }
  }
  return { text, imageDataUrl }
}

function saveImage(dataUrl) {
  const match = /^data:(image\/\w+);base64,(.*)$/s.exec(dataUrl)
  if (!match) return null
  const ext = match[1] === 'image/jpeg' ? 'jpg' : match[1].split('/')[1]
  const path = join(WORKSPACE, `board-${randomUUID()}.${ext}`)
  writeFileSync(path, Buffer.from(match[2], 'base64'))
  return path
}

function extractAssistantText(message) {
  try {
    if (message?.type !== 'assistant') return ''
    const content = message.message?.content
    if (!Array.isArray(content)) return ''
    return content
      .filter((block) => block?.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text)
      .join('')
  } catch {
    return ''
  }
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (chunk) => {
      data += chunk
      if (data.length > 64 * 1024 * 1024) reject(new Error('request body too large'))
    })
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {})
      } catch (error) {
        reject(error)
      }
    })
    req.on('error', reject)
  })
}

function sendError(res, error) {
  if (!res.headersSent) {
    res.writeHead(500, { ...CORS, 'Content-Type': 'application/json' })
  }
  res.end(JSON.stringify({ error: { message: error?.message ?? String(error) } }))
}
