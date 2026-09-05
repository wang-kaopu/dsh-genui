/** Semantic rules that cannot be expressed as primitive field schemas. */
import type { GenuiDiagnostic } from '../types.ts'

/** Validate chart collection relationships and renderability semantics. */
export function validateChartNode(node: Record<string, unknown>, path: string): GenuiDiagnostic[] {
  const diagnostics: GenuiDiagnostic[] = []
  const kind = node.kind === undefined ? 'bars' : node.kind
  if (node.variant !== undefined) {
    diagnostics.push({
      severity: 'error',
      code: 'FIELD_UNSUPPORTED',
      path: `${path}.variant`,
      component: 'chart',
      field: 'variant',
      expected: 'kind',
      actual: node.variant,
      detail: `${path}.variant is unsupported; use kind`,
    })
  }
  if (!Array.isArray(node.data) && !Array.isArray(node.series)) {
    diagnostics.push(chartDiagnostic('CHART_EMPTY', `${path}: type 'chart' requires data or series (array)`, path))
  }
  if (Array.isArray(node.data) && node.data.length === 0) {
    diagnostics.push(chartDiagnostic('CHART_EMPTY', `${path}.data must not be empty`, `${path}.data`))
  }
  if (Array.isArray(node.series)) {
    if (node.series.length === 0) diagnostics.push(chartDiagnostic('CHART_EMPTY', `${path}.series must not be empty`, `${path}.series`))
    if (kind === 'line' || kind === 'donut') {
      diagnostics.push({
        ...chartDiagnostic('CHART_SERIES_UNSUPPORTED', `${path}.series is only supported for bars`, `${path}.series`),
        expected: 'bars',
        actual: kind,
      })
    }
    node.series.forEach((series, index) => {
      if (typeof series !== 'object' || series === null || Array.isArray(series)) return
      const data = (series as Record<string, unknown>).data
      if (Array.isArray(data) && data.length === 0) {
        diagnostics.push(chartDiagnostic('CHART_EMPTY', `${path}.series[${index}].data must not be empty`, `${path}.series[${index}].data`))
      }
    })
  }
  if ((kind === 'line' || kind === 'donut') && node.data === undefined) {
    diagnostics.push(chartDiagnostic('CHART_EMPTY', `${path}.data is required for ${kind}`, `${path}.data`))
  }
  return diagnostics
}

function chartDiagnostic(code: 'CHART_EMPTY' | 'CHART_SERIES_UNSUPPORTED', detail: string, path: string): GenuiDiagnostic {
  return { severity: 'error', code, path, component: 'chart', detail }
}
