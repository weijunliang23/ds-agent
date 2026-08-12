# phase2.md — Tool 系统 + 文件操作

## 目标
在第 3 周内让 Chat 具备「工具调用」能力：模型能根据对话内容调用注册好的工具（本阶段只有文件读写），执行结果回传给模型并汇入回复。

本阶段是权限控制的首次落地：**写文件必须经过用户确认**（默认策略为 ask），任何工具都不得绕过权限直接触碰本地文件。

## 产出物
- Tool 系统：`Tool` 接口 + 参数校验 + `ToolRegistry` 注册中心 + `ToolExecutor` 执行器
- 权限控制：`Permissions` 裁决器，按 `allow / ask / deny` 三种策略控制文件读写，路径统一规范化防目录穿越
- 文件工具：`read_file` / `write_file`（含追加模式可选）
- 模型路由扩展：请求带 `tools`，响应解析 `tool_calls`，支持工具调用循环（model → tool → model）
- UI 扩展：Chat 中展示工具调用过程卡片；权限确认条（内联展示在输入框上方，不遮挡消息区）；设置页新增工作区与读写策略配置

## 配置约定（在 phase1 的 `settings.json` 基础上新增）

`src/shared/config.ts` 的 `AppConfig` 增加 `tools` 段：

| 配置项 | 存储 key | 说明 | 默认 |
|--------|----------|------|------|
| 工作区目录 | `tools.workspace` | 允许读写的根目录（绝对路径） | 空（此时所有读写都按 ask） |
| 读取策略 | `tools.readPolicy` | `allow` / `ask` / `deny` | `ask` |
| 写入策略 | `tools.writePolicy` | `allow` / `ask` / `deny` | `ask` |
| 最大工具迭代 | `tools.maxIterations` | 单次对话内工具调用循环上限，防死循环 | `8` |

优先级与 phase1 一致：设置界面保存值 → 环境变量兜底（`TOOLS_WORKSPACE` / `TOOLS_READ_POLICY` / `TOOLS_WRITE_POLICY`）→ 内置默认值。

### 权限语义
- 在 `workspace` **内**读取：按 `readPolicy` 裁决
- 在 `workspace` **外**读取：一律 `ask`（`deny` 策略下则 `deny`）
- 写文件（无论内外）：一律按 `writePolicy` 裁决，**默认 `ask`，未经确认不得落盘**
- `ask` 时由主进程向渲染进程发起权限请求，用户点「允许」后该工具调用才继续执行；请求需带 `permissionId`，超时（30s）未响应按拒绝处理
- 会话内一次 `ask` 允许后，**同一路径同一 action** 在本次会话内记住为 allow，避免重复打扰

## 核心接口（写入 `src/shared/tools.ts`）

```ts
export interface Tool {
  name: string;                 // 唯一名称，如 read_file
  description: string;          // 给模型看的说明
  parameters: ToolParameterSchema; // 参数 JSON Schema（子集）
  permission?: ToolPermission;  // 工具声明的权限（action + 参数名）；无则不需确认
  execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>;
}

export interface ToolResult {
  ok: boolean;
  content: string;   // 回传给模型的文本（可含文件内容 / 成功信息 / 错误信息）
}

export interface ToolContext {
  workspace: string;                       // 当前工作区根目录
  resolvePath(p: string): string;          // 规范化绝对路径；越出工作区交由权限层裁决（不抛错）
}

export type PermissionAction = 'read' | 'write';
export type PermissionPolicy = 'allow' | 'ask' | 'deny';
export interface PermissionRequest { action: PermissionAction; path: string; }
export interface ToolPermission { action: PermissionAction; pathArg: string; }

// 权限裁决：decide() 返回 'allow' | 'deny' | 'ask'；authorize() 将 ask 交给确认通道（requester）解析，
// 无确认通道时按 deny 处理；ask 允许后同一路径同一 action 在会话内记住为 allow
```

> 说明：`PermissionVerdict` 未单独建模——`Permissions.decide` 返回 `'allow' | 'deny' | 'ask'`，`authorize` 内部把 `ask` 交给 `PermissionRequester` 解析（IPC 确认，30s 超时按拒绝）。`resolvePath` 只做规范化不抛错，越界访问统一由权限层裁决（工作区外读取默认 ask，`readPolicy=deny` 时直接 deny）。

- `validateArgs(schema, args)`：按 JSON Schema 子集校验模型传入的参数，失败返回可读错误，**未通过校验的工具参数绝不进入执行**
- 工具执行产生的异常一律捕获并包装成 `ToolResult { ok: false, content: 错误信息 }` 回传模型，不能让未捕获异常穿透到 Runtime

## 小步拆分（每步单独验证）
1. `src/shared/tools.ts`：`Tool` 接口 + `validateArgs` 参数校验，单测（合法 / 缺参 / 类型错）
2. `src/main/tools/registry.ts`：`register / get / list`，重复注册报错，单测
3. `src/main/tools/file-tools.ts`：`read_file` / `write_file` 实现，路径走 `resolvePath` 防穿越，单测用临时目录（`os.tmpdir()` 下 `mkdtemp`）
4. `src/main/tools/permissions.ts`：`Permissions` 裁决器（scope 内外规则 + 会话内记忆 + ask 挂起与超时），单测
5. `src/main/tools/executor.ts`：`ToolExecutor`：校验参数 → 权限裁决 → 执行 → 错误捕获，单测
6. `src/main/model-router.ts` 扩展：请求带 `tools`、响应解析 `tool_calls`，单测 mock fetch
7. `src/main/runtime.ts` 扩展：工具调用循环（取历史 → 调模型 → 若有 `tool_calls` 执行工具 → 回喂结果再调模型 → 直到普通回复或超迭代上限），单测
8. IPC + UI：`tool:permission-request` / `tool:permission-response` 通道，内联权限确认条（输入框上方），Chat 工具卡片（「正在读取文件… / 已完成 / 失败」）；设置页新增工作区与读写策略
9. 收尾：`npm run check` 全绿 + 端到端手动验证「让模型读取并写一个本地文件」+ 提交

## 目录结构（本阶段新增/扩展）
```
my-agent/
├── src/
│   ├── shared/
│   │   ├── tools.ts          # (新增) Tool 接口 + JsonSchema + validateArgs
│   │   └── config.ts         # (扩展) 新增 tools 段配置
│   ├── main/
│   │   ├── tools/
│   │   │   ├── registry.ts   # (新增) ToolRegistry
│   │   │   ├── executor.ts   # (新增) ToolExecutor
│   │   │   ├── permissions.ts# (新增) Permissions 裁决器
│   │   │   └── file-tools.ts # (新增) read_file / write_file
│   │   ├── runtime.ts        # (扩展) 工具调用循环
│   │   ├── model-router.ts   # (扩展) tools 参数 + tool_calls 解析
│   │   └── ipc.ts            # (扩展) 权限请求/响应 + 工具事件推送
│   └── renderer/
│       ├── chat/             # (扩展) 工具调用卡片
│       └── settings/         # (扩展) 工作区 + 权限策略表单
├── tests/
│   ├── tools.test.ts
│   ├── registry.test.ts
│   ├── file-tools.test.ts
│   ├── permissions.test.ts
│   ├── executor.test.ts
│   ├── model-router-tools.test.ts
│   └── runtime-tools.test.ts
```

> 注：所有文件工具单测一律用临时目录，禁止在仓库目录或用户目录内落盘。

## 可验证的结束状态
- 对话中让模型「读取 `/tmp/x.txt`」→ 模型调用 `read_file`，内容被读入并在回复中体现
- 对话中让模型「把某内容写入 `D:/work/out.txt`」→ 触发写权限确认条，允许后文件成功写入、模型确认完成
- `writePolicy = deny` 或用户拒绝时：不落盘，模型得到「无权限」的可读错误并据此回应
- 工具调用失败（路径不存在 / 参数非法）：不崩溃，Chat 卡片显示失败原因，模型能读回错误
- 工具循环有迭代上限，超限即停止并提示，不无限消耗
- `npm run check` 全绿

## 给 LLM 的规则
- 每完成一个小步跑对应单测验证，再进下一步
- **写文件默认 `ask`**，任何代码与测试都不得绕过权限直接落盘；单测只验证权限裁决逻辑
- 路径必须经 `resolvePath` 规范化后再使用，严格拒绝 `../` 目录穿越
- 模型返回的 `tool_calls` 参数必须先过 `validateArgs`，未通过不得执行
- 工具调用循环必须设最大迭代次数，防止模型死循环烧 token
- 权限确认不得阻塞主进程事件循环（走 IPC 异步回调 + 超时兜底）
- 提交粒度：一个功能一个 commit，全部提交前过 `npm run check`
