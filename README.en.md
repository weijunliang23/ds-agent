# my-agent

**English** | [中文](README.md)

> An Electron desktop AI Agent application implemented end-to-end by an LLM.

`my-agent` is a desktop AI Agent that aims to run the whole "understand context → call tools → modify code" loop locally. It does more than chat: it can read and write local files, retrieve relevant context on demand, and automatically fall back across multiple models — and, eventually, apply Git-diff-level changes to your codebase directly through the **Patch Engine**.

The entire project is implemented by an LLM, driven by a week-by-week roadmap where every phase ends in a "runnable and verifiable" state.

## Key Features

- **Chat & Streaming**: multi-turn conversation, streaming output, toggleable thinking mode with adjustable reasoning effort.
- **Context Engine**: instead of stuffing all history into the prompt, it indexes each session and injects only the relevant snippets (keyword retrieval with a pluggable interface; embedding-based retrieval is reserved for later).
- **Model Router**: configure multiple OpenAI-compatible providers, tried in order with automatic fallback; aggregate error when all fail, and reports the provider that actually served the request.
- **Tool System**: a unified framework for tool registration, execution, and permission control; ships with `read_file` / `write_file` / `list_dir` file tools and configurable read/write policies (allow / ask / deny).
- **Patch Engine (planned)**: Git diff generation, patch application, and conflict detection, letting the agent land code changes precisely.
- **More on the roadmap**: image understanding, file drag-and-drop, a shell tool, and embedding-based context retrieval.

## Tech Stack

- **Electron 43** + **electron-vite 5** + **Vite 7**
- **TypeScript 6** (strict)
- **ESLint 10** + **typescript-eslint**
- **Vitest 4** for unit tests
- **markdown-it** for message rendering

## Getting Started

```bash
# Install dependencies
npm install

# Start the dev mode (opens a window)
npm run dev

# Code check: lint + typecheck + unit tests
npm run check

# Build
npm run build
```

On first use, configure a model provider in the settings page (OpenAI-compatible API base URL, AppKey, and model name). You can also bootstrap the primary provider via the environment variables `LLM_API_KEY` / `LLM_BASE_URL` / `LLM_MODEL`.

## Project Structure

```
my-agent/
├── src/
│   ├── shared/       # Shared types and config loading (config / settings / tools)
│   ├── main/         # Electron main process: runtime, context engine, model router, tool executor, IPC
│   │   └── tools/    # Tool registration, permissions, file tools
│   └── renderer/     # UI: chat, settings, permission dialogs, sidebar
├── tests/            # Vitest unit tests
├── docs/             # Phase docs
├── phase.md          # Roadmap (Phase 0–5)
└── package.json
```

## Roadmap

Six phases per `phase.md`, each delivering runnable, verifiable results:

| Phase | Scope | Status |
|-------|-------|--------|
| Phase 0 | Project scaffold: Electron + Vite + TS + ESLint + Vitest | Done |
| Phase 1 | Runtime, session/message history, single-provider Chat | Done |
| Phase 2 | Tool system, file read/write, permission control | Done |
| Phase 3 | Context retrieval + multi-provider routing with fallback | Done |
| Phase 4 | Image understanding, drag-and-drop, shell tool, UI polish | Planned |
| Phase 5 | Patch Engine (diff / apply / conflicts) | Planned |

## Documentation

- `phase.md`: the roadmap and mandatory rules for the LLM
- `docs/phase0.md` ~ `docs/phase3.md`: per-phase design and acceptance criteria
- Docs are written in Chinese; the consolidated interfaces live in `10-api.md` (planned)

## License

MIT
