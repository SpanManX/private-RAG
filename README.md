# RAG 知识库

基于 Electron + Vue 3 的纯本地 AI 知识库桌面应用。导入私密文档（PDF / Word / Markdown / TXT），通过自然语言与文档对话，全程本地运行，隐私安全。

## 技术栈

| 模块 | 选型 | 说明 |
|------|------|------|
| 桌面框架 | Electron 33 | Node.js 主进程 + WebView2 渲染 |
| 前端框架 | Vue 3 + TypeScript | 组合式 API |
| 构建工具 | electron-vite | 更快的前端开发体验 |
| 状态管理 | Pinia | 轻量响应式状态管理 |
| 推理引擎 | llama.cpp | 通过 llama-server 调用 Qwen3 模型 |
| 对话模型 | Qwen3-1.5B-GGUF | Q4 量化，约 1.5GB |
| Embedding | bge-small-zh-v1.5 | 集成在 llama-server 中 |
| 向量数据库 | LanceDB | 单文件数据库，无需安装 |
| 文档解析 | pdf.js / mammoth / marked | PDF/Word/Markdown/TXT 支持 |

## 项目结构

```
rag-knowledge-base/
├── src/
│   ├── main/                       # Electron 主进程
│   │   ├── index.ts                 # 入口，窗口创建，IPC 注册
│   │   ├── serverManager.ts         # llama-server 进程管理
│   │   ├── documentProcessor.ts     # 文档解析（PDF/DOCX/MD/TXT）
│   │   ├── indexManager.ts          # LanceDB 索引管理
│   │   └── ragEngine.ts             # RAG 编排（检索 → 生成）
│   ├── preload/                     # 预加载脚本
│   │   └── index.ts                 # 暴露 API 给渲染进程
│   └── renderer/                    # Vue 3 前端
│       ├── src/
│       │   ├── main.ts              # 前端入口
│       │   ├── App.vue              # 根组件
│       │   ├── router.ts            # 路由配置
│       │   ├── components/          # 组件
│       │   │   ├── Sidebar.vue      # 知识库侧边栏
│       │   │   ├── ChatArea.vue     # 对话区域
│       │   │   ├── MessageBubble.vue # 消息气泡
│       │   │   ├── FileUploader.vue  # 拖拽上传
│       │   │   └── DocList.vue      # 文档列表
│       │   ├── views/
│       │   │   ├── Home.vue          # 首页（对话视图）
│       │   │   └── Settings.vue      # 设置页
│       │   ├── stores/              # Pinia 状态
│       │   │   ├── documentStore.ts # 文档状态
│       │   │   └── chatStore.ts     # 对话状态
│       │   └── styles/
│       │       └── main.css         # 全局样式
│       └── index.html
├── electron-builder.yml              # 打包配置
├── electron.vite.config.mjs          # electron-vite 配置
├── package.json
└── README.md
```

## RAG 流程

```
文档导入
    │
    ▼
┌──────────────────┐
│  文档解析         │   PDF / DOCX / MD / TXT → 纯文本
│  DocumentProcessor │
└────────┬─────────┘
         │ 文本
         ▼
┌──────────────────┐
│  分块             │   512 tokens / chunk
│  Chunking         │
└────────┬─────────┘
         │ chunks
         ▼
┌──────────────────┐
│  Embedding       │   bge-small-zh-v1.5
│  向量化           │   → 向量存入 LanceDB
└──────────────────┘

用户提问
    │
    ▼
┌──────────────────┐
│  语义检索         │   Top-K 最相关片段
│  向量相似度匹配    │
└────────┬─────────┘
         │ 相关片段
         ▼
┌──────────────────┐
│  LLM 生成         │   Qwen3-1.5B 生成回答
│  推理             │   附带引用来源
└────────┬─────────┘
         │ 回答 + 引用
         ▼
      前端展示
```

## 前端界面布局

```
┌──────────────────────────────────────────────────────┐
│  个人私密知识库                    [首页] [设置]     │
├──────────────┬─────────────────────────────────────┤
│              │                                      │
│  知识库       │     对话区域                          │
│              │                                      │
│  📄 文件A.pdf │     ┌──────────────────────────────┐ │
│  📄 笔记.md   │     │ AI: 基于您导入的文档，回答... │ │
│  📄 报告.docx │     │   📄 出处: 文件A.pdf 第3页   │ │
│              │     └──────────────────────────────┘ │
│              │                                      │
│  [+ 导入文档] │     ┌──────────────────────────────┐ │
│              │     │ 用户: 这篇文档讲了什么？       │ │
│              │     └──────────────────────────────┘ │
│              │                                      │
│              ├──────────────────────────────────────┤
│              │  输入问题...              [发送]    │
└──────────────┴─────────────────────────────────────┘
```

## 环境要求

- Windows 10/11（64 位）
- 内存：最低 4GB（推荐 8GB+）
- 磁盘：至少 5GB 可用空间
- 可选：NVIDIA GPU（支持 CUDA 12.x）以获得更快推理速度

## 安装运行

```bash
# 安装依赖
npm install

# 开发模式（热更新）
npm run dev

# 类型检查
npm run typecheck

# 构建 Windows 安装包
npm run build:win
```

## 实现阶段

- [x] **阶段一**：项目脚手架，Electron + Vue 3 基础架构
- [ ] **阶段二**：llama-server 进程管理、模型下载/启动
- [ ] **阶段三**：文档解析（PDF/Word/Markdown/TXT）
- [ ] **阶段四**：LanceDB 索引写入与检索
- [ ] **阶段五**：完整 RAG 对话流程 + 流式输出
- [ ] **阶段六**：UI 优化、新手引导、打包分发

## License

MIT
