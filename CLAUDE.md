# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

本地 AI 知识库桌面应用（Electron + Vue 3），用于私密文档问答。用户可导入 PDF/Word/Markdown/TXT 文档并与其对话，所有处理均在本地完成。

## 构建与运行命令

```bash
npm install              # 安装依赖
npm run dev              # 开发模式（热重载）
npm run build            # 生产构建
npm run build:unpack     # 构建免安装版
npm run build:win        # 构建 Windows 安装包
npm run typecheck        # 类型检查（主进程 + 渲染进程）
npm run typecheck:node   # 仅检查主进程 / preload 进程
npm run typecheck:web    # 仅检查渲染进程（Vue）
```

## 架构

三进程 Electron 架构：

```
src/
├── main/           # Node.js 主进程（应用生命周期、IPC 处理器）
├── preload/        # 上下文桥接（向渲染进程暴露 window.api）
└── renderer/       # Vue 3 前端（UI、状态管理、视图）
```

### 主进程模块（`src/main/`）

- **index.ts** - 应用入口、窗口创建、注册 IPC 处理器
- **serverManager.ts** - 管理 llama-server 子进程、HTTP API 调用、流式响应
- **documentProcessor.ts** - 解析 PDF/DOCX/MD/TXT（pdf-parse、mammoth、marked）
- **indexManager.ts** - LanceDB 向量数据库操作：分块（512 tokens）、向量化、相似性搜索
- **ragEngine.ts** - RAG 编排：检索 top-K → 构建 prompt → llama-server → 流式响应
- **logger.ts** - 日志工具

### 渲染进程模块（`src/renderer/src/`）

- **stores/chatStore.ts** - Pinia store：消息列表、流式状态、sendMessage()
- **stores/documentStore.ts** - Pinia store：文档列表、导入/删除操作
- **components/** - ChatArea、MessageBubble、Sidebar、FileUploader、DocList
- **views/** - Home（聊天布局）、Settings（服务器状态、模型下载）

### IPC 通信

渲染进程调用 `window.api.*` 路由到主进程：

| namespace | 可用操作 |
|-----------|---------|
| `api.server` | status、start、stop、downloadModel |
| `api.document` | import、importBatch、list、delete |
| `api.rag` | query、queryStream、onChunk、onEnd、onError |
| `api.dialog` | openFile |

## RAG 流程

```
导入 → 解析 → 分块（512 tokens）→ 向量化 → LanceDB
查询 → 向量化 → 相似性搜索（top-K=5）→ 构建 prompt → llama-server → 流式响应
```

模型：Qwen3-1.5B-GGUF（聊天）、bge-small-zh-v1.5（向量化）

## 代码风格

- Vue 组件：`<script setup lang="ts">` + Composition API
- 组件内使用 scoped CSS
- 启用 TypeScript strict mode（tsconfig.node.json / tsconfig.web.json）
- 路径别名：`@/*` → `src/renderer/src/*`

## 关键约束

- 启用 Context Isolation，禁用 Node Integration
- 所有 LLM 推理通过 localhost 上的 llama-server 完成
- 文档数据存储在 userData 目录下
