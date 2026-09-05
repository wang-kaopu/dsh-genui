import { afterEach, describe, expect, it } from 'vitest'
import { resolveGenuiSpec } from '../../src/client/fence-render.tsx'
import { isRenderableGenuiResult, processGenuiSpec } from '../../src/client/genui-runtime/index.ts'
import { applyPanelOperation, clearSessionPanel, getPanelSpec } from '../../src/client/panel-store.ts'
import { createRenderUiTool, createValidateDshUiTool } from '../../src/plugin/tool.ts'

afterEach(() => {
  clearSessionPanel('runtime-consistency')
  localStorage.clear()
})

describe('GenUI runtime consumer consistency', () => {
  it('uses the same canonical spec in process, fence, render_ui meta, and validation', async () => {
    const raw = { title: '一致性', items: [{ type: 'card', label: '卡片', content: [{ type: 'text', text: '正文' }] }] }
    const processed = processGenuiSpec(raw)
    expect(isRenderableGenuiResult(processed)).toBe(true)
    expect(resolveGenuiSpec(JSON.stringify(raw))).toEqual(processed.spec)

    const renderUi = createRenderUiTool()
    expect(renderUi.output.presentationMeta!({ spec: raw })).toEqual(processed.spec)

    const validate = createValidateDshUiTool()
    await expect(validate.execute!({ spec: JSON.stringify(raw) })).resolves.toMatch(/^✅ dsh-ui spec 合法/)

    const panelStatus = applyPanelOperation('runtime-consistency', {
      sourceId: 'consistency:1',
      order: [1, 0, 0],
      mode: 'replace',
      spec: raw as never,
    })
    expect(panelStatus).toBe('accepted')
    expect(getPanelSpec('runtime-consistency')).toEqual(processed.spec)
  })

  it('shares non-renderable chart decisions across fence, tool meta, and validation', async () => {
    const raw = { items: [{ type: 'chart', kind: 'line', series: [{ label: '错误', data: [{ label: 'x', value: 1 }] }] }] }
    const processed = processGenuiSpec(raw)
    expect(processed.errors).toContainEqual(expect.objectContaining({ code: 'CHART_SERIES_UNSUPPORTED' }))
    expect(isRenderableGenuiResult(processed)).toBe(false)
    expect(resolveGenuiSpec(JSON.stringify(raw))).toBeNull()

    const renderUi = createRenderUiTool()
    expect(renderUi.output.presentationMeta!({ spec: raw })).toBeNull()

    const validate = createValidateDshUiTool()
    await expect(validate.execute!({ spec: JSON.stringify(raw) })).resolves.toContain('chart 字段验证失败')
  })
})
