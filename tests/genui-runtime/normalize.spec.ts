import { describe, expect, it } from 'vitest'
import { normalizeGenuiSpec } from '../../src/client/genui-runtime/index.ts'

describe('GenUI normalization layer', () => {
  it('adopts aliases and records canonical-wins behavior', () => {
    const result = normalizeGenuiSpec({ items: [{ type: 'text', text: '旧', content: '新' }, { type: 'card', label: '标题', content: [] }] })
    expect(result.value).toEqual({ items: [{ type: 'text', content: '新' }, { type: 'card', title: '标题', items: [] }] })
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'FIELD_ALIAS', aliasIgnored: true, canonical: 'content' }))
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'FIELD_ALIAS', canonical: 'title' }))
  })

  it('is lossless for opaque custom nodes and idempotent for canonical values', () => {
    const raw = { items: [{ type: 'custom', nested: { type: 'text', text: 'opaque' } }] }
    const once = normalizeGenuiSpec(raw)
    const twice = normalizeGenuiSpec(once.value)
    expect(once.value).toEqual(raw)
    expect(twice.value).toEqual(raw)
    expect(twice.diagnostics).toEqual([])
  })

  it('declares tabs content alias through the nested schema', () => {
    const result = normalizeGenuiSpec({ items: [{
      type: 'tabs',
      tabs: [{ label: '旧字段', content: { type: 'text', text: '正文' } }],
    }] })
    expect(result.value).toEqual({ items: [{
      type: 'tabs',
      tabs: [{ label: '旧字段', items: [{ type: 'text', content: '正文' }] }],
    }] })
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: 'FIELD_ALIAS',
      path: 'items[0].tabs[0].content',
      canonical: 'items',
    }))
  })
})
