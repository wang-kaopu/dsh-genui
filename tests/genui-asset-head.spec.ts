import type { IncomingMessage, ServerResponse } from 'node:http'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { readFileMock, statMock } = vi.hoisted(() => ({
  readFileMock: vi.fn(),
  statMock: vi.fn(),
}))

vi.mock('node:fs/promises', () => ({
  readFile: readFileMock,
  stat: statMock,
}))

import { apply } from '../src/plugin/index.ts'

type AssetRoute = {
  kind: string
  path: string
  handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>
}

function installAssetRoute(): AssetRoute {
  let captured: AssetRoute | undefined
  const webServer = {
    register(route: unknown): void {
      const candidate = route as AssetRoute
      if (candidate.path.includes('/assets')) captured = candidate
    },
  }
  const ctx = {
    systemPrompt: { section: vi.fn() },
    reflect: {
      get(name: string): unknown {
        return name === 'webServer' ? webServer : undefined
      },
    },
    on: vi.fn(),
  } as unknown as Parameters<typeof apply>[0]

  apply(ctx)
  if (captured === undefined) throw new Error('asset route was not registered')
  return captured
}

function responseMock(): { response: ServerResponse; writeHead: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> } {
  const writeHead = vi.fn()
  const end = vi.fn()
  return {
    response: { writeHead, end } as unknown as ServerResponse,
    writeHead,
    end,
  }
}

beforeEach(() => {
  readFileMock.mockReset()
  statMock.mockReset()
})

describe('GenUI asset HEAD route', () => {
  it('checks asset existence without reading or sending its body', async () => {
    statMock.mockResolvedValue({ isFile: () => true })
    const route = installAssetRoute()
    const { response, writeHead, end } = responseMock()
    const request = {
      method: 'HEAD',
      url: '/plugins/@changfenhuang/dsh-genui/assets/mermaid.js',
    } as unknown as IncomingMessage

    await route.handler(request, response)

    expect(statMock).toHaveBeenCalledTimes(1)
    expect(readFileMock).not.toHaveBeenCalled()
    expect(writeHead).toHaveBeenCalledWith(200, {
      'content-type': 'text/javascript; charset=utf-8',
      'cache-control': 'no-cache',
    })
    expect(end).toHaveBeenCalledTimes(1)
    expect(end).toHaveBeenCalledWith()
  })

  it('returns 404 when a HEAD target is not a regular file', async () => {
    statMock.mockResolvedValue({ isFile: () => false })
    const route = installAssetRoute()
    const { response, writeHead, end } = responseMock()
    const request = {
      method: 'HEAD',
      url: '/plugins/@changfenhuang/dsh-genui/assets/mermaid.js',
    } as unknown as IncomingMessage

    await route.handler(request, response)

    expect(readFileMock).not.toHaveBeenCalled()
    expect(writeHead).toHaveBeenCalledWith(404)
    expect(end).toHaveBeenCalledWith()
  })
})
