# phase1.md — 核心 Runtime + 最小上下文引擎 + 最小模型路由 + Chat

## 目标
在第 2 周内打通「输入 → Runtime → 模型 → 输出」的最小闭环，让用户在 Electron 窗口里能进行**多轮对话且上下文可记忆**。

本阶段是项目第一次接入真实 LLM 服务，因此**模型配置（appkey / api 地址）是本阶段的关键基础设施**，必须单独成模块、走环境变量，不允许硬编码进代码。

## 产出物
- 核心 Runtime：生命周期（start / stop / handleMessage），负责串联上下文、模型路由与消息收发
- 最小上下文引擎：会话 + 消息历史管理（存内存，落盘留到后续阶段）
- 最小模型路由：单 provider（OpenAI 兼容协议）接入，失败时有回退提示
- Chat UI：输入框 + 消息列表 + 发送/停止，最小可用样式
- 配置模块：从 `.env` 读取 appkey、api 地址、模型名，校验缺失并给可读报错

## 配置约定（重点）

所有模型配置在**程序内设置界面**配置，持久化到用户数据目录的 `settings.json`，不在仓库里。`src/shared/config.ts` 统一加载与校验。

### 配置项
| 配置项 | 存储 key | 说明 | 示例 |
|--------|----------|------|------|
| AppKey | `llm.apiKey` | 模型服务密钥（appkey） | `sk-xxxx` |
| API 地址 | `llm.baseUrl` | 服务根地址，兼容 OpenAI 协议 | `https://api.deepseek.com/v1` |
| 模型名 | `llm.model` | 使用的模型标识 | `deepseek-chat` |
| 超时(ms) | `llm.timeoutMs` | 请求超时，默认 60000 | `60000` |

### 来源与优先级
1. **设置界面保存的值**（最高，来自 `settings.json`）
2. 环境变量兜底：`LLM_API_KEY` / `LLM_BASE_URL` / `LLM_MODEL` / `LLM_TIMEOUT_MS`
3. 内置默认值（超时 60000，其他为空）

`src/shared/config.ts` 导出 `loadConfig(): AppConfig`，内部按上述顺序合并；纯函数便于单测。

### 存储与安全
- 存储路径：`app.getPath('userData')/settings.json`（Electron userData 目录，不在仓库内）
- 启动时读取，保存时原子写入（写临时文件后 rename），单测用内存 store 抽象（`SettingsStore` 接口），不直接依赖 fs
- 缺失 `apiKey` 或 `baseUrl` 时，Chat 界面显示"未配置模型"并可一键跳转设置页，不让应用崩溃

### 设置界面
- 渲染进程新增设置页（或设置弹窗）：四个输入项 + 保存按钮
- 通过 preload 暴露 `window.api.getSettings()` / `saveSettings()`，经 IPC 由主进程读写 `settings.json`
- 保存后即时生效，无需重启

## 小步拆分（每步单独验证）
1. `src/shared/config.ts`：`loadConfig()` 合并逻辑 + `SettingsStore` 接口，单测（缺 key、默认值、优先级、解析超时）
2. 最小模型路由 `src/main/model-router.ts`：单 provider HTTP 调用（stream 暂缓），用 `fetch` 打 `${baseUrl}/chat/completions`，单测 mock fetch
3. 最小上下文引擎 `src/main/context-engine.ts`：会话管理（createSession / appendMessage / getHistory），单测
4. 核心 Runtime `src/main/runtime.ts`：生命周期 + handleMessage（取历史 → 调模型 → 存消息 → 返回），单测
5. 设置持久化：主进程读写 `settings.json`（原子写入）+ IPC（getSettings / saveSettings），单测
6. Chat UI + 设置界面：输入框 + 消息列表 + 设置表单，通过 preload 暴露 `window.api`，与主进程 IPC 打通
7. 收尾：`npm run check` 全绿 + 端到端手动验证多轮对话 + 提交

## 目录结构（本阶段新增）
```
my-agent/
├── src/
│   ├── shared/
│   │   ├── config.ts        # loadConfig 合并 + 校验
│   │   └── settings.ts      # SettingsStore 接口 + 内存/文件实现
│   ├── main/
│   │   ├── runtime.ts       # 核心 Runtime
│   │   ├── model-router.ts  # 最小模型路由
│   │   ├── context-engine.ts# 最小上下文引擎
│   │   └── ipc.ts           # IPC 处理器（chat / getSettings / saveSettings）
│   └── renderer/
│       ├── chat/            # 聊天视图（输入框 + 消息列表）
│       └── settings/        # 设置视图（四项配置 + 保存）
├── tests/
│   ├── config.test.ts
│   ├── settings.test.ts
│   ├── model-router.test.ts
│   ├── context-engine.test.ts
│   └── runtime.test.ts
```

> 注：`settings.json` 位于 Electron userData 目录，不属于仓库；无需 `.env` / `.env.example`。

## 可验证的结束状态
- 配置缺失时：启动给出可读中文错误，界面显示"未配置模型"
- 配置正确时：窗口内完成 ≥3 轮对话，后续提问能引用前文（上下文记忆生效）
- 模型调用失败（错误 key / 断网 / 超时）：不崩溃，界面给回退提示
- `npm run check` 全绿

## 给 LLM 的规则
- 每完成一个小步跑对应单测验证，再进下一步
- appkey / api 地址只出现在 `settings.json`（userData 目录）与设置界面，任何代码与文档示例不得写入真实密钥
- `SettingsStore` 用接口抽象，测试用内存实现，避免测试碰真实 fs
- 上下文引擎与模型路由是独立模块，后续阶段扩展时不得破坏本阶段接口
- 提交粒度：一个功能一个 commit，全部提交前过 `npm run check`
