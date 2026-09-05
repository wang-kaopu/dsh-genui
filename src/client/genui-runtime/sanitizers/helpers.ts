import { GENUI_LIMITS } from '../limits.ts'
import { COMPONENT_SCHEMAS } from '../schema.ts'
import type { GenuiList, GenuiNode } from '../../spec.ts'

/** Mutable state shared by every sanitizer in one repair walk. */
export interface RepairCtx {
  /** Nodes left in the global GenUI budget. */
  remaining: number

  /** Exact node paths removed by a sanitizer. */
  droppedPaths: string[]

  /** First path omitted after the node budget is exhausted. */
  limitPath?: string

  /** Recursive dispatcher supplied by the runtime repair stage. */
  repairNode: (value: unknown, ctx: RepairCtx, depth: number, path: string) => GenuiNode | null
}

/** Signature for a sanitizer whose behavior cannot be expressed by FieldSchema. */
export type ComponentSanitizerFn = (value: Record<string, unknown>, ctx: RepairCtx, depth: number, path: string) => GenuiNode | null

/** Check whether a value is one of a schema-declared string enum. */
function inEnum<T extends string>(value: unknown, values: readonly T[]): value is T {
  return typeof value === 'string' && (values as readonly string[]).includes(value)
}

/** Truncate a string field, rejecting non-string values. */
export function str(value: unknown, cap: number): string | undefined {
  return typeof value === 'string' ? value.slice(0, cap) : undefined
}

/** Keep only safe color literals and host design tokens. */
export function color(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  const safeColor = /^(?:#[\da-fA-F]{3,8}|rgba?\([^)]{0,64}\)|hsla?\([^)]{0,64}\)|var\(--dsw-[\w-]+(?:,\s*#[0-9a-fA-F]{3,8})?\))$/
  return normalized.length <= 64 && safeColor.test(normalized) ? normalized : undefined
}

/** Clamp a finite number into an inclusive range. */
export function num(value: unknown, min: number, max: number): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : undefined
}

/** Truncate and clamp a finite number to an integer range. */
export function int(value: unknown, min: number, max: number): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.trunc(value))) : undefined
}

/** Read an enum declared by a native component field. */
export function schemaEnum<T extends string>(component: string, field: string, value: unknown): T | undefined {
  const values = COMPONENT_SCHEMAS[component]?.fields[field]?.enum
  return values !== undefined && inEnum(value, values as readonly T[]) ? value : undefined
}

/** Read an enum declared by a nested record field. */
export function nestedSchemaEnum<T extends string>(component: string, field: string, nestedField: string, value: unknown): T | undefined {
  const values = COMPONENT_SCHEMAS[component]?.fields[field]?.nested?.fields[nestedField]?.enum
  return values !== undefined && inEnum(value, values as readonly T[]) ? value : undefined
}

/** Return a plain object, excluding arrays and null. */
export function obj(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

/** Preserve an optional field only when its sanitized value exists. */
export function opt<K extends string, V>(key: K, value: V | undefined): Partial<Record<K, V>> {
  return value === undefined ? {} : { [key]: value } as Partial<Record<K, V>>
}

/** Repair nested GenUI nodes while sharing the parent budget and drop log. */
export function repairItems(list: unknown, ctx: RepairCtx, depth: number, path = 'items'): GenuiNode[] {
  if (!Array.isArray(list)) return []
  const output: GenuiNode[] = []
  for (let index = 0; index < list.length; index++) {
    const item = list[index]
    if (ctx.remaining <= 0) {
      ctx.limitPath ??= `${path}[${index}]`
      break
    }
    ctx.remaining -= 1
    const node = ctx.repairNode(item, ctx, depth, `${path}[${index}]`)
    if (node !== null) output.push(node)
    else ctx.droppedPaths.push(`${path}[${index}]`)
  }
  return output
}

/** Repair list items while preserving string and title/description shorthand forms. */
export function repairListItems(value: unknown, cap: number, ctx: RepairCtx, depth: number, path: string): GenuiList['items'] | undefined {
  if (!Array.isArray(value)) return undefined
  const output: GenuiList['items'] = []
  for (let index = 0; index < value.length; index++) {
    const item = value[index]
    if (output.length >= cap) break
    if (typeof item === 'string') {
      output.push(item.slice(0, GENUI_LIMITS.maxString))
      continue
    }
    const record = obj(item)
    const title = record === undefined ? undefined : str(record.title, GENUI_LIMITS.maxString)
    if (title !== undefined) {
      output.push({ title, ...opt('desc', str(record!.desc, GENUI_LIMITS.maxString)) })
      continue
    }
    if (record !== undefined && typeof record.type === 'string') {
      if (ctx.remaining <= 0) {
        ctx.limitPath ??= `${path}[${index}]`
        break
      }
      ctx.remaining -= 1
      const node = ctx.repairNode(record, ctx, depth, `${path}[${index}]`)
      if (node !== null) output.push(node)
      else ctx.droppedPaths.push(`${path}[${index}]`)
    }
  }
  return output
}

export { GENUI_LIMITS }
