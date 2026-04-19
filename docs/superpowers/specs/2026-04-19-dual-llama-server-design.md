# 双 llama-server 实例架构设计

## 背景

当前架构使用单个 llama-server 实例同时处理对话和 embedding，均使用 Qwen3-4B 模型。由于 Qwen3 的 embedding 维度为 2560 维，在文档量大时检索效率下降。

切换为专用的 bge-small-zh-v1.5 embedding 模型，该模型：
- Embedding 维度：384 维（更紧凑，检索更快）
- 专为中文语义相似度优化
- 文档量大时召回率更稳定

## 架构设计

```
┌─────────────────────────────────────────────────────────────┐
│                      ServerManager                           │
├─────────────────────────────────────────────────────────────┤
│  chatProcess (8080)          embeddingProcess (8081)       │
│  ├── llama-server.exe         ├── llama-server.exe         │
│  ├── Qwen3-4B-Q5_K_M.gguf   └── bge-small-zh-v1.5.gguf  │
│  └── 对话生成                └── 向量化                      │
└─────────────────────────────────────────────────────────────┘
```

### 端口分配

| 端口 | 用途 | 模型 |
|------|------|------|
| 8080 | 对话生成 | Qwen3-4B-Q5_K_M.gguf |
| 8081 | 向量化 | bge-small-zh-v1.5.gguf |

## 文件修改清单

### 1. serverManager.ts

新增 `EmbeddingServerManager` 类（与现有 `ServerManager` 结构一致）：

```typescript
class EmbeddingServerManager {
  private process: ChildProcess | null = null
  private port = 8081
  private modelPath!: string
  private llamaServerPath!: string

  async start(): Promise<void> { ... }
  async stop(): Promise<void> { ... }
}
```

修改 `ServerManager` 类：
- 新增 `embeddingManager: EmbeddingServerManager` 属性
- `start()` 时同时启动 embedding 服务
- `stop()` 时同时停止 embedding 服务

路径配置：
- chat llama-server: `resources/llama-server-GPU/llama-server.exe`
- chat model: `{modelsDir}/Qwen3-4B-Q5_K_M.gguf`
- embedding llama-server: `resources/llama-server-GPU/llama-server.exe`
- embedding model: `resources/bge-small-zh-v1.5-gguf/`

### 2. embeddings.ts

修改端口配置：

```typescript
// 修改前
port: 8080

// 修改后
port: 8081
```

### 3. indexManager.ts

修改向量维度常量：

```typescript
// 修改前
const EMBEDDING_DIM = 2560

// 修改后
const EMBEDDING_DIM = 384
```

**注意**：切换后需要删除现有 LanceDB 数据并重新导入文档。

### 4. store.ts

新增 embedding 模型路径获取方法：

```typescript
export function getEmbeddingModelPath(): string {
  const resourcesDir = app.isPackaged
    ? join(process.resourcesPath!, 'app.asar.unpacked', 'resources', 'bge-small-zh-v1.5-gguf')
    : join(app.getAppPath(), '..', '..', 'resources', 'bge-small-zh-v1.5-gguf')
  // 扫描目录找到实际的 .gguf 文件
  return findModelFile(resourcesDir, '.gguf')
}
```

### 5. index.ts

修改启动/停止逻辑：

```typescript
// 启动时
await embeddingManager.start()
await serverManager.start()

// 停止时
await serverManager.stop()
await embeddingManager.stop()
```

### 6. electron-builder.yml

确保 bge 模型被打包：

```yaml
asarUnpack:
  - "**/*.exe"
  - resources/**

files:
  - resources/**/*  # 确保包含 bge-small-zh-v1.5-gguf
```

### 7. CLAUDE.md

更新架构文档中的向量维度信息。

## 数据迁移

切换后用户需要手动删除旧数据：

```
C:\Users\{user}\AppData\Roaming\rag-knowledge-base\data\
```

重新导入所有文档。

## 启动顺序

1. 启动 embedding 服务（8081）— 用于文档导入时的向量化
2. 启动 chat 服务（8080）— 用于对话生成

## 停止顺序

1. 停止 chat 服务（8080）
2. 停止 embedding 服务（8081）

## 错误处理

- 如果 embedding 服务启动失败，显示错误提示
- 如果 embedding 服务运行中崩溃，chat 服务继续运行（文档导入会失败）
