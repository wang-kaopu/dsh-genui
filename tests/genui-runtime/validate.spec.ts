import { describe, expect, it } from 'vitest'
import { validateGenuiSpec } from '../../src/client/genui-runtime/index.ts'

describe('GenUI validation layer', () => {
  it('reports required, type, enum, and range failures structurally', () => {
    const result = validateGenuiSpec({ items: [
      { type: 'image' },
      { type: 'text', content: 1, size: 'giant' },
      { type: 'progress', value: 101 },
    ] })
    expect(result.ok).toBe(false)
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'FIELD_REQUIRED', path: 'items[0].src' }),
      expect.objectContaining({ code: 'FIELD_TYPE', path: 'items[1].content' }),
      expect.objectContaining({ code: 'FIELD_ENUM', path: 'items[1].size' }),
    ]))
    expect(result.errors).toContainEqual(expect.objectContaining({ code: 'FIELD_RANGE', path: 'items[2].value' }))
  })

  it('normalizes aliases when validation is called as an independent stage', () => {
    const result = validateGenuiSpec({ items: [
      { type: 'text', text: '正文' },
      { type: 'card', label: '标题', content: [] },
    ] })
    expect(result.ok).toBe(true)
    expect(result.errors).toEqual([])
  })

  it('runs nested schema and semantic validators in the same layer', () => {
    const result = validateGenuiSpec({ items: [{
      type: 'table',
      columns: ['名称'],
      rows: [[{ invalid: true }]],
      extra: true,
    }] })
    expect(result.errors).toContainEqual(expect.objectContaining({ code: 'FIELD_TYPE', path: 'items[0].rows[0][0]' }))
    expect(result.warnings).toContainEqual(expect.objectContaining({ code: 'UNKNOWN_FIELD', path: 'items[0].extra' }))
  })

  it('preserves component and field metadata for nested diagnostics', () => {
    const result = validateGenuiSpec({ items: [{
      type: 'tabs',
      tabs: [{ label: '一', items: [{ type: 'callout', content: 'x', tone: 'invalid' }] }],
    }] })
    expect(result.errors).toContainEqual(expect.objectContaining({
      code: 'FIELD_ENUM',
      path: 'items[0].tabs[0].items[0].tone',
      component: 'callout',
      field: 'tone',
    }))
  })

  it('walks children of a bare component root', () => {
    const result = validateGenuiSpec({ type: 'row', items: [{
      type: 'chart',
      kind: 'line',
      series: [{ label: 'S', data: [{ label: 'x', value: 1 }] }],
    }] })
    expect(result.errors).toContainEqual(expect.objectContaining({
      code: 'CHART_SERIES_UNSUPPORTED',
      path: 'spec.items[0].series',
    }))
  })
})
