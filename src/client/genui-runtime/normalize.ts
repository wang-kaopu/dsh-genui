/** Lossless GenUI normalization stage. */
import { COMPONENT_SCHEMAS, type ComponentDefinition } from './schema.ts'
import type { GenuiDiagnostic } from './types.ts'

/** Result of deterministic alias and structural normalization. */
export interface NormalizeResult {
  readonly value: unknown
  readonly diagnostics: readonly GenuiDiagnostic[]
  /** Compatibility alias for callers that used the pre-protocol name. */
  readonly warnings: readonly GenuiDiagnostic[]
}

/** Normalize aliases and child containers without applying repair policies. */
export function normalizeGenuiSpec(value: unknown): NormalizeResult {
  const diagnostics: GenuiDiagnostic[] = []
  const root = record(value)
  if (root === undefined) return { value, diagnostics, warnings: diagnostics }
  const normalized = typeof root.type === 'string'
    ? normalizeNode(root, 'spec', diagnostics)
    : Array.isArray(root.items)
      ? { ...root, items: root.items.map((item, index) => normalizeNode(item, `items[${index}]`, diagnostics)) }
      : { ...root }
  return { value: normalized, diagnostics, warnings: diagnostics }
}

function normalizeNode(value: unknown, path: string, diagnostics: GenuiDiagnostic[]): unknown {
  const node = record(value)
  if (node === undefined || typeof node.type !== 'string') return value
  const definition = COMPONENT_SCHEMAS[node.type]
  // Custom renderer payloads are opaque by contract.
  if (definition === undefined) return value
  const out = normalizeAliases(node, definition, path, diagnostics)
  for (const child of definition.children ?? []) {
    const childValue = out[child.field]
    if (child.kind === 'nodes') {
      if (Array.isArray(childValue)) out[child.field] = childValue.map((item, index) => normalizeNode(item, `${path}.${child.field}[${index}]`, diagnostics))
      continue
    }
    if (!Array.isArray(childValue)) continue
    out[child.field] = childValue.map((holder, index) => normalizeChildRecord(holder, `${path}.${child.field}[${index}]`, child.field, child.childrenField, definition, String(node.type), diagnostics))
  }
  return out
}

function normalizeChildRecord(value: unknown, path: string, childField: string, childrenField: string | undefined, owner: ComponentDefinition, component: string, diagnostics: GenuiDiagnostic[]): unknown {
  const holder = record(value)
  if (holder === undefined || childrenField === undefined) return value
  const childSchema = owner.fields[childField]?.nested
  const out = normalizeAliasMap(holder, childSchema?.aliases ?? {}, path, component, diagnostics)
  const children = out[childrenField]
  if (Array.isArray(children)) {
    out[childrenField] = children.map((item, index) => normalizeNode(item, `${path}.${childrenField}[${index}]`, diagnostics))
  } else if (children !== undefined) {
    const normalizedChild = normalizeNode(children, `${path}.${childrenField}[0]`, diagnostics)
    out[childrenField] = owner === COMPONENT_SCHEMAS.tabs ? [normalizedChild] : normalizedChild
  }
  return out
}

function normalizeAliases(node: Record<string, unknown>, definition: ComponentDefinition, path: string, diagnostics: GenuiDiagnostic[]): Record<string, unknown> {
  return normalizeAliasMap(node, definition.aliases, path, String(node.type), diagnostics)
}

function normalizeAliasMap(node: Record<string, unknown>, aliases: Readonly<Record<string, string>>, path: string, component: string, diagnostics: GenuiDiagnostic[]): Record<string, unknown> {
  const out = { ...node }
  for (const [alias, canonical] of Object.entries(aliases)) {
    if (!(alias in out)) continue
    const canonicalPresent = canonical in out
    if (!canonicalPresent) out[canonical] = out[alias]
    delete out[alias]
    diagnostics.push(aliasDiagnostic(`${path}.${alias}`, alias, canonical, component, canonicalPresent))
  }
  return out
}

function aliasDiagnostic(path: string, alias: string, canonical: string, component: string, ignored: boolean): GenuiDiagnostic {
  return {
    severity: 'warning',
    code: 'FIELD_ALIAS',
    path,
    component,
    field: alias,
    alias,
    canonical,
    ...(ignored ? { aliasIgnored: true } : {}),
    detail: ignored
      ? `${path} is ignored because canonical field '${canonical}' is present`
      : `${path} normalized/adopted as '${canonical}'`,
  }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}
