import type { GenuiDiagnostic, RenderableGenuiResult, GenuiProcessResult } from './types.ts'
import { GENUI_LIMITS } from './limits.ts'

const CHART_DIAGNOSTIC_CODES = new Set<GenuiDiagnostic['code']>([
  'CHART_EMPTY',
  'CHART_SERIES_UNSUPPORTED',
  'FIELD_UNSUPPORTED',
])

/** Convert an existing schema alias/unknown-field diagnostic to the new shape. */
export function diagnosticFromSchemaMessage(diagnostic: { kind: string; path: string; message: string; type?: string; field?: string; canonical?: string }): GenuiDiagnostic {
  const isAlias = diagnostic.kind === 'alias'
  return {
    severity: 'warning',
    code: isAlias ? 'FIELD_ALIAS' : 'UNKNOWN_FIELD',
    path: diagnostic.path,
    ...(diagnostic.type === undefined ? {} : { component: diagnostic.type }),
    ...(diagnostic.field === undefined ? {} : { field: diagnostic.field }),
    ...(isAlias && diagnostic.field === undefined ? {} : isAlias ? { alias: diagnostic.field } : {}),
    ...(diagnostic.canonical === undefined ? {} : { canonical: diagnostic.canonical }),
    detail: diagnostic.message,
  }
}

/** Format a diagnostic for a human-facing tool or fallback message. */
export function formatDiagnostic(diagnostic: GenuiDiagnostic, _locale = 'zh-CN'): string {
  if (diagnostic.detail !== undefined) return diagnostic.detail
  if (diagnostic.code === 'FIELD_ALIAS' && diagnostic.alias !== undefined && diagnostic.canonical !== undefined) {
    return `${diagnostic.path} normalized to ${diagnostic.canonical}`
  }
  return `${diagnostic.path}: ${diagnostic.code}`
}

/** Format diagnostics in tree order without making their text part of the API. */
export function formatDiagnostics(diagnostics: readonly GenuiDiagnostic[], separator = '；'): string {
  return diagnostics.map(diagnostic => formatDiagnostic(diagnostic)).join(separator)
}

/** Identify diagnostics belonging to the chart renderability contract. */
export function isChartDiagnostic(diagnostic: GenuiDiagnostic): boolean {
  return CHART_DIAGNOSTIC_CODES.has(diagnostic.code)
    || (diagnostic.component === 'chart' && ['FIELD_TYPE', 'FIELD_REQUIRED', 'FIELD_ENUM'].includes(diagnostic.code))
}

/** Format chart diagnostics without making each consumer repeat the policy. */
export function formatChartDiagnostics(diagnostics: readonly GenuiDiagnostic[], separator = '；'): string | null {
  const chartDiagnostics = diagnostics.filter(isChartDiagnostic)
  return chartDiagnostics.length === 0 ? null : formatDiagnostics(chartDiagnostics, separator)
}

/** Format the historical dropped-native-node failure from protocol stats. */
export function formatDroppedNodeFailure(result: GenuiProcessResult): string | undefined {
  if (!result.errors.some(diagnostic => diagnostic.code === 'NODE_DROPPED')) return undefined
  const dropped = Math.max(0, result.stats.declaredNative - result.stats.renderedNative)
  return `❌ 验证未通过：检测到声明了 ${result.stats.declaredNative} 个组件，但仅成功解析出 ${result.stats.renderedNative} 个（有 ${dropped} 个组件因字段格式异常被丢弃）。常见原因：table 的 columns/rows 不是二维字符串数组、tabs 的 items/content 缺失、嵌套组件字段类型不符。请修正后重新验证。`
}

/** Return whether a result is renderable according to the shared policy. */
export function isRenderableGenuiResult<TSpec>(result: GenuiProcessResult<TSpec>): result is RenderableGenuiResult<TSpec> {
  if (result.spec === null) return false
  if (result.errors.length === 0) return true
  // Only the historical full native-node budget cut is renderable. This
  // prevents a mixed invalid-node drop or a custom-only overflow from being
  // mistaken for an intentional tail elision.
  return result.errors.every(diagnostic => diagnostic.code === 'NODE_LIMIT' || diagnostic.code === 'NODE_DROPPED')
    && result.errors.some(diagnostic => diagnostic.code === 'NODE_LIMIT')
    && result.stats.declaredNative === GENUI_LIMITS.maxNodes + 1
    && result.stats.renderedNative === GENUI_LIMITS.maxNodes
}
