/** Security and resource-limit stage for canonical GenUI values. */
import { wrapSingleComponentRoot } from '../spec.ts'
import type { GenuiNode, GenuiSpec } from '../spec.ts'
import { normalizeGenuiSpec } from './normalize.ts'
import { GENUI_LIMITS, int, num, obj, opt, repairItems, str, type RepairCtx } from './sanitizers/helpers.ts'
import type { ComponentDefinition, FieldSchema, RecordSchema } from './schema.ts'
import { COMPONENT_SCHEMAS } from './schema.ts'
import { countGenuiNodes, visitGenuiNodes } from './traverse.ts'
import type { GenuiDiagnostic } from './types.ts'

/** Result of sanitizing a normalized GenUI value. */
export interface SanitizeResult {
  readonly spec: GenuiSpec | null
  readonly diagnostics: readonly GenuiDiagnostic[]
}

/** Repair a normalized value with the shared security and resource policies. */
export function repairCanonicalGenuiSpec(value: unknown): GenuiSpec | null {
  return repairCanonicalGenuiSpecWithDiagnostics(value).spec
}

/** Result of repairing a normalized value with exact dropped-node paths. */
export interface CanonicalRepairResult {
  readonly spec: GenuiSpec | null
  readonly droppedPaths: readonly string[]
  readonly limitPath?: string
}

/** Repair a canonical value and expose exact node-drop paths to sanitize. */
export function repairCanonicalGenuiSpecWithDiagnostics(value: unknown): CanonicalRepairResult {
  const root = obj(value)
  if (root === undefined) return { spec: null, droppedPaths: [] }
  if (typeof root.type === 'string' || !Array.isArray(root.items)) {
    const wrapped = wrapSingleComponentRoot(value)
    if (wrapped === null) return { spec: null, droppedPaths: [] }
    const rootValue: Record<string, unknown> = { ...wrapped }
    delete rootValue.type
    return repairCanonicalGenuiSpecWithDiagnostics(rootValue)
  }
  const ctx: RepairCtx = { remaining: GENUI_LIMITS.maxNodes, droppedPaths: [], repairNode }
  const spec: GenuiSpec = {
    ...opt('title', str(root.title, GENUI_LIMITS.maxString)),
    ...opt('gap', num(root.gap, 0, 96)),
    ...opt('panel', root.panel === true ? true : undefined),
    ...opt('append', root.append === true ? true : undefined),
    items: repairItems(root.items, ctx, 0, 'items'),
  }
  return { spec, droppedPaths: ctx.droppedPaths, ...(ctx.limitPath === undefined ? {} : { limitPath: ctx.limitPath }) }
}

/** Dispatch one node to a specialized sanitizer, schema sanitizer, or opaque custom-node path. */
function repairNode(value: unknown, ctx: RepairCtx, depth: number, path: string): GenuiNode | null {
  if (depth > GENUI_LIMITS.maxDepth) return null
  const node = obj(value)
  if (node === undefined || typeof node.type !== 'string') return null
  const definition = COMPONENT_SCHEMAS[node.type]
  // Unknown plugin renderer payloads remain opaque by contract.
  if (definition === undefined) return value as GenuiNode
  return definition.sanitize === undefined
    ? repairSchemaNode(node, definition, ctx, depth, path)
    : definition.sanitize(node, ctx, depth, path)
}

/** Sanitize a native component using its declarative FieldSchema definition. */
function repairSchemaNode(value: Record<string, unknown>, definition: ComponentDefinition, ctx: RepairCtx, depth: number, path: string): GenuiNode | null {
  const output: Record<string, unknown> = { type: value.type }
  for (const [field, schema] of Object.entries(definition.fields)) {
    if (field === 'type' || value[field] === undefined) continue
    const sanitized = repairSchemaValue(value[field], schema, ctx, depth, `${path}.${field}`)
    if (sanitized !== undefined) output[field] = sanitized
  }
  for (const field of definition.required) {
    if (output[field] === undefined) return null
  }
  return output as unknown as GenuiNode
}

/** Sanitize one field according to the shared declarative schema. */
function repairSchemaValue(value: unknown, schema: FieldSchema, ctx: RepairCtx, depth: number, path: string): unknown {
  if (schema.enum !== undefined && !schema.enum.includes(value)) return undefined
  let repaired: unknown
  switch (schema.type) {
    case 'string': repaired = schema.truncate === false
      ? typeof value === 'string' && (schema.maxLength === undefined || value.length <= schema.maxLength) ? value : undefined
      : str(value, schema.maxLength ?? GENUI_LIMITS.maxString); break
    case 'string-or-null': repaired = value === null
      ? null
      : schema.truncate === false
        ? typeof value === 'string' && (schema.maxLength === undefined || value.length <= schema.maxLength) ? value : undefined
        : str(value, schema.maxLength ?? GENUI_LIMITS.maxString); break
    case 'number': repaired = schema.integer
      ? int(value, schema.min ?? Number.NEGATIVE_INFINITY, schema.max ?? Number.POSITIVE_INFINITY)
      : num(value, schema.min ?? Number.NEGATIVE_INFINITY, schema.max ?? Number.POSITIVE_INFINITY); break
    case 'boolean': repaired = typeof value === 'boolean' ? value : undefined; break
    case 'nodes': repaired = repairItems(value, ctx, depth + 1, path); break
    case 'array': repaired = repairSchemaArray(value, schema.nested, ctx, depth, path); break
    case 'object': repaired = repairSchemaRecord(value, schema.nested, ctx, depth, path); break
    case 'unknown': repaired = value; break
  }
  if (repaired === undefined) return undefined
  return schema.sanitize === undefined ? repaired : schema.sanitize(repaired, { path })
}

/** Sanitize an array and its optional nested record contract. */
function repairSchemaArray(value: unknown, nested: RecordSchema | undefined, ctx: RepairCtx, depth: number, path: string): unknown[] | undefined {
  if (!Array.isArray(value)) return undefined
  return nested === undefined
    ? value.slice(0, GENUI_LIMITS.maxListItems)
    : value.slice(0, GENUI_LIMITS.maxListItems)
      .map((item, index) => repairSchemaRecord(item, nested, ctx, depth, `${path}[${index}]`))
      .filter((item): item is Record<string, unknown> => item !== undefined)
}

/** Sanitize one nested record with the same field and required rules. */
function repairSchemaRecord(value: unknown, schema: RecordSchema | undefined, ctx: RepairCtx, depth: number, path: string): Record<string, unknown> | undefined {
  const record = obj(value)
  if (record === undefined) return undefined
  if (schema === undefined) return { ...record }
  const output: Record<string, unknown> = {}
  for (const [field, fieldSchema] of Object.entries(schema.fields)) {
    if (record[field] === undefined) continue
    const sanitized = repairSchemaValue(record[field], fieldSchema, ctx, depth, `${path}.${field}`)
    if (sanitized !== undefined) output[field] = sanitized
  }
  for (const field of schema.required ?? []) {
    if (output[field] === undefined) return undefined
  }
  return output
}

/**
 * Sanitize a raw or canonical value for callers using this stage directly.
 * The actual sanitizer remains canonical-only; this wrapper prevents the
 * exported convenience API from silently dropping aliases.
 */
export function sanitizeGenuiSpec(value: unknown): SanitizeResult {
  return sanitizeCanonicalGenuiSpec(normalizeGenuiSpec(value).value)
}

/** Sanitize an already-normalized value without performing normalization. */
export function sanitizeCanonicalGenuiSpec(value: unknown): SanitizeResult {
  // The caller has already normalized aliases. Keeping this call canonical
  // prevents sanitize from silently becoming a second normalize stage.
  const repaired = repairCanonicalGenuiSpecWithDiagnostics(value)
  const spec = repaired.spec
  const diagnostics: GenuiDiagnostic[] = repaired.droppedPaths.map(path => ({
    severity: 'error',
    code: 'NODE_DROPPED',
    path,
    detail: `repair dropped ${path} during sanitization`,
  }))
  const declaredNodes = nodeEntries(value)
  const renderedNodes = nodeEntries(spec)
  const declaredNative = declaredNodes.filter(entry => entry.native).length
  const renderedNative = renderedNodes.filter(entry => entry.native).length
  for (const diagnostic of diagnostics) {
    Object.assign(diagnostic, { expected: declaredNative, actual: renderedNative })
  }
  const declaredTotal = countGenuiNodes(value, GENUI_LIMITS.maxNodes + 1)
  if (repaired.limitPath !== undefined || declaredTotal > GENUI_LIMITS.maxNodes) {
    diagnostics.push({
      severity: 'error',
      code: 'NODE_LIMIT',
      path: repaired.limitPath ?? 'items',
      expected: GENUI_LIMITS.maxNodes,
      actual: declaredTotal,
      detail: `spec exceeds ${GENUI_LIMITS.maxNodes} nodes; tail elided`,
    })
  }
  collectUnsafeDiagnostics(value, diagnostics)
  collectValueChangeDiagnostics(value, spec, diagnostics)
  return { spec, diagnostics }
}

function nodeEntries(value: unknown): Array<{ path: string; node: Record<string, unknown>; native: boolean }> {
  const entries: Array<{ path: string; node: Record<string, unknown>; native: boolean }> = []
  visitGenuiNodes(value, ({ path, node, component }) => {
    // The node itself participates in the resource budget. Its custom
    // payload remains opaque because traversal never descends into it.
    if (component !== undefined || typeof node.type === 'string') entries.push({ path, node, native: component !== undefined })
  }, { maxNodes: GENUI_LIMITS.maxNodes + 1 })
  return entries
}

function collectUnsafeDiagnostics(value: unknown, diagnostics: GenuiDiagnostic[]): void {
  const visit = (candidate: unknown, path: string): void => {
    if (typeof candidate === 'string') {
      if (/^(?:javascript|data):/i.test(candidate.trim()) || /url\(/i.test(candidate) || /<script\b|on[a-z]+\s*=/i.test(candidate)) {
        diagnostics.push({ severity: 'error', code: 'UNSAFE_VALUE', path, detail: `${path} contains an unsafe value` })
      }
      return
    }
    if (Array.isArray(candidate)) {
      candidate.forEach((item, index) => visit(item, `${path}[${index}]`))
      return
    }
    if (typeof candidate !== 'object' || candidate === null) return
    for (const [key, child] of Object.entries(candidate)) visit(child, `${path}.${key}`)
  }
  // Traverse native fields only. Custom renderer payloads are opaque and must
  // never be interpreted as GenUI protocol data by this package.
  visitGenuiNodes(value, ({ node, path, component }) => {
    if (component === undefined) return
    for (const [field, fieldValue] of Object.entries(node)) {
      if (field === 'type' || !(field in component.fields)) continue
      // Text, code, Mermaid source, JSON data, and diagram labels are
      // rendered as text. Scanning those payloads for HTML-like substrings
      // would reject legitimate examples instead of protecting a sink.
      if (component.fields[field]?.securitySensitive !== true) continue
      visit(fieldValue, `${path}.${field}`)
    }
  }, { maxNodes: GENUI_LIMITS.maxNodes + 1 })
}

/** Report deterministic value changes made by resource-limit repair. */
function collectValueChangeDiagnostics(before: unknown, after: GenuiSpec | null, diagnostics: GenuiDiagnostic[]): void {
  if (after === null) return
  const repairedByPath = new Map(nodeEntries(after).map(entry => [entry.path, entry.node]))
  for (const entry of nodeEntries(before)) {
    const repaired = repairedByPath.get(entry.path)
    if (repaired === undefined || repaired.type !== entry.node.type) continue
    const component = entry.native && typeof entry.node.type === 'string' ? entry.node.type : undefined
    for (const [field, original] of Object.entries(entry.node)) {
      if (field === 'type') continue
      const current = repaired[field]
      if (typeof original === 'string' && typeof current === 'string' && current.length < original.length) {
        diagnostics.push({
          severity: 'warning',
          code: 'VALUE_TRUNCATED',
          path: `${entry.path}.${field}`,
          ...(component === undefined ? {} : { component }),
          field,
          expected: original.length,
          actual: current.length,
          detail: `${entry.path}.${field} was truncated to ${current.length} characters`,
        })
      }
      if (typeof original === 'number' && typeof current === 'number' && current !== original) {
        diagnostics.push({
          severity: 'warning',
          code: 'VALUE_CLAMPED',
          path: `${entry.path}.${field}`,
          ...(component === undefined ? {} : { component }),
          field,
          expected: original,
          actual: current,
          detail: `${entry.path}.${field} was clamped from ${original} to ${current}`,
        })
      }
      if (Array.isArray(original) && Array.isArray(current) && current.length < original.length) {
        diagnostics.push({
          severity: 'warning',
          code: 'VALUE_TRUNCATED',
          path: `${entry.path}.${field}`,
          ...(component === undefined ? {} : { component }),
          field,
          expected: original.length,
          actual: current.length,
          detail: `${entry.path}.${field} was truncated from ${original.length} to ${current.length} entries`,
        })
      }
    }
  }
}
