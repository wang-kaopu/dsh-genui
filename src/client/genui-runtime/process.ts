/** Canonical GenUI runtime pipeline. */
import { isRenderableGenuiResult } from './diagnostics.ts'
import { normalizeGenuiSpec } from './normalize.ts'
import { sanitizeCanonicalGenuiSpec } from './sanitize.ts'
import { countGenuiNodes, visitGenuiNodes } from './traverse.ts'
import { validateGenuiSpec } from './validate.ts'
import { GENUI_LIMITS } from './limits.ts'
import type { GenuiProcessResult, RenderableGenuiResult } from './types.ts'

/** Process raw model output through normalize → validate → sanitize. */
export function processGenuiSpec(raw: unknown): GenuiProcessResult {
  const normalized = normalizeGenuiSpec(raw)
  const validation = validateGenuiSpec(normalized.value)
  const sanitized = sanitizeCanonicalGenuiSpec(normalized.value)
  const errors = [...validation.errors, ...sanitized.diagnostics.filter(diagnostic => diagnostic.severity === 'error')]
  const warnings = [...normalized.diagnostics, ...validation.warnings, ...sanitized.diagnostics.filter(diagnostic => diagnostic.severity === 'warning')]
  const declaredNative = countNative(normalized.value, GENUI_LIMITS.maxNodes + 1)
  const renderedNative = countNative(sanitized.spec)
  const renderedTotal = countGenuiNodes(sanitized.spec)
  return {
    raw,
    normalized: normalized.value,
    spec: sanitized.spec,
    errors,
    warnings,
    stats: { declaredNative, renderedNative, renderedTotal },
  }
}

/** Decide whether a processed result can be handed to a renderer. */
export { isRenderableGenuiResult }

/** Compatibility adapter for old consumers that still need string errors. */
export function formatProcessErrors(result: GenuiProcessResult): string[] {
  return result.errors.map(error => error.detail ?? `${error.path}: ${error.code}`)
}

function countNative(value: unknown, cap = Number.POSITIVE_INFINITY): number {
  let count = 0
  visitGenuiNodes(value, ({ component }) => { if (component !== undefined) count += 1 }, { maxNodes: cap })
  return count
}

/** Narrow a process result after applying the shared renderability policy. */
export function asRenderableGenuiResult(result: GenuiProcessResult): RenderableGenuiResult | null {
  return isRenderableGenuiResult(result) ? result : null
}
