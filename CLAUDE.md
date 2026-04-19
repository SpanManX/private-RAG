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

- **index.ts** - 应用入口、窗口创建、注册 IPC 处理器、应用生命周期清理
- **serverManager.ts** - 管理 llama-server 子进程
  - chat 服务（8080）：Qwen3-4B 对话生成
  - embeddingManager：独立管理 embedding 服务（8081），使用 bge-small-zh-v1.5 模型
- **documentProcessor.ts** - 解析 PDF/DOCX/MD/TXT（pdf-parse、mammoth）
- **indexManager.ts** - LanceDB 向量数据库操作：分块（512 字符）、向量化、相似性搜索（IVF_PQ 索引）
- **ragEngine.ts** - RAG 编排：检索 top-K → 构建 prompt → 流式响应
- **store.ts** - 配置持久化（config.json），管理模型目录路径
- **logger.ts** - 日志工具，写入 userData/logs/main.log
- **langchain/embeddings.ts** - LangChain Embeddings 接口封装，调用 embedding 服务（8081）`/embedding` API 并做 L2 归一化
- **units/nvidiaUtil.ts** - CUDA GPU 检测工具
- **units/embeddingServerManager.ts** - 独立的 embedding llama-server 进程管理（8081 端口）

### 渲染进程模块（`src/renderer/src/`）

- **stores/chatStore.ts** - Pinia store：消息列表、流式状态、sendMessage()
- **stores/documentStore.ts** - Pinia store：文档列表、导入/删除操作
- **components/** - ChatArea、MessageBubble、Sidebar、FileUploader、DocList
- **views/** - Home（聊天布局）、Settings（服务器状态、模型下载）

### IPC 通信

渲染进程调用 `window.api.*` 路由到主进程：

| namespace | 可用操作 |
|-----------|---------|
| `api.server` | status、start、stop、downloadModel、cancelDownload、onDownloadProgress |
| `api.document` | import、importBatch、list、delete、onImportProgress |
| `api.rag` | queryStream、systemTemplate |
| `api.dialog` | openFile、selectDirectory |
| `api.config` | getModelsDir、setModelsDir |

## RAG 流程

```
用户提问 → 调用 embedding 服务（8081）→ 获取向量 → 查询 LanceDB → 拿到 TopK 文档 → 拼接 prompt → 调用 llama-server（8080）→ 返回答案
```

流式响应：前端使用 `@microsoft/fetch-event-source` 直连 `http://localhost:8080/v1/chat/completions`，主进程仅负责构建 prompt 和返回引用来源

模型：
- 对话服务（8080）：Qwen3-4B-Q5_K_M.gguf
- Embedding 服务（8081）：bge-small-zh-v1.5（384 维向量）

## 代码风格

- Vue 组件：`<script setup lang="ts">` + Composition API
- 组件内使用 scoped CSS
- 启用 TypeScript strict mode（tsconfig.node.json / tsconfig.web.json）
- 路径别名：`@/*` → `src/renderer/src/*`

## 关键约束

- 启用 Context Isolation，禁用 Node Integration
- 所有 LLM 推理通过 localhost 上的 llama-server 完成
- 文档数据存储在 userData 目录下
