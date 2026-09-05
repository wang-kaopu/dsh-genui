/** Semantic rules for the table component. */
import type { GenuiDiagnostic } from '../types.ts'

/** Validate the supported primitive values inside table rows. */
export function validateTableNode(node: Record<string, unknown>, path: string): GenuiDiagnostic[] {
  if (!Array.isArray(node.rows)) return []
  const diagnostics: GenuiDiagnostic[] = []
  node.rows.forEach((row, rowIndex) => {
    if (record(row) !== undefined) return
    if (!Array.isArray(row)) {
      diagnostics.push({
        severity: 'error',
        code: 'FIELD_TYPE',
        path: `${path}.rows[${rowIndex}]`,
        component: 'table',
        field: 'rows',
        expected: 'array or object',
        actual: valueType(row),
        detail: `${path}.rows[${rowIndex}] must be an array or object`,
      })
      return
    }
    row.forEach((cell, cellIndex) => {
      if (typeof cell === 'string' || (typeof cell === 'number' && Number.isFinite(cell))) return
      diagnostics.push({
        severity: 'error',
        code: 'FIELD_TYPE',
        path: `${path}.rows[${rowIndex}][${cellIndex}]`,
        component: 'table',
        field: 'rows',
        expected: 'string or finite number',
        actual: valueType(cell),
        detail: `${path}.rows[${rowIndex}][${cellIndex}] must be a string or finite number`,
      })
    })
  })
  return diagnostics
}

/** Return a plain record, excluding arrays and null. */
function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

/** Describe a value for the structured diagnostic's `actual` field. */
function valueType(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}
