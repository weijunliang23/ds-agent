# AGENTS.md

## 项目状态
- **Starfire / my-agent**：Electron 桌面 AI Agent 应用（Runtime、上下文引擎、Tool 系统、模型路由、Patch Engine、UI），**整个项目由 LLM 全流程实现**。
- 当前处于 Phase 0：仓库还没有代码，也没有可执行工具链；如果 `npm`/`git` 命令失败，先确认工程骨架是否已搭建（见 `phase.md` Phase 0）。

## 开发路线
- 按 `phase.md` 推进：Phase 0–5，每周一个阶段，每阶段结束在「可运行、可验证」状态。
- Phase 0 产出物是**工程骨架 + 基础设施**（Electron/Vite/TS/ESLint/Vitest + `npm run check`）；骨架搭好后才有代码产出。
- 所有改动提交前必须过 `npm run check`（lint + typecheck + test）。
- 提交粒度：一次一个小功能，禁止大改堆叠。

## 文档约定
- 所有文档为**中文**，新文档沿用中文。
- 按 `docs.demo.md` 定义的 `docs/` 结构创建：`00-vision.md` → `10-api.md` + `AGENTS.md`，编号即顺序。
- `10-api.md` 是所有 Interface 的唯一汇总处；`goal.md` 目前为空，是项目目标占位。
- 规划文档应面向后续阶段，聚焦架构与接口，不要臆造未定义的结构或文件。
