import { useCallback, useEffect, useRef, useState } from 'react'
import type { Editor, TLShapeId } from 'tldraw'
import { applyBoardActions, parseReply } from './boardActions'
import { captureBoardImage, getSelectedShapeIds, summarizeSelection } from './boardContext'
import { buildBoardScene, describeBoardScene } from './boardScene'
import type { SceneShape } from './sceneGraph'
import { useLastEditedShape } from './useLastEditedShape'
import { streamChat, type ChatTurn } from './llmClient'
import { getSettings, isConfigured, type AiSettings } from './settingsStore'

export interface ChatMessage {
  role: 'user' | 'assistant'
  text: string
  /** True for turns the app sent automatically in reaction to board edits. */
  auto?: boolean
}

export interface AiChatState {
  messages: ChatMessage[]
  isSending: boolean
  error: string | null
}

const SYSTEM_PROMPT = `You are a collaborative study partner working alongside the user on a shared whiteboard, like a study-group session. An image snapshot of the board is usually attached — read it directly, including handwriting, sketches and diagrams. A text summary of any typed shapes may also be provided as a hint, but trust the image as the source of truth. If both are empty, only then treat the board as blank.

Be an active collaborator, not just a Q&A bot: build on the user's ideas, ask clarifying or probing questions when it helps their thinking, point out gaps or connections in the notes, and suggest what to add or explore next. Keep responses conversational and concise — this is a live back-and-forth, not an essay.

DRAWING ON THE BOARD: When the user asks you to draw, sketch, diagram, label, or add something — or when a quick visual is clearly the natural next step — you may append ONE fenced code block at the very END of your reply, tagged \`tldraw\`, containing a JSON array of draw ops. Write your normal chat text first, then the block. Omit the block entirely for ordinary replies (most don't need it).

POSITIONING — read this carefully; it is what makes your drawing land in the right place.
Every shape already on the board is listed below with a HANDLE (S1, S2, …), its kind, its exact bounds and its text. Say WHERE your shapes go by anchoring to a handle. Do NOT estimate coordinates from the image — you cannot judge them accurately, and the app computes exact positions for you (including avoiding overlaps) when you anchor.

- {"op":"note","anchor":"S3","side":"right","gap":40,"text":"..."}
- {"op":"text","anchor":"S3","side":"below","text":"..."}
- {"op":"geo","shape":"rectangle|ellipse|triangle|diamond|hexagon|star|cloud","anchor":"S3","side":"right","w":N,"h":N,"text":"optional label","color":"blue"}
- {"op":"arrow","from":"S3","to":"S7","text":"optional label","color":"black"}
- {"op":"update","target":"S3","text":"replacement text"}
- {"op":"line","x1":N,"y1":N,"x2":N,"y2":N,"color":"black"}
- {"op":"image","url":"https://… or data:image/png;base64,…","anchor":"S3","side":"below","w":N,"h":N}

"side" is one of: right, left, above, below, center, tip. "tip" means the arrowhead end of an arrow handle — use it to continue a flow the user has started. "gap" is optional spacing in pixels (default 40, or 0 for tip).

ARROWS: prefer {"from":"S3","to":"S7"} with handles — that binds the arrow to those shapes so it stays attached when they are moved. Only use {"x1","y1","x2","y2"} when an end genuinely has no shape at it.

EDITING: use {"op":"update","target":"S3","text":"..."} to rewrite an existing shape's text instead of adding a near-duplicate next to it.

REFERRING TO SHAPES YOU CREATE: shapes you add in this reply get handles N1, N2, … in the order you list them, so a later op can anchor or connect to them. To extend a flow: add the box, then connect it.

ABSOLUTE COORDINATES: only when there is no sensible anchor (an empty board, or a deliberately unrelated position). Then give "x"/"y" in absolute page coordinates: x grows right, y grows down. Colors: black, grey, blue, light-blue, green, light-green, red, light-red, orange, yellow, violet, light-violet.

WHERE THE USER IS WORKING: if a USER POINTER is given below, the user is asking about that exact spot — anchor your response to it. If it is an arrow, continue from its tip.

Example — the user drew an arrow (S2) out of a "Cache" box (S1) and asked you to continue the flow:
\`\`\`tldraw
[{"op":"geo","shape":"rectangle","anchor":"S2","side":"tip","w":180,"h":90,"text":"Database","color":"blue"},{"op":"arrow","from":"N1","to":"S1","text":"read-through"}]
\`\`\``

const AUTO_PROMPT =
  "I just changed the board. React briefly in chat to the current contents: build on it, flag a gap, or ask one focused question. Don't repeat yourself, and don't draw on the board unless it's clearly the natural next step."

// Appended when the "Answer on board" toggle is on: the model writes its reply
// onto the canvas instead of the chat.
const BOARD_REPLY_DIRECTIVE =
  '\n\nANSWER-ON-BOARD MODE IS ON: Do not answer in the chat. Instead, respond by placing your answer directly on the whiteboard — emit a tldraw actions block that writes the answer as a note or text shape (plus any helpful diagram) inside the visible area, near but not overlapping existing content. Keep any chat text to at most a brief one-line confirmation.'

const INITIAL_STATE: AiChatState = { messages: [], isSending: false, error: null }

// Cap how many recent messages are sent to the model. Small, because each
// request also carries a board image (which is token-heavy). Raise this if you
// give the model a larger context window.
const MAX_HISTORY_MESSAGES = 8

/**
 * Keep only the last N messages, and never start the window on an assistant
 * turn (the Anthropic API requires the first message to be from the user).
 */
function trimHistory(messages: ChatMessage[]): ChatMessage[] {
  const recent = messages.slice(-MAX_HISTORY_MESSAGES)
  const firstUser = recent.findIndex((message) => message.role === 'user')
  return firstUser > 0 ? recent.slice(firstUser) : recent
}

/**
 * Drives the in-app AI collaboration chat. Streams replies from whichever
 * provider is configured (Anthropic or an OpenAI-compatible local server) and
 * appends the current board summary to the system prompt on every turn.
 */
export function useAiChat(editor: Editor) {
  const [state, setState] = useState<AiChatState>(INITIAL_STATE)
  const sendingRef = useRef(false)
  // The shape the user last drew or edited — the fallback "pointer" telling
  // the model where on the board the request is about.
  const lastEditedId = useLastEditedShape(editor)
  // Controls the in-flight request so it can be cancelled — by the user hitting
  // Stop, or by unmount. Without this a long local-model reply keeps streaming
  // into a dead component after the panel closes.
  const abortRef = useRef<AbortController | null>(null)
  // Latest committed messages, so `run` can read them without being
  // re-created and without racing with streaming state updates. Excludes the
  // empty placeholder bubble used while a reply streams in.
  // Written in an effect rather than during render; `run` only reads it from
  // event handlers and timers, which always run after the effect has committed.
  const stateMessagesRef = useRef<ChatMessage[]>(INITIAL_STATE.messages)
  useEffect(() => {
    stateMessagesRef.current = state.messages.filter(
      (message) => !(message.role === 'assistant' && message.text === ''),
    )
  }, [state.messages])

  const run = useCallback(
    async (userTurn: ChatMessage) => {
      if (sendingRef.current) return

      const settings = getSettings()
      if (!isConfigured(settings)) {
        setState((previous) => ({
          ...previous,
          error: 'Open settings and finish configuring your AI provider first.',
        }))
        return
      }

      sendingRef.current = true
      const controller = new AbortController()
      abortRef.current = controller
      const priorMessages = stateMessagesRef.current
      const withUser = [...priorMessages, userTurn]
      // Add an empty assistant bubble that we fill as tokens stream in.
      setState({ messages: [...withUser, { role: 'assistant', text: '' }], isSending: true, error: null })

      // Compact: only send the most recent turns to the model, so context
      // can't grow unbounded across a long session. The full transcript stays
      // in the UI; this only trims the API payload.
      const apiTurns: ChatTurn[] = trimHistory(withUser).map((message) => ({
        role: message.role,
        text: message.text,
      }))

      try {
        const context = buildContext(editor, settings, lastEditedId.current)
        const boardImage = await captureBoardImage(editor, context.imageShapeIds)
        const boardReplyDirective = settings.boardReply ? BOARD_REPLY_DIRECTIVE : ''

        const reply = await streamChat({
          settings,
          system: `${SYSTEM_PROMPT}\n\n${context.summary}${boardReplyDirective}`,
          messages: apiTurns,
          boardImage,
          signal: controller.signal,
          onToken: (delta) => {
            setState((previous) => ({
              ...previous,
              messages: appendToLastAssistant(previous.messages, delta),
            }))
          },
        })

        // Draw whatever the model asked for, and show the reply without the
        // raw actions block cluttering the chat bubble.
        const { text, actions } = parseReply(reply)
        // Pass the same scene the model saw, so its handles resolve to the
        // right shapes and placements are computed against real bounds.
        const createdIds = applyBoardActions(editor, actions, context.scene)
        const displayText =
          text || (createdIds.length > 0 ? '✏️ Added that to the board.' : reply)
        setState((previous) => ({
          ...previous,
          isSending: false,
          messages: setLastAssistantText(previous.messages, displayText),
        }))
      } catch (error) {
        if (controller.signal.aborted) {
          // Deliberate cancel, not a failure. Keep whatever streamed in so the
          // partial answer isn't thrown away; drop the bubble if it's empty.
          setState((previous) => ({
            messages: dropEmptyTrailingAssistant(previous.messages),
            isSending: false,
            error: null,
          }))
        } else {
          const message =
            error instanceof Error ? error.message : "The AI didn't respond. Please try again."
          // Drop the empty assistant placeholder, surface the error.
          setState({ messages: withUser, isSending: false, error: message })
        }
      } finally {
        sendingRef.current = false
        if (abortRef.current === controller) abortRef.current = null
      }
    },
    // lastEditedId is a ref, so its identity is stable — listing it satisfies
    // the exhaustive-deps rule without causing `run` to be rebuilt.
    [editor, lastEditedId],
  )

  const sendMessage = useCallback(
    (text: string) => run({ role: 'user', text }),
    [run],
  )

  const sendAuto = useCallback(
    () => run({ role: 'user', text: AUTO_PROMPT, auto: true }),
    [run],
  )

  /** Cancel the in-flight reply, keeping whatever has streamed in so far. */
  const stop = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  // Don't leave a stream running against an unmounted panel.
  useEffect(() => () => abortRef.current?.abort(), [])

  const clearError = useCallback(() => {
    setState((previous) => ({ ...previous, error: null }))
  }, [])

  const resetConversation = useCallback(() => {
    abortRef.current?.abort()
    setState(INITIAL_STATE)
  }, [])

  return { ...state, sendMessage, sendAuto, stop, clearError, resetConversation }
}

interface BoardContext {
  /** The labelled scene: visible area, shape inventory with bounds, pointer. */
  summary: string
  /** Shapes to snapshot for the image — the selection when focusing, else the whole page. */
  imageShapeIds?: TLShapeId[]
  /** The labelled shapes, so replies can be resolved back to real shape ids. */
  scene: SceneShape[]
}

/**
 * Assemble what the model is told about the board.
 *
 * The scene graph carries exact geometry for every shape, which is what lets
 * the model place things precisely — it anchors to a handle instead of
 * estimating coordinates off the snapshot. Focus mode still crops the *image*
 * to the selection, but the full inventory is always sent so the model can
 * position relative to anything on the board.
 */
function buildContext(
  editor: Editor,
  settings: AiSettings,
  lastEditedId: string | null,
): BoardContext {
  const scene = buildBoardScene(editor, lastEditedId)
  const description = describeBoardScene(scene)

  const selectedIds = settings.focusSelection ? getSelectedShapeIds(editor) : []
  if (selectedIds.length > 0) {
    return {
      summary: `${description}\n\nThe user has POINTED AT specific shapes — focus your response on these:\n${summarizeSelection(editor)}`,
      imageShapeIds: selectedIds,
      scene: scene.shapes,
    }
  }

  return { summary: description, scene: scene.shapes }
}

function appendToLastAssistant(messages: ChatMessage[], delta: string): ChatMessage[] {
  if (messages.length === 0) return messages
  return messages.map((message, index) =>
    index === messages.length - 1 && message.role === 'assistant'
      ? { ...message, text: message.text + delta }
      : message,
  )
}

/** Remove the streaming placeholder bubble if nothing ever arrived in it. */
function dropEmptyTrailingAssistant(messages: ChatMessage[]): ChatMessage[] {
  const last = messages[messages.length - 1]
  return last && last.role === 'assistant' && last.text === '' ? messages.slice(0, -1) : messages
}

function setLastAssistantText(messages: ChatMessage[], text: string): ChatMessage[] {
  if (messages.length === 0) return messages
  return messages.map((message, index) =>
    index === messages.length - 1 && message.role === 'assistant' ? { ...message, text } : message,
  )
}
