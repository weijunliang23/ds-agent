# phase3.md — 上下文引擎完整化 + 模型路由完整化

## 目标
在第 4 周内补齐两件事：
1. **上下文检索**：长对话不再把全部历史塞进 prompt，而是检索与当前问题相关的历史片段注入上下文（本期用**关键词检索**，接口设计成可插拔，embedding 留待后续）。
2. **多 provider 与失败回退**：支持配置多个模型 provider，请求按序尝试，前一个失败自动回退到下一个，全部失败给出聚合错误。

## 产出物
- 上下文检索：`ContextEngine` 扩展 `retrieve()`，内部按会话维护 chunk 索引；关键词打分（CJK 字符 bigram + 简化 BM25），无第三方依赖
- 上下文注入：Runtime 组装消息时保留最近 N 条原文，窗口外相关旧消息以 `system` 上下文块注入
- 多 provider 配置：`AppConfig` 的 `llm` 段改为 `providers` 数组，兼容迁移旧单 provider 配置
- 模型路由回退：`chat` / `streamChat` 按序尝试 provider，失败回退，全败抛聚合错误；结果附带 `usedProviderId`
- 设置 UI：provider 列表增删改表单；IPC `sanitizeSettings` 同步扩展

## 配置约定（在 phase2 的 `settings.json` 基础上改造）

### 多 provider（`llm` 段）

旧结构为单 provider：`llm.apiKey / llm.baseUrl / llm.model / llm.timeoutMs`。本期改为：

| 配置项 | 存储 key | 说明 | 默认 |
|--------|----------|------|------|
| provider 列表 | `llm.providers` | `LlmProviderConfig[]`，按顺序尝试 | 空数组 |
| 单个 provider id | `llm.providers[i].id` | 唯一标识（自动生成或用户起名） | 无 |
| 单个 provider 标签 | `llm.providers[i].label` | 展示名，可空 | 空 |
| AppKey | `llm.providers[i].apiKey` | 服务密钥 | 空 |
| API 地址 | `llm.providers[i].baseUrl` | OpenAI 兼容根地址 | 空 |
| 模型名 | `llm.providers[i].model` | 模型标识 | 空 |
| 超时(ms) | `llm.providers[i].timeoutMs` | 单 provider 请求超时 | `60000` |

**迁移规则**：加载时若 `providers` 为空/缺失、但旧 `llm.apiKey/baseUrl/model` 存在，则迁移为 `providers = [{ id: 'default', ...旧字段 }]`。迁移只发生在读取侧，不主动改写磁盘，避免破坏旧文件。

**环境变量兜底**：仅兜底主 provider（数组第一个）：`LLM_API_KEY / LLM_BASE_URL / LLM_MODEL / LLM_TIMEOUT_MS`。多个 provider 的完整配置只在设置 UI 里维护。

### 上下文检索（`context` 段，新增）

| 配置项 | 存储 key | 说明 | 默认 |
|--------|----------|------|------|
| 检索开关 | `context.retrievalEnabled` | 是否启用上下文检索 | `true` |
| 检索 topK | `context.topK` | 每次注入的最大相关片段数 | `3` |
| 最近消息窗口 | `context.recentWindow` | 始终原样保留的最近消息条数 | `8` |
| 片段切分长度 | `context.chunkSize` | 长消息按约 N 字符切段 | `500` |

环境变量兜底：`CONTEXT_RETRIEVAL_ENABLED` / `CONTEXT_TOP_K` / `CONTEXT_RECENT_WINDOW`。

## 核心接口

### 上下文检索（`src/main/context-engine.ts` 扩展）

```ts
export interface ContextChunk {
  id: string               // 会话内唯一：`${sessionId}:${messageIndex}:${partIndex}`
  sessionId: string
  role: ChatMessage['role']
  text: string             // 片段文本
  messageIndex: number     // 在原消息列表中的下标，用于排序/去重
  partIndex: number        // 同一消息内的切段下标
  createdAt: number
}

export interface RetrievalStrategy {
  index(chunk: ContextChunk): void          // 增量索引
  search(query: string, topK: number, sessionId?: string): ContextChunk[]
  remove(sessionId: string): void           // 会话删除时清除对应索引
  clear(): void
}

// ContextEngine 新增（现有方法不变，不破坏 phase1/phase2 测试）
retrieve(sessionId: string, query: string, topK: number): ContextChunk[]
setRetrievalStrategy(strategy: RetrievalStrategy): void
setChunkSize(size: number): void
```

实现：
- `MemoryContextEngine.appendMessage` 时同步切 chunk 并喂给 `RetrievalStrategy`
- 关键词策略：`KeywordRetrievalStrategy`——中文按 CJK 字符 bigram 建词，英文按空白分词；用简化 BM25 打分（`idf` 按全索引文档数统计），返回 topK
- 检索结果按 `messageIndex` 升序返回，同一消息多段合并显示

### 上下文注入（`src/main/runtime.ts` 内部）

组装顺序（`buildMessages(sessionId, userText)`）：
1. 系统提示（现有）若存在，放最前
2. `system` 检索上下文块：`以下是历史对话中与当前问题相关的片段：` + 检索片段（仅在 `retrievalEnabled` 且检索命中时注入）
3. 最近 `recentWindow` 条消息原样
4. 当前 user 消息

> 说明：检索注入的是**窗口外**的旧消息片段；最近消息始终原样保留保证连贯。当前 user 消息在进入组装前先追加进会话，组装时排除最后一次 user 重复项。

### 多 provider 路由（`src/main/model-router.ts` 扩展）

```ts
export interface LlmProviderConfig extends LlmSettings {
  id: string
  label?: string
}

export interface ChatCompletionResult {
  content: string
  reasoningContent?: string
  toolCalls?: ToolCall[]
  usedProviderId?: string   // 新增：本次实际命中的 provider
}

// ModelRouter 签名变更：settings: LlmSettings → providers: LlmProviderConfig[]
chat(messages, providers, options?, tools?, signal?): Promise<ChatCompletionResult>
streamChat(messages, providers, options, handlers, signal?): Promise<ChatCompletionResult>
fim(input, providers): Promise<ChatCompletionResult>
```

回退语义：
- 按 `providers` 数组顺序尝试；单 provider 失败（未配置 / 网络错误 / HTTP 非 2xx / 格式异常）记录原因后尝试下一个
- 全部失败时抛聚合错误：列出每个 provider 的 `id` 与失败原因，形如 `模型请求全部失败：provider-a: ...; provider-b: ...`
- `streamChat` 仅在**发起阶段**（建连 / 非 2xx / 无 body）失败时回退；流中途失败不回退（无法重放），直接抛错
- 命中结果回填 `usedProviderId`
- 单个 provider 跳过无配置（缺 apiKey 或 baseUrl）的项，不算失败

## 小步拆分（每步单独验证）
1. `src/shared/config.ts`：`providers` 数组 + 旧 `llm` 迁移 + `isConfigured`（至少一个有效 provider），单测（迁移、空列表、环境变量兜底主 provider）
2. `src/main/context-engine.ts`：`ContextChunk` 切分 + `KeywordRetrievalStrategy`（中文 bigram / 英文分词 / 打分排序 / topK / 空索引返回空），单测
3. `src/main/runtime.ts`：`buildMessages` 组装（最近窗口 + 检索注入 system 块，mock router 断言传入 messages），单测
4. `src/main/model-router.ts`：多 provider 顺序回退 + 聚合错误 + `usedProviderId`（mock fetch 序列：第一个失败第二个成功 / 全败 / 跳过未配置项），单测
5. `src/main/model-router.ts`：`streamChat` 发起阶段回退、中途失败不回退，单测
6. IPC + 设置 UI：`sanitizeSettings` 支持 `providers` 与 `context` 段；设置页 provider 列表（增删改）+ 检索配置项，端到端手动验证
7. 收尾：`npm run check` 全绿 + 端到端手动验证（长对话引用旧片段；主 provider 失效回退备用）+ 提交

## 目录结构（本阶段新增/扩展）
```
my-agent/
├── src/
│   ├── shared/
│   │   └── config.ts         # (扩展) providers 数组 + context 段 + 迁移
│   ├── main/
│   │   ├── context-engine.ts # (扩展) retrieve() + RetrievalStrategy + KeywordRetrievalStrategy
│   │   ├── model-router.ts   # (扩展) providers 参数 + 回退 + usedProviderId
│   │   ├── runtime.ts        # (扩展) buildMessages 组装 + providers 传递
│   │   └── ipc.ts            # (扩展) sanitizeSettings 支持 providers/context
│   └── renderer/
│       ├── settings.ts       # (扩展) provider 列表表单 + 检索配置
│       └── *.html            # (扩展) 设置页 DOM
├── tests/
│   ├── config.test.ts        # (扩展) providers 迁移用例
│   ├── context-engine.test.ts# (扩展) 检索用例
│   ├── runtime.test.ts       # (扩展) 注入组装用例
│   └── model-router.test.ts  # (扩展) 回退用例
```

> 注：上下文检索全部在内存中完成，无网络请求；关键词打分算法必须能脱离模型单独单测。

## 可验证的结束状态
- 长对话（超过最近窗口）后提问，模型能引用旧消息中的相关片段（检索命中并被注入）
- 主 provider 配置错误、备用 provider 可用：对话仍成功，回退逻辑可测（单测断言 `usedProviderId`）
- 所有 provider 均失败：返回聚合错误（列出各 provider 原因），不崩溃
- 旧 `llm` 单 provider 配置升级后行为不变（迁移生效）
- `npm run check` 全绿

## 给 LLM 的规则
- 每完成一个小步跑对应单测验证，再进下一步
- 上下文引擎现有接口（createSession / appendMessage / getHistory 等）**不得破坏**，phase1/phase2 测试必须继续通过
- 检索算法用内存实现、纯函数化，方便单测；appkey 只出现在设置 UI 与 userData 的 `settings.json`
- 单 provider 未配置就跳过，不参与回退计数；全败才抛聚合错误
- 提交粒度：一个功能一个 commit，全部提交前过 `npm run check`
