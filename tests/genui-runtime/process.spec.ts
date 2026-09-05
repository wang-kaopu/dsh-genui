import { describe, expect, it } from 'vitest'
import {
  asRenderableGenuiResult,
  formatProcessErrors,
  isRenderableGenuiResult,
  processGenuiSpec,
} from '../../src/client/genui-runtime/index.ts'

describe('GenUI process layer', () => {
  it('exposes the raw, normalized, repaired, and aggregate runtime views', () => {
    const raw = { items: [{ type: 'card', label: '标题', content: [{ type: 'text', text: '正文' }] }] }
    const result = processGenuiSpec(raw)
    expect(result.raw).toBe(raw)
    expect(result.normalized).toEqual({ items: [{ type: 'card', title: '标题', items: [{ type: 'text', content: '正文' }] }] })
    expect(result.spec).toEqual(result.normalized)
    expect(result.stats).toEqual({ declaredNative: 2, renderedNative: 2, renderedTotal: 2 })
    expect(asRenderableGenuiResult(result)).toBe(result)
  })

  it('keeps validation failures and renderability decisions separate', () => {
    const result = processGenuiSpec({ items: [{ type: 'image' }] })
    expect(isRenderableGenuiResult(result)).toBe(false)
    expect(asRenderableGenuiResult(result)).toBeNull()
    expect(formatProcessErrors(result)).toEqual(expect.arrayContaining([expect.stringContaining('requires src')]))
  })

  it('keeps clampable resource values renderable while exposing warnings', () => {
    const result = processGenuiSpec({ gap: 200, items: [
      { type: 'grid', cols: 40, items: [] },
    ] })
    expect(result.spec).toEqual({ gap: 96, items: [{ type: 'grid', cols: 12, items: [] }] })
    expect(result.warnings.filter(diagnostic => diagnostic.code === 'FIELD_RANGE')).toHaveLength(2)
    expect(isRenderableGenuiResult(result)).toBe(true)
  })

  it('blocks out-of-range progress instead of projecting a clamped card', () => {
    const result = processGenuiSpec({ items: [{ type: 'progress', value: 150 }] })
    expect(result.errors).toContainEqual(expect.objectContaining({ code: 'FIELD_RANGE', path: 'items[0].value' }))
    expect(result.spec).toEqual({ items: [{ type: 'progress', value: 100 }] })
    expect(isRenderableGenuiResult(result)).toBe(false)
  })

  it('validates nested semantics for a bare component root', () => {
    const result = processGenuiSpec({ type: 'row', items: [{
      type: 'chart',
      kind: 'line',
      series: [{ label: 'S', data: [{ label: 'x', value: 1 }] }],
    }] })
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'CHART_SERIES_UNSUPPORTED' }),
      expect.objectContaining({ code: 'FIELD_REQUIRED', path: 'spec.items[0].data' }),
    ]))
    expect(isRenderableGenuiResult(result)).toBe(false)
  })

  it('does not treat custom-only overflow as a renderable budget cut', () => {
    const result = processGenuiSpec({ items: Array.from({ length: 201 }, (_, index) => ({ type: `custom-${index}`, payload: { index } })) })
    expect(result.stats.declaredNative).toBe(0)
    expect(result.stats.renderedTotal).toBe(200)
    expect(result.errors).toContainEqual(expect.objectContaining({ code: 'NODE_LIMIT' }))
    expect(isRenderableGenuiResult(result)).toBe(false)
  })

  it('does not treat mixed invalid drops and overflow as a renderable budget cut', () => {
    const result = processGenuiSpec({ items: [
      { type: 'image', src: 'javascript:alert(1)' },
      ...Array.from({ length: 201 }, (_, index) => ({ type: 'text', content: String(index) })),
    ] })
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'NODE_DROPPED' }),
      expect.objectContaining({ code: 'NODE_LIMIT' }),
    ]))
    expect(result.stats.renderedNative).toBeLessThan(200)
    expect(isRenderableGenuiResult(result)).toBe(false)
  })
})
