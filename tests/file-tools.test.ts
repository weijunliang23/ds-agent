import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterAll, describe, expect, it } from 'vitest'
import { createFileTools } from '../src/main/tools/file-tools'

const tools = new Map(createFileTools().map((tool) => [tool.name, tool]))
const ctx = { workspace: '', resolvePath: (p: string) => p }
const createdDirs: string[] = []

afterAll(async () => {
  await Promise.all(createdDirs.map((dir) => rm(dir, { recursive: true, force: true })))
})

async function makeDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'my-agent-tools-'))
  createdDirs.push(dir)
  return dir
}

describe('read_file', () => {
  it('读取存在的文本文件', async () => {
    const dir = await makeDir()
    const file = join(dir, 'a.txt')
    await writeFile(file, 'hello world', 'utf-8')
    const result = await tools.get('read_file')!.execute({ path: file }, ctx)
    expect(result.ok).toBe(true)
    expect(result.content).toBe('hello world')
  })

  it('文件不存在返回失败', async () => {
    const dir = await makeDir()
    const result = await tools.get('read_file')!.execute({ path: join(dir, 'nope.txt') }, ctx)
    expect(result.ok).toBe(false)
    expect(result.content).toContain('文件不存在')
  })

  it('目标是目录返回失败', async () => {
    const dir = await makeDir()
    const result = await tools.get('read_file')!.execute({ path: dir }, ctx)
    expect(result.ok).toBe(false)
    expect(result.content).toContain('目录')
  })

  it('超过大小上限返回失败', async () => {
    const dir = await makeDir()
    const file = join(dir, 'big.txt')
    await writeFile(file, 'x'.repeat(300 * 1024), 'utf-8')
    const result = await tools.get('read_file')!.execute({ path: file }, ctx)
    expect(result.ok).toBe(false)
    expect(result.content).toContain('文件过大')
  })
})

describe('write_file', () => {
  it('写入文件并可读回', async () => {
    const dir = await makeDir()
    const file = join(dir, 'sub', 'out.txt')
    const result = await tools.get('write_file')!.execute({ path: file, content: '内容' }, ctx)
    expect(result.ok).toBe(true)
    expect(result.content).toContain('已写入')
    expect(await readFile(file, 'utf-8')).toBe('内容')
  })

  it('覆盖已有内容', async () => {
    const dir = await makeDir()
    const file = join(dir, 'b.txt')
    await writeFile(file, 'old', 'utf-8')
    await tools.get('write_file')!.execute({ path: file, content: 'new' }, ctx)
    expect(await readFile(file, 'utf-8')).toBe('new')
  })

  it('空内容也可写入（参数校验由执行器层负责）', async () => {
    const dir = await makeDir()
    const file = join(dir, 'empty.txt')
    const result = await tools.get('write_file')!.execute({ path: file, content: '' }, ctx)
    expect(result.ok).toBe(true)
    expect(await readFile(file, 'utf-8')).toBe('')
  })
})

describe('list_dir', () => {
  it('列出目录下的文件与子目录（子目录带 /）', async () => {
    const dir = await makeDir()
    await writeFile(join(dir, 'a.txt'), 'x', 'utf-8')
    await mkdir(join(dir, 'sub'))
    const result = await tools.get('list_dir')!.execute({ path: dir }, ctx)
    expect(result.ok).toBe(true)
    expect(result.content).toContain('a.txt')
    expect(result.content).toContain('sub/')
  })

  it('结果包含目录与文件的数量统计', async () => {
    const dir = await makeDir()
    await writeFile(join(dir, 'a.txt'), 'x', 'utf-8')
    await writeFile(join(dir, 'b.txt'), 'x', 'utf-8')
    await mkdir(join(dir, 'sub'))
    const result = await tools.get('list_dir')!.execute({ path: dir }, ctx)
    expect(result.ok).toBe(true)
    expect(result.content).toContain('1 个目录，2 个文件，共 3 个条目')
  })

  it('path 为空或省略时列出工作区根目录', async () => {
    const dir = await makeDir()
    await writeFile(join(dir, 'root.txt'), 'x', 'utf-8')
    const rootCtx = { workspace: dir, resolvePath: (p: string) => join(dir, p) }
    const result = await tools.get('list_dir')!.execute({}, rootCtx)
    expect(result.ok).toBe(true)
    expect(result.content).toContain(dir)
    expect(result.content).toContain('root.txt')
  })

  it('目标是文件返回失败', async () => {
    const dir = await makeDir()
    const file = join(dir, 'f.txt')
    await writeFile(file, 'x', 'utf-8')
    const result = await tools.get('list_dir')!.execute({ path: file }, ctx)
    expect(result.ok).toBe(false)
    expect(result.content).toContain('目标是文件而非目录')
  })

  it('目录不存在返回失败', async () => {
    const dir = await makeDir()
    const result = await tools.get('list_dir')!.execute({ path: join(dir, 'nope') }, ctx)
    expect(result.ok).toBe(false)
    expect(result.content).toContain('目录不存在')
  })

  it('条目过多时截断并提示总数', async () => {
    const dir = await makeDir()
    for (let i = 0; i < 105; i++) {
      await writeFile(join(dir, `f${String(i).padStart(3, '0')}.txt`), 'x', 'utf-8')
    }
    const result = await tools.get('list_dir')!.execute({ path: dir }, ctx)
    expect(result.ok).toBe(true)
    expect(result.content).toContain('共 105 个条目')
    expect(result.content).toContain('已显示前 100')
  })
})
