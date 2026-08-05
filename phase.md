# phase.md — 开发路线图（LLM 全流程实现版）

## 原则
- 每个阶段结束在「可运行、可验证」的状态，保证每一步都有 checkpoint，避免大系统写完后回头修 bug。
- 粒度按周拆小；复杂组件（Patch Engine）在阶段内再拆小步，每步单独验证。
- 打磨（lint / typecheck / 冒烟测试）分散到每个阶段收尾，不集中在最后一周。
- 所有改动提交前必须通过 `npm run check`。

## 阶段划分

| 阶段 | 时间 | 内容 | 可验证的结束状态 |
|------|------|------|------------------|
| Phase 0 | 第 1 周 | 工程骨架 + 基础设施：Electron + Vite 空窗口、TypeScript、ESLint、Vitest、git 仓库初始化、`npm run check`（lint + typecheck + test） | `npm run dev` 能弹出窗口；`npm run check` 全绿 |
| Phase 1 | 第 2 周 | 核心 Runtime + 最小上下文引擎 + 最小模型路由 + Chat：Runtime 生命周期、会话/消息历史管理、单 provider 接入、Chat 输入输出 | 窗口内能完成多轮对话且上下文可记忆；模型失败有回退提示 |
| Phase 2 | 第 3 周 | Tool 系统 + 文件操作：Tool 注册/执行/权限控制、文件读写工具 | Chat 中可调用工具读取/写入本地文件并返回结果 |
| Phase 3 | 第 4 周 | 上下文引擎完整化 + 模型路由完整化：上下文检索（embedding/关键词）、多 provider 与失败回退 | 对话能注入相关历史上下文；路由切换与回退可测 |
| Phase 4 | 第 5 周 | 图片 + 拖拽 + Shell + UI 完善：图片理解、文件拖拽、Shell 工具、窗口交互体验打磨 | 可拖图片进窗口对话、可执行 Shell 命令，基础体验可用 |
| Phase 5 | 第 6 周 | Patch Engine（拆 3 小步）+ Git Diff + 全量打磨 | 三个小步各自单测通过；全量冒烟测试通过 |

## 关键拆分：Patch Engine（第 6 周）
1. Git Diff 生成（解析 unified diff）→ 单测验证
2. Patch Apply（将 diff 应用到文件）→ 单测验证
3. 冲突检测与处理 → 单测验证

## 给 LLM 的强制规则
- 每个阶段收尾必须跑 `npm run check`，通过才算完成。
- 提交粒度：一次一个小功能，禁止大改堆叠。
- 上下文引擎（03）与模型路由（05）在 Phase 1 就必须有最小可用版，不允许到后期才首次出现。
