// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const { mountSceneMock } = vi.hoisted(() => ({ mountSceneMock: vi.fn() }))
vi.mock('../src/client/scene3d-lazy.ts', () => ({ mountScene: mountSceneMock }))

import { Scene3DNode } from '../src/client/blocks/advanced.tsx'
import { GENUI_LIMITS } from '../src/client/guard.ts'
import type { GenuiScene3D } from '../src/client/spec.ts'

afterEach(() => {
  cleanup()
  mountSceneMock.mockReset()
})

function scene(meshCount: number, title?: string): GenuiScene3D {
  return {
    type: 'scene3d',
    ...(title === undefined ? {} : { title }),
    meshes: Array.from({ length: meshCount }, (_, i) => ({ type: 'box', position: [i, 0, 0] })),
  } as unknown as GenuiScene3D
}

describe('Scene3D lazy lifecycle', () => {
  it('shows the error state when mounting the lazy engine fails', async () => {
    mountSceneMock.mockRejectedValueOnce(new Error('webgl unavailable'))
    render(<Scene3DNode node={scene(1)} />)

    await screen.findByText('3D 渲染失败')
    expect(screen.queryByText('加载 3D 场景…')).toBeNull()
  })

  it('does not remount after ready state when an over-limit scene was capped', async () => {
    const dispose = vi.fn()
    mountSceneMock.mockResolvedValue(dispose)
    const node = scene(GENUI_LIMITS.maxMeshes + 1)

    render(<Scene3DNode node={node} />)
    await waitFor(() => expect(screen.queryByText('加载 3D 场景…')).toBeNull())
    await Promise.resolve()

    expect(mountSceneMock).toHaveBeenCalledTimes(1)
    expect(mountSceneMock.mock.calls[0]?.[1].meshes).toHaveLength(GENUI_LIMITS.maxMeshes)
    expect(dispose).not.toHaveBeenCalled()
  })

  it('returns to loading and can recover when the scene prop changes after an error', async () => {
    mountSceneMock
      .mockRejectedValueOnce(new Error('first scene failed'))
      .mockResolvedValueOnce(vi.fn())
    const view = render(<Scene3DNode node={scene(1, 'A')} />)
    await screen.findByText('3D 渲染失败')

    view.rerender(<Scene3DNode node={scene(1, 'B')} />)
    expect(screen.getByText('加载 3D 场景…')).toBeTruthy()
    await waitFor(() => expect(screen.queryByText('加载 3D 场景…')).toBeNull())
    expect(screen.queryByText('3D 渲染失败')).toBeNull()
  })
})
