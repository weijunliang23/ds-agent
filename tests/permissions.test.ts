import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  Permissions,
  type PermissionRequester
} from '../src/main/tools/permissions'
import type { PermissionsConfig } from '../src/main/tools/permissions'

function makePermissions(
  config: Partial<PermissionsConfig>,
  requester: PermissionRequester | null = null
): Permissions {
  return new Permissions(
    () => ({
      workspace: config.workspace ?? '',
      readPolicy: config.readPolicy ?? 'ask',
      writePolicy: config.writePolicy ?? 'ask'
    }),
    requester
  )
}

function fakeRequester(answer: 'allow' | 'deny'): PermissionRequester {
  return { request: vi.fn().mockResolvedValue(answer) }
}

const ws = resolve('/data/work')

describe('Permissions.decide', () => {
  it('工作区内读取按 readPolicy 裁决', () => {
    const p = makePermissions({ workspace: ws, readPolicy: 'allow' })
    expect(p.decide({ action: 'read', path: resolve(ws, 'a.txt') })).toBe('allow')
  })

  it('工作区外读取一律 ask（即使 readPolicy=allow）', () => {
    const p = makePermissions({ workspace: ws, readPolicy: 'allow' })
    expect(p.decide({ action: 'read', path: '/data/secret.txt' })).toBe('ask')
  })

  it('工作区外读取在 readPolicy=deny 时直接 deny', () => {
    const p = makePermissions({ workspace: ws, readPolicy: 'deny' })
    expect(p.decide({ action: 'read', path: '/data/secret.txt' })).toBe('deny')
  })

  it('写入按 writePolicy 裁决', () => {
    const p = makePermissions({ workspace: ws, writePolicy: 'deny' })
    expect(p.decide({ action: 'write', path: resolve(ws, 'b.txt') })).toBe('deny')
    const allow = makePermissions({ workspace: ws, writePolicy: 'allow' })
    expect(allow.decide({ action: 'write', path: resolve(ws, 'b.txt') })).toBe('allow')
  })

  it('工作区为空时读取为 ask', () => {
    const p = makePermissions({ workspace: '', readPolicy: 'allow' })
    expect(p.decide({ action: 'read', path: '/x' })).toBe('ask')
  })

  it('../ 穿越出工作区视为外部', () => {
    const p = makePermissions({ workspace: ws, readPolicy: 'allow' })
    expect(p.decide({ action: 'read', path: resolve(ws, '../secret.txt') })).toBe('ask')
  })
})

describe('Permissions.authorize', () => {
  it('ask + 无确认通道时拒绝', async () => {
    const p = makePermissions({ workspace: ws, readPolicy: 'ask' })
    expect(await p.authorize({ action: 'read', path: resolve(ws, 'a.txt') })).toBe('deny')
  })

  it('ask + 用户允许后放行并记住，同一路径不再询问', async () => {
    const requester = fakeRequester('allow')
    const p = makePermissions({ workspace: ws, readPolicy: 'ask' }, requester)
    const req = { action: 'write' as const, path: resolve(ws, 'out.txt') }

    expect(await p.authorize(req)).toBe('allow')
    expect(requester.request).toHaveBeenCalledTimes(1)
    expect(await p.authorize(req)).toBe('allow')
    expect(requester.request).toHaveBeenCalledTimes(1)
  })

  it('用户拒绝后返回 deny 且不被记住', async () => {
    const requester = fakeRequester('deny')
    const p = makePermissions({ workspace: ws, readPolicy: 'ask' }, requester)
    const req = { action: 'read' as const, path: resolve(ws, 'a.txt') }

    expect(await p.authorize(req)).toBe('deny')
    expect(await p.authorize(req)).toBe('deny')
    expect(requester.request).toHaveBeenCalledTimes(2)
  })

  it('deny 策略直接拒绝且不询问用户', async () => {
    const requester = fakeRequester('allow')
    const p = makePermissions({ workspace: ws, writePolicy: 'deny' }, requester)
    expect(await p.authorize({ action: 'write', path: resolve(ws, 'x.txt') })).toBe('deny')
    expect(requester.request).not.toHaveBeenCalled()
  })

  it('allow 策略直接放行且不询问用户', async () => {
    const requester = fakeRequester('allow')
    const p = makePermissions({ workspace: ws, writePolicy: 'allow' }, requester)
    expect(await p.authorize({ action: 'write', path: resolve(ws, 'x.txt') })).toBe('allow')
    expect(requester.request).not.toHaveBeenCalled()
  })
})
