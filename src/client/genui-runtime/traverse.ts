/** Canonical traversal of the GenUI component tree. */
import { COMPONENT_SCHEMAS, type ComponentDefinition } from './schema.ts'

/** A node-like record passed to traversal visitors. */
export interface TraversedGenuiNode {
  readonly node: Record<string, unknown>
  readonly path: string
  readonly depth: number
  readonly component?: ComponentDefinition
}

/** Visitor invoked once for every component node, including opaque custom nodes. */
export type GenuiNodeVisitor = (entry: TraversedGenuiNode) => void

/** Optional traversal ceiling for hostile or streaming inputs. */
export interface GenuiTraversalOptions {
  readonly maxNodes?: number
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

/** Visit all component nodes using child declarations from the runtime registry. */
export function visitGenuiNodes(value: unknown, visitor: GenuiNodeVisitor, options: GenuiTraversalOptions = {}): void {
  const root = record(value)
  if (root === undefined) return
  const state = { visited: 0, maxNodes: options.maxNodes ?? Number.POSITIVE_INFINITY }
  // A root with `type` is a bare component, even when that component itself
  // owns an `items` field (for example `card`). Root specs never use `type`.
  if (typeof root.type === 'string') {
    visitNode(root, 'spec', visitor, state)
  } else if (Array.isArray(root.items)) {
    visitNodeList(root.items, 'items', visitor, state, 0)
  }
}

/** Count component nodes through the canonical traversal. */
export function countGenuiNodes(value: unknown, cap = Number.POSITIVE_INFINITY): number {
  let count = 0
  visitGenuiNodes(value, () => { count += 1 }, { maxNodes: cap })
  return count
}

function visitNodeList(value: unknown, path: string, visitor: GenuiNodeVisitor, state: { visited: number; maxNodes: number }, depth: number): void {
  if (!Array.isArray(value)) return
  for (let index = 0; index < value.length && state.visited < state.maxNodes; index++) visitNode(value[index], `${path}[${index}]`, visitor, state, depth)
}

function visitNode(value: unknown, path: string, visitor: GenuiNodeVisitor, state: { visited: number; maxNodes: number }, depth = 0): void {
  if (state.visited >= state.maxNodes) return
  const node = record(value)
  if (node === undefined || typeof node.type !== 'string') return
  const component = COMPONENT_SCHEMAS[node.type]
  state.visited += 1
  visitor({ node, path, depth, ...(component === undefined ? {} : { component }) })
  // Unknown component payloads are intentionally opaque.
  if (component === undefined || component.children === undefined) return
  for (const child of component.children) {
    const fieldValue = node[child.field]
    if (child.kind === 'nodes') {
      visitNodeList(fieldValue, `${path}.${child.field}`, visitor, state, depth + 1)
      continue
    }
    if (!Array.isArray(fieldValue)) continue
    for (let index = 0; index < fieldValue.length; index++) {
      const holder = record(fieldValue[index])
      if (holder === undefined || child.childrenField === undefined) continue
      const nested = holder[child.childrenField]
      if (Array.isArray(nested)) visitNodeList(nested, `${path}.${child.field}[${index}].${child.childrenField}`, visitor, state, depth + 1)
      else visitNode(nested, `${path}.${child.field}[${index}].${child.childrenField}`, visitor, state, depth + 1)
    }
  }
}
