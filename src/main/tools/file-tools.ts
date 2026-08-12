import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { Tool } from '../../shared/tools'

const MAX_READ_BYTES = 256 * 1024
// Cap on listed entries per directory so a huge dir never floods the model.
const MAX_LIST_ENTRIES = 100

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
    },
    {
      name: 'list_dir',
      description:
        '列出目录中的条目（子目录名带 / 后缀）。path 为要列出的目录路径，可以是绝对路径或相对路径；省略、为空或传 "." 时列出工作区根目录。结果包含解析后的绝对路径。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '要列出的目录路径；省略表示工作区根目录' }
        }
      },
      permission: { action: 'read', pathArg: 'path' },
      async execute(args, ctx) {
        const path = ctx.resolvePath(typeof args.path === 'string' ? args.path : '')
        const dirStat = await stat(path).catch(() => null)
        if (!dirStat) {
          return { ok: false, content: `目录不存在：${path}` }
        }
        if (!dirStat.isDirectory()) {
          return { ok: false, content: `目标是文件而非目录：${path}` }
        }

        const entries = await readdir(path, { withFileTypes: true })
        const dirs: string[] = []
        const files: string[] = []
        for (const entry of entries) {
          if (entry.isDirectory()) {
            dirs.push(`${entry.name}/`)
          } else {
            files.push(entry.name)
          }
        }
        dirs.sort((a, b) => a.localeCompare(b))
        files.sort((a, b) => a.localeCompare(b))
        const all = [...dirs, ...files]
        const shown = all.slice(0, MAX_LIST_ENTRIES)
        const lines = shown.map((name) => `- ${name}`)
        if (all.length > MAX_LIST_ENTRIES) {
          lines.push(`… 共 ${all.length} 个条目，已显示前 ${MAX_LIST_ENTRIES} 个`)
        }
        const summary = `目录：${path}（${dirs.length} 个目录，${files.length} 个文件，共 ${all.length} 个条目）`
        return { ok: true, content: `${summary}\n${lines.join('\n')}` }
      }
    }
  ]
}
