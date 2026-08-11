import { describe, expect, it } from 'vitest'
import { validateArgs } from '../src/shared/tools'

const schema = {
  type: 'object',
  properties: {
    path: { type: 'string' },
    content: { type: 'string' },
    times: { type: 'integer' },
    tags: { type: 'array', items: { type: 'string' } }
  },
  required: ['path']
}

describe('validateArgs', () => {
  it('合法参数返回 value', () => {
    const result = validateArgs(schema, { path: '/a/b.txt', content: 'hi', times: 3, tags: ['x'] })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value).toEqual({ path: '/a/b.txt', content: 'hi', times: 3, tags: ['x'] })
    }
  })

  it('缺少必填参数报错', () => {
    const result = validateArgs(schema, { content: 'hi' })
    expect(result).toEqual({ ok: false, error: '缺少必填参数：path' })
  })

  it('类型不符报错', () => {
    const result = validateArgs(schema, { path: 123 })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('path')
  })

  it('integer 不接受小数', () => {
    const result = validateArgs(schema, { path: '/a', times: 1.5 })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('times')
  })

  it('数组元素类型校验', () => {
    const result = validateArgs(schema, { path: '/a', tags: [1] })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('tags')
  })

  it('非对象参数报错', () => {
    expect(validateArgs(schema, null)).toEqual({ ok: false, error: '参数必须是对象' })
    expect(validateArgs(schema, 'x')).toEqual({ ok: false, error: '参数必须是对象' })
    expect(validateArgs(schema, ['x'])).toEqual({ ok: false, error: '参数必须是对象' })
  })

  it('非 object schema 报错', () => {
    const result = validateArgs({ type: 'string' }, {})
    expect(result).toEqual({ ok: false, error: '工具参数 schema 必须是 object' })
  })

  it('未声明的多余参数被忽略', () => {
    const result = validateArgs(schema, { path: '/a', extra: 'x' })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toEqual({ path: '/a' })
  })
})
