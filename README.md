# my-agent

**中文** | [English](README.en.md)

> 一个由 LLM 全流程实现的 Electron 桌面 AI Agent 应用。

`my-agent` 是一款桌面端 AI Agent，目标是把「理解上下文 → 调用工具 → 修改代码」这条链路完整跑在本地。它不只做对话，还能读写本地文件、按需检索历史上下文、在多个模型之间自动回退切换，最终通过 **Patch Engine** 直接对代码仓库应用 Git diff 级别的修改。

整个项目由 LLM 全程实现，按周拆分的阶段路线推进，每一阶段都结束在「可运行、可验证」的状态。

## 核心特性

- **对话与流式输出**：多轮对话、流式输出、思考模式（thinking）与思考强度可调。
- **上下文引擎**：长对话不把全部历史塞进 prompt，而是按会话建立索引、检索与当前问题相关的片段注入（关键词检索，接口可插拔，embedding 预留）。
- **模型路由**：支持配置多个 OpenAI 兼容 provider，按序尝试、失败自动回退，全败时给出聚合错误，并回报实际命中的 provider。
- **Tool 系统**：注册、执行、权限控制一体的工具框架；内置 `read_file` / `write_file` / `list_dir` 文件工具，读写策略（允许/询问/拒绝）可配置。
- **Patch Engine（规划中）**：Git diff 生成、patch 应用与冲突检测，让 Agent 能精准落地代码修改。
- **更多规划**：图片理解、文件拖拽、Shell 工具、上下文检索升级 embedding。

## 技术栈

- **Electron 43** + **electron-vite 5** + **Vite 7**
- **TypeScript 6**（strict）
- **ESLint 10** + **typescript-eslint**
- **Vitest 4** 单元测试
- **markdown-it** 渲染消息

## 快速开始

```bash
# 安装依赖
npm install

# 启动开发模式（弹出窗口）
npm run dev

# 代码检查：lint + typecheck + 单元测试
npm run check

# 构建
npm run build
```

首次使用需要在设置页配置模型 provider（OpenAI 兼容接口的 API 地址、AppKey、模型名）。也可以通过环境变量 `LLM_API_KEY` / `LLM_BASE_URL` / `LLM_MODEL` 兜底主 provider。

## 目录结构

```
my-agent/
├── src/
│   ├── shared/       # 共享类型与配置加载（config / settings / tools）
│   ├── main/         # Electron 主进程：runtime、上下文引擎、模型路由、tool 执行、IPC
│   │   └── tools/    # 工具注册、权限、文件工具
│   └── renderer/     # UI：聊天、设置、权限弹窗、侧边栏
├── tests/            # Vitest 单元测试
├── docs/             # 阶段文档
├── phase.md          # 开发路线图（Phase 0–5）
└── package.json
```

## 开发路线

按 `phase.md` 分六个阶段推进，每阶段产出可运行、可验证的成果：

| 阶段 | 内容 | 状态 |
|------|------|------|
| Phase 0 | 工程骨架：Electron + Vite + TS + ESLint + Vitest | 已完成 |
| Phase 1 | Runtime、会话/消息历史、单 provider Chat | 已完成 |
| Phase 2 | Tool 系统与文件读写、权限控制 | 已完成 |
| Phase 3 | 上下文检索 + 多 provider 路由回退 | 已完成 |
| Phase 4 | 图片理解、拖拽、Shell 工具、UI 打磨 | 规划中 |
| Phase 5 | Patch Engine（diff / apply / 冲突） | 规划中 |

## 文档

- `phase.md`：开发路线图与给 LLM 的强制规则
- `docs/phase0.md` ~ `docs/phase3.md`：各阶段设计与验收标准
- 所有文档为中文，Interface 汇总见 `10-api.md`（规划）

## 许可

MIT
