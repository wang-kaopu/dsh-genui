import { describe, expect, it } from 'vitest'
import {
  COMPONENT_SCHEMAS,
  countGenuiNodes,
  visitGenuiNodes,
} from '../../src/client/genui-runtime/index.ts'

describe('GenUI traversal layer', () => {
  it('keeps traversal metadata on the runtime registry', () => {
    expect(COMPONENT_SCHEMAS.callout.fields.tone).toMatchObject({
      type: 'string',
      aliases: ['kind'],
      enum: ['info', 'success', 'warning', 'error'],
    })
    expect(COMPONENT_SCHEMAS.callout.fields.content).toMatchObject({ type: 'string', required: true })
    expect(COMPONENT_SCHEMAS.chart.fields.data?.nested?.fields.label).toMatchObject({ type: 'string', required: true })
    expect(COMPONENT_SCHEMAS.chart.validate).toBeTypeOf('function')
    expect(COMPONENT_SCHEMAS.chart.fields.kind?.enum).toEqual(['bars', 'line', 'donut'])
  })

  it('uses only declared children for every supported container', () => {
    const paths: string[] = []
    const spec = {
      items: [
        { type: 'row', items: [{ type: 'text', content: 'row child' }] },
        { type: 'col', items: [{ type: 'text', content: 'col child' }] },
        { type: 'grid', items: [{ type: 'text', content: 'grid child' }] },
        { type: 'card', items: [{ type: 'text', content: 'card child' }] },
        { type: 'list', items: [{ type: 'text', content: 'list child' }, { title: 'opaque list record' }] },
        { type: 'tabs', tabs: [{ label: 'tab', items: [{ type: 'text', content: 'tab child' }] }] },
        { type: 'accordion', items: [{ title: 'section', items: [{ type: 'text', content: 'accordion child' }] }] },
      ],
    }

    visitGenuiNodes(spec, entry => paths.push(entry.path))

    expect(paths).toEqual([
      'items[0]', 'items[0].items[0]',
      'items[1]', 'items[1].items[0]',
      'items[2]', 'items[2].items[0]',
      'items[3]', 'items[3].items[0]',
      'items[4]', 'items[4].items[0]',
      'items[5]', 'items[5].tabs[0].items[0]',
      'items[6]', 'items[6].items[0].items[0]',
    ])
    expect(countGenuiNodes(spec)).toBe(14)
  })

  it('supports a bare root while keeping custom and file-tree payloads opaque', () => {
    const paths: string[] = []
    const bareRoot = {
      type: 'card',
      items: [
        { type: 'custom-widget', payload: { nested: { type: 'text', content: 'opaque' } } },
        { type: 'file-tree', items: [{ name: 'src', type: 'dir', children: [{ type: 'text', content: 'not a GenUI child' }] }] },
      ],
      payload: { nested: { type: 'text', content: 'also opaque' } },
    }

    visitGenuiNodes(bareRoot, entry => paths.push(entry.path))

    expect(paths).toEqual(['spec', 'spec.items[0]', 'spec.items[1]'])
    expect(countGenuiNodes(bareRoot)).toBe(3)
    expect(COMPONENT_SCHEMAS['file-tree'].children).toBeUndefined()
  })
})
