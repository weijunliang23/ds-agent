# phase0.md — 工程骨架 + 基础设施

## 目标
在 1 周内搭好可运行、可验证的工程底座，让后续所有阶段都在同一套工具链上迭代。

本阶段**不实现任何业务功能**（Runtime、Chat、Tool 等），只交付「能跑的壳 + 能过的检查」。

## 产出物
- 可运行的 Electron + Vite 空窗口
- TypeScript、ESLint、Vitest 配置
- git 仓库初始化（首次提交）
- `npm run check`（lint + typecheck + test 一键通过）
- 最小冒烟测试示例

## 可验证的结束状态
- `npm run dev` 能弹出 Electron 窗口
- `npm run check` 全绿（lint / typecheck / test 全部通过）
- git 有初始提交记录

## 小步拆分（每步单独验证）
1. 初始化 git 仓库 + `.gitignore`
2. 创建 `package.json`，安装 Electron / Vite / TypeScript / ESLint / Vitest
3. 搭 Electron 主进程 + 渲染进程最小骨架，`npm run dev` 弹窗
4. 配置 TS（`tsconfig.json`）+ ESLint，`npm run lint` 通过
5. 配置 Vitest + 一个最小冒烟测试，`npm run test` 通过
6. 汇总 `npm run check`（依次 lint → typecheck → test），全绿后首次提交

## 目录结构（目标形态）
```
my-agent/
├── docs/                  # 规划文档
├── src/
│   ├── main/              # Electron 主进程
│   └── renderer/          # 渲染进程（Vite）
├── tests/                 # 单测与冒烟测试
├── package.json
├── tsconfig.json
├── vitest.config.ts
└── .gitignore
```

## 给 LLM 的规则
- 每完成一个小步必须跑对应命令验证，失败先修再进下一步
- 提交粒度：一个功能一个 commit
- 本阶段出现的 `npm run check` 将成为后续所有阶段提交前的唯一准入门槛
