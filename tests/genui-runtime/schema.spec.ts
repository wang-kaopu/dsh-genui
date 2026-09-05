import { describe, expect, it } from 'vitest'
import { COMPONENT_SCHEMAS, GENUI_NATIVE_TYPES, SPEC_SCHEMA } from '../../src/client/genui-runtime/index.ts'

describe('GenUI schema layer', () => {
  it('is the complete registry for native components and root fields', () => {
    expect(GENUI_NATIVE_TYPES.size).toBe(Object.keys(COMPONENT_SCHEMAS).length)
    expect(SPEC_SCHEMA.required).toContain('items')
    for (const [type, definition] of Object.entries(COMPONENT_SCHEMAS)) {
      expect(definition.fields.type?.type, type).toBe('string')
      for (const field of definition.required) expect(definition.fields[field], `${type}.${field}`).toBeDefined()
      for (const [field, values] of Object.entries(definition.enums)) expect(definition.fields[field]?.enum, `${type}.${field}`).toEqual(values)
      for (const child of definition.children ?? []) expect(definition.fields[child.field], `${type}.${child.field}`).toBeDefined()
    }
  })

  it('declares security-sensitive URL behavior in field schemas', () => {
    expect(COMPONENT_SCHEMAS.image.fields.src?.sanitize).toBeTypeOf('function')
    expect(COMPONENT_SCHEMAS.link.fields.href?.sanitize).toBeTypeOf('function')
    expect(COMPONENT_SCHEMAS.image.fields.src?.sanitize?.('javascript:alert(1)', { path: 'items[0].src' })).toBeUndefined()
    expect(COMPONENT_SCHEMAS.link.fields.href?.sanitize?.('https://example.com', { path: 'items[0].href' })).toBe('https://example.com')
    expect(COMPONENT_SCHEMAS.image.fields.src?.truncate).toBe(false)
    expect(COMPONENT_SCHEMAS.link.fields.href?.truncate).toBe(false)
  })

  it('declares exact legacy field limits in the runtime schema', () => {
    expect(COMPONENT_SCHEMAS.button.fields.icon?.maxLength).toBe(64)
    expect(COMPONENT_SCHEMAS.button.fields.action?.maxLength).toBe(200)
    expect(COMPONENT_SCHEMAS.stat.fields.value?.maxLength).toBe(128)
    expect(COMPONENT_SCHEMAS.stat.fields.delta?.maxLength).toBe(64)
    expect(COMPONENT_SCHEMAS.code.fields.lang?.maxLength).toBe(64)
    expect(COMPONENT_SCHEMAS.textarea.fields.rows).toMatchObject({ min: 1, max: 30, integer: true })
  })

  it('attaches specialized repair behavior to the component registry', () => {
    for (const type of ['row', 'table', 'chart', 'diagram', 'echart', 'file-tree']) {
      expect(COMPONENT_SCHEMAS[type]?.sanitize, type).toBeTypeOf('function')
    }
  })
})
