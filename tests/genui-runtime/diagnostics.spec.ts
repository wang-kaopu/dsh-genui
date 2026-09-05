import { describe, expect, it } from 'vitest'
import {
  formatChartDiagnostics,
  formatDiagnostic,
  formatDiagnostics,
  formatDroppedNodeFailure,
  isChartDiagnostic,
  processGenuiSpec,
} from '../../src/client/genui-runtime/index.ts'

describe('GenUI diagnostics layer', () => {
  it('formats structured diagnostics without making text the protocol', () => {
    const diagnostic = {
      severity: 'warning' as const,
      code: 'FIELD_ALIAS' as const,
      path: 'spec.text',
      alias: 'text',
      canonical: 'content',
    }
    expect(formatDiagnostic(diagnostic)).toBe('spec.text normalized to content')
    expect(formatDiagnostics([diagnostic, { ...diagnostic, path: 'spec.label' }], '|')).toBe('spec.text normalized to content|spec.label normalized to content')
  })

  it('centralizes chart and dropped-node policies', () => {
    const chart = { severity: 'error' as const, code: 'FIELD_ENUM' as const, path: 'items[0].kind', component: 'chart' }
    expect(isChartDiagnostic(chart)).toBe(true)
    expect(formatChartDiagnostics([chart])).toBe('items[0].kind: FIELD_ENUM')

    const result = processGenuiSpec({ items: [{ type: 'image', src: 'javascript:alert(1)' }] })
    expect(formatDroppedNodeFailure(result)).toContain('声明了 1 个组件')
  })
})
