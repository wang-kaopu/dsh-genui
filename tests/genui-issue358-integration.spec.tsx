// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { GenuiActionContext } from '../src/client/action-context.ts'
import { GenuiBlock } from '../src/client/GenuiBlock.tsx'
import { validateGenuiSpec } from '../src/client/guard.ts'
import type { GenuiSpec } from '../src/client/spec.ts'

afterEach(() => { cleanup(); localStorage.clear() })

describe('issue #358 integrated components', () => {
  it('uses all interactive field types in the same submitted form', async () => {
    const events: Array<[string, Record<string, unknown>]> = []
    const spec: GenuiSpec = { items: [
      { type: 'segmented-control', id: 'visibility', label: 'Visibility', options: ['Show', 'Hide'], value: 'Show' },
      { type: 'diagram', id: 'selectedNode', kind: 'flowchart', nodes: [
        { id: 'database', label: 'Database', description: 'Storage' },
      ], when: { field: 'visibility', op: 'eq', value: 'Show' } },
      { type: 'editor', id: 'draft', label: 'Notes', value: 'Initial notes', when: { field: 'selectedNode', op: 'eq', value: 'database' } },
      { type: 'date-picker', id: 'travel', label: 'Travel', value: '2026-10-20' },
      { type: 'submit', label: 'Send', action: 'send', groups: ['selectedNode', 'draft', 'travel'] },
    ] }
    expect(validateGenuiSpec(spec).ok).toBe(true)
    render(<GenuiActionContext.Provider value={(a, p) => events.push([a, p])}>
      <GenuiBlock spec={spec} />
    </GenuiActionContext.Provider>)
    fireEvent.click(screen.getByRole('button', { name: 'Database' }))
    await waitFor(() => expect((screen.getByRole('textbox', { name: 'Notes' }) as HTMLTextAreaElement).value).toBe('Initial notes'))
    const send = screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement
    await waitFor(() => expect(send.disabled).toBe(false))
    fireEvent.click(send)
    expect(events[0]?.[1].fields).toMatchObject({
      selectedNode: 'database', draft: 'Initial notes', travel: '2026-10-20',
    })
  })

  it('rejects visibility cycles involving newly registered field types', () => {
    const spec: GenuiSpec = { items: [
      { type: 'editor', id: 'draft', value: 'X', when: { field: 'travel', op: 'not-empty' } },
      { type: 'date-picker', id: 'travel', when: { field: 'view', op: 'not-empty' } },
      { type: 'segmented-control', id: 'view', options: ['A', 'B'], when: { field: 'draft', op: 'not-empty' } },
    ] }
    expect(validateGenuiSpec(spec).errors.join(' ')).toContain('circular visibility dependency')
  })

  it('keeps hidden tab fields out of conditional readers', () => {
    const spec: GenuiSpec = { items: [
      { type: 'segmented-control', id: 'visibility', options: ['Show', 'Hide'], value: 'Hide' },
      { type: 'tabs', tabs: [{ label: 'Date', items: [
        { type: 'date-picker', id: 'travel', when: { field: 'visibility', op: 'eq', value: 'Show' } },
      ] }] },
      { type: 'text', content: 'Date selected', when: { field: 'travel', op: 'not-empty' } },
    ] }
    render(<GenuiBlock spec={spec} initialState={{ fields: { visibility: 'Hide', travel: '2026-10-20' } }} />)
    expect(screen.queryByText('Date selected')).toBeNull()
  })
})
