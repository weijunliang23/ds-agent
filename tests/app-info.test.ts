import { describe, expect, it } from 'vitest'
import { appTitle } from '../src/main/app-info'

describe('app-info', () => {
  it('生成带阶段标识的标题', () => {
    expect(appTitle('my-agent')).toContain('my-agent')
    expect(appTitle('my-agent')).toContain('Phase 0')
  })
})
