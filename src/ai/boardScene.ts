import type { Editor, TLShape } from 'tldraw'
import { extractShapeText } from './boardContext'
import type { Bounds, Point } from './geometry'
import {
  assignHandles,
  describeScene,
  pickPointer,
  type RawShape,
  type SceneShape,
} from './sceneGraph'

/**
 * Adapter between tldraw and the pure scene-graph layer. Everything that
 * touches the Editor lives here; `sceneGraph.ts` stays framework-free so the
 * labelling, ordering and description logic can be tested directly.
 */

export interface BoardScene {
  shapes: SceneShape[]
  /** The shape the user is pointing at — their selection, else their last edit. */
  pointer: SceneShape | null
  viewport: Bounds
}

/** Read the current page into a labelled scene. */
export function buildBoardScene(editor: Editor, lastEditedId: string | null): BoardScene {
  const viewport = toBounds(editor.getViewportPageBounds())
  const raw = editor
    .getCurrentPageShapes()
    .map((shape) => toRawShape(editor, shape))
    .filter((shape): shape is RawShape => shape !== null)

  const shapes = assignHandles(raw)
  const selectedIds = editor.getSelectedShapeIds().map(String)

  return { shapes, pointer: pickPointer(shapes, selectedIds, lastEditedId), viewport }
}

/** Render the scene as the spatial section of the system prompt. */
export function describeBoardScene(scene: BoardScene): string {
  return describeScene(scene.shapes, scene.viewport, scene.pointer)
}

function toRawShape(editor: Editor, shape: TLShape): RawShape | null {
  const bounds = editor.getShapePageBounds(shape)
  // A shape with no measurable bounds can't be placed relative to, and giving
  // the model a handle it can't use is worse than omitting it.
  if (!bounds) return null

  // Defensive: one malformed shape must not throw and take the whole scene
  // (and therefore all spatial grounding) down with it.
  const props = (shape.props ?? {}) as Record<string, unknown>

  return {
    id: String(shape.id),
    type: shape.type,
    subType: typeof props.geo === 'string' ? props.geo : undefined,
    bounds: toBounds(bounds),
    text: extractShapeText(shape) ?? '',
    arrow: toArrowTerminals(shape, props),
  }
}

/**
 * Arrow terminals are stored relative to the shape's own origin, but every
 * coordinate the model sees is absolute page space — so translate them.
 */
function toArrowTerminals(
  shape: TLShape,
  props: Record<string, unknown>,
): { start: Point; end: Point } | undefined {
  if (shape.type !== 'arrow') return undefined

  const start = toPoint(props.start)
  const end = toPoint(props.end)
  if (!start || !end) return undefined

  return {
    start: { x: shape.x + start.x, y: shape.y + start.y },
    end: { x: shape.x + end.x, y: shape.y + end.y },
  }
}

function toPoint(value: unknown): Point | null {
  if (!value || typeof value !== 'object') return null
  const record = value as { x?: unknown; y?: unknown }
  if (typeof record.x !== 'number' || typeof record.y !== 'number') return null
  return { x: record.x, y: record.y }
}

function toBounds(box: { minX: number; minY: number; maxX: number; maxY: number }): Bounds {
  return { minX: box.minX, minY: box.minY, maxX: box.maxX, maxY: box.maxY }
}
