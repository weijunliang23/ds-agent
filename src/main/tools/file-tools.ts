import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { Tool } from '../../shared/tools'

const MAX_READ_BYTES = 256 * 1024

export function createFileTools(): Tool[] {
  return [
    {
      name: 'read_file',
      description:
        '读取文本文件的内容。path 为要读取的文件路径，可以是绝对路径或相对于工作区的路径。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '要读取的文件路径' }
        },
        required: ['path']
      },
      permission: { action: 'read', pathArg: 'path' },
      async execute(args, ctx) {
        const path = ctx.resolvePath(String(args.path))
        const fileStat = await stat(path).catch(() => null)
        if (!fileStat) {
          return { ok: false, content: `文件不存在：${path}` }
        }
        if (fileStat.isDirectory()) {
          return { ok: false, content: `目标是目录而非文件：${path}` }
        }
        if (fileStat.size > MAX_READ_BYTES) {
          return {
            ok: false,
            content: `文件过大（${fileStat.size} 字节），暂不支持读取超过 ${MAX_READ_BYTES} 字节的文件`
          }
        }
        const content = await readFile(path, 'utf-8')
        return { ok: true, content }
      }
    },
    {
      name: 'write_file',
      description:
        '将文本内容写入文件，覆盖已有内容；目录不存在时自动创建。path 为文件路径，content 为要写入的内容。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '要写入的文件路径' },
          content: { type: 'string', description: '要写入的文本内容' }
        },
        required: ['path', 'content']
      },
      permission: { action: 'write', pathArg: 'path' },
      async execute(args, ctx) {
        const path = ctx.resolvePath(String(args.path))
        const content = String(args.content)
        await mkdir(dirname(path), { recursive: true })
        await writeFile(path, content, 'utf-8')
        return { ok: true, content: `已写入 ${path}（${content.length} 字符）` }
      }
    }
  ]
}
