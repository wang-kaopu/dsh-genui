import { describe, expect, it } from 'vitest'
import { sanitizeGenuiSpec } from '../../src/client/genui-runtime/index.ts'

describe('GenUI sanitization layer', () => {
  it('uses field schema rules for simple components', () => {
    const result = sanitizeGenuiSpec({ items: [
      { type: 'progress', value: 120 },
      { type: 'text', content: 'x'.repeat(2100), size: 'invalid' },
    ] })
    expect(result.spec?.items).toEqual([
      { type: 'progress', value: 100 },
      { type: 'text', content: 'x'.repeat(2000) },
    ])
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'VALUE_CLAMPED', path: 'items[0].value', actual: 100 }),
      expect.objectContaining({ code: 'VALUE_TRUNCATED', path: 'items[1].content' }),
    ]))
  })

  it('normalizes aliases when sanitize is called as a convenience API', () => {
    const result = sanitizeGenuiSpec({ items: [
      { type: 'text', text: '正文' },
      { type: 'card', label: '标题', content: [] },
    ] })
    expect(result.spec).toEqual({ items: [
      { type: 'text', content: '正文' },
      { type: 'card', items: [], title: '标题' },
    ] })
  })

  it('applies schema security hooks and keeps custom payloads opaque', () => {
    const result = sanitizeGenuiSpec({ items: [
      { type: 'image', src: 'javascript:alert(1)' },
      { type: 'custom', payload: { src: 'javascript:must-stay-opaque' } },
    ] })
    expect(result.spec?.items).toEqual([{ type: 'custom', payload: { src: 'javascript:must-stay-opaque' } }])
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'NODE_DROPPED', path: 'items[0]' }))
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'UNSAFE_VALUE', path: 'items[0].src' }))
  })

  it('rejects overlong URLs instead of truncating them into renderable values', () => {
    const src = `https://example.com/${'a'.repeat(2100)}`
    const result = sanitizeGenuiSpec({ items: [
      { type: 'image', src },
      { type: 'link', label: '超长链接', href: src },
      { type: 'text', content: '保留' },
    ] })
    expect(result.spec?.items).toEqual([{ type: 'link', label: '超长链接' }, { type: 'text', content: '保留' }])
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'NODE_DROPPED', path: 'items[0]' }),
    ]))
    expect(result.spec?.items[0]).not.toHaveProperty('href')
  })

  it('preserves the legacy per-field caps and textarea row clamp', () => {
    const result = sanitizeGenuiSpec({ items: [
      { type: 'button', label: '按钮', icon: 'i'.repeat(100), action: 'a'.repeat(300) },
      { type: 'input', action: 'i'.repeat(300), id: 'n'.repeat(300) },
      { type: 'select', options: ['A'], action: 's'.repeat(300), id: 'n'.repeat(300) },
      { type: 'checkbox', label: '复选', action: 'c'.repeat(300) },
      { type: 'radio', options: ['A'], action: 'r'.repeat(300), group: 'g'.repeat(300) },
      { type: 'submit', label: '提交', action: 's'.repeat(300), resetAction: 'r'.repeat(300), groups: ['g'.repeat(300)] },
      { type: 'switch', label: '开关', action: 'w'.repeat(300) },
      { type: 'slider', action: 'l'.repeat(300), id: 'n'.repeat(300) },
      { type: 'stat', label: '指标', value: 'v'.repeat(200), delta: 'd'.repeat(100) },
      { type: 'avatar', name: 'n'.repeat(100) },
      { type: 'progress', value: 50, valueLabel: 'p'.repeat(100) },
      { type: 'code', code: 'x', lang: 'l'.repeat(100) },
      { type: 'textarea', rows: 100, action: 't'.repeat(300), id: 'f'.repeat(300) },
    ] })
    const nodes = result.spec!.items as Array<Record<string, unknown>>
    const button = nodes[0]!
    const input = nodes[1]!
    const select = nodes[2]!
    const checkbox = nodes[3]!
    const radio = nodes[4]!
    const submit = nodes[5]!
    const switchNode = nodes[6]!
    const slider = nodes[7]!
    const stat = nodes[8]!
    const avatar = nodes[9]!
    const progress = nodes[10]!
    const code = nodes[11]!
    const textarea = nodes[12]!
    expect((button.icon as string).length).toBe(64)
    expect((button.action as string).length).toBe(200)
    expect((input.action as string).length).toBe(200)
    expect((input.id as string).length).toBe(200)
    expect((select.action as string).length).toBe(200)
    expect((select.id as string).length).toBe(200)
    expect((checkbox.action as string).length).toBe(200)
    expect((radio.action as string).length).toBe(200)
    expect((radio.group as string).length).toBe(200)
    expect((submit.action as string).length).toBe(200)
    expect((submit.resetAction as string).length).toBe(200)
    expect((submit.groups as string[])[0]!.length).toBe(200)
    expect((switchNode.action as string).length).toBe(200)
    expect((slider.action as string).length).toBe(200)
    expect((slider.id as string).length).toBe(200)
    expect((stat.value as string).length).toBe(128)
    expect((stat.delta as string).length).toBe(64)
    expect((avatar.name as string).length).toBe(64)
    expect((progress.valueLabel as string).length).toBe(64)
    expect((code.lang as string).length).toBe(64)
    expect(textarea.rows).toBe(30)
    expect((textarea.action as string).length).toBe(200)
    expect((textarea.id as string).length).toBe(200)
  })

  it('does not reject text-like payloads that are rendered as text', () => {
    const result = sanitizeGenuiSpec({ items: [
      { type: 'text', content: '<script>shown as text</script>' },
      { type: 'code', code: 'const x = "<script>"' },
      { type: 'json', value: { example: 'javascript:not-executed' } },
      { type: 'mermaid', code: 'flowchart LR\nA[onload=demo] --> B' },
    ] })
    expect(result.spec?.items).toHaveLength(4)
    expect(result.diagnostics.some(diagnostic => diagnostic.code === 'UNSAFE_VALUE')).toBe(false)
  })

  it('enforces the shared node budget at the sanitizer boundary', () => {
    const result = sanitizeGenuiSpec({ items: Array.from({ length: 201 }, (_, index) => ({ type: 'text', content: String(index) })) })
    expect(result.spec?.items).toHaveLength(200)
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'NODE_LIMIT', path: 'items[200]' }))
  })
})
