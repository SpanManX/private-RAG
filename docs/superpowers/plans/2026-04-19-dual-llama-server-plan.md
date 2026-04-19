# 双 llama-server 实例架构实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增独立的 embedding 服务（8081端口），使用 bge-small-zh-v1.5 模型进行向量化，替换当前的 Qwen3 embedding，以提升文档检索召回率。

**Architecture:** 新增 `EmbeddingServerManager` 类管理独立的 llama-server 实例（8081），原 `ServerManager` 只负责对话服务（8080）。embedding 服务使用 bge-small-zh-v1.5 模型，向量维度改为 384。

**Tech Stack:** Electron, TypeScript, LanceDB, llama.cpp

---

## 文件修改清单

| 文件 | 操作 | 职责 |
|------|------|------|
| `src/main/serverManager.ts` | 修改 | 添加 `EmbeddingServerManager` 类和 `embeddingManager` 属性 |
| `src/main/embeddings.ts` | 修改 | 端口 8080 → 8081 |
| `src/main/indexManager.ts` | 修改 | 向量维度 2560 → 384 |
| `src/main/store.ts` | 修改 | 添加 `getEmbeddingModelPath()` |
| `src/main/index.ts` | 修改 | 启动/停止逻辑 |
| `src/main/units/embeddingServerManager.ts` | 新建 | EmbeddingServerManager 类（从 serverManager.ts 抽取） |

---

## Task 1: 添加 EmbeddingServerManager 类

**Files:**
- Create: `src/main/units/embeddingServerManager.ts`
- Modify: `src/main/serverManager.ts`

- [ ] **Step 1: 创建 embeddingServerManager.ts**

```typescript
/**
 * Embedding llama-server 进程管理器
 *
 * 职责：
 * 1. 启动/停止独立的 embedding llama-server 子进程（8081端口）
 * 2. 管理 bge-small-zh-v1.5 模型
 */

import {spawn, ChildProcess} from 'child_process'
import {join} from 'path'
import {existsSync} from 'fs'
import {app} from 'electron'
import {log} from '../logger'
import {getCUDAInfo} from './nvidiaUtil'
import * as nodeHttp from 'http'
import {findLlamaServerExe} from './llamaServerUtils'

/** embedding 服务状态 */
export interface EmbeddingServerStatus {
    state: 'idle' | 'starting' | 'running' | 'error'
    message: string
    gpuAvailable?: boolean
}

export class EmbeddingServerManager {
    private process: ChildProcess | null = null
    private port = 8081  // embedding 专用端口
    private modelPath!: string
    private llamaServerPath!: string
    private gpuAvailable: boolean

    constructor() {
        this.gpuAvailable = this.detectGpu()
        this.refreshPaths()
    }

    async refreshPaths(): Promise<void> {
        const gpuInfo = await getCUDAInfo()
        if (gpuInfo.available) {
            console.log(`[Embedding] 检测到 GPU: ${gpuInfo.model}`)
        } else {
            console.warn('[Embedding] 未检测到 GPU，将使用 CPU 模式')
        }

        // dev 模式
        const devResourcesDir = join(app.getAppPath(), '..', '..', 'resources', 'llama-server-GPU')
        // 打包后
        const packedResourcesDir = join(process.resourcesPath!, 'app.asar.unpacked', 'resources', 'llama-server-GPU')

        const resourcesDir = existsSync(devResourcesDir) ? devResourcesDir : packedResourcesDir
        this.llamaServerPath = findLlamaServerExe(resourcesDir) || join(resourcesDir, 'llama-server.exe')
        log(`[Embedding] llama-server 路径: ${this.llamaServerPath}`)

        // 查找 bge 模型
        this.modelPath = this.findEmbeddingModel()
    }

    private findEmbeddingModel(): string {
        const devModelDir = join(app.getAppPath(), '..', '..', 'resources', 'bge-small-zh-v1.5-gguf')
        const packedModelDir = join(process.resourcesPath!, 'app.asar.unpacked', 'resources', 'bge-small-zh-v1.5-gguf')
        const modelDir = existsSync(devModelDir) ? devModelDir : packedModelDir

        try {
            if (!existsSync(modelDir)) return ''
            const files = require('fs').readdirSync(modelDir)
            const modelFile = files.find((f: string) => f.endsWith('.gguf'))
            return modelFile ? join(modelDir, modelFile) : ''
        } catch {
            return ''
        }
    }

    private detectGpu(): boolean {
        const cudaPaths = [
            'C:\\Program Files\\NVIDIA GPU Computing Toolkit\\CUDA',
            'C:\\Windows\\System32\\nvcuda.dll'
        ]
        return cudaPaths.some((p) => existsSync(p))
    }

    async start(): Promise<void> {
        if (this.process) {
            log('[Embedding] embedding-server 已在运行')
            return
        }

        if (!existsSync(this.llamaServerPath)) {
            throw new Error(`[Embedding] llama-server.exe 未找到`)
        }
        if (!existsSync(this.modelPath)) {
            throw new Error(`[Embedding] bge 模型文件未找到`)
        }

        const args = [
            '-m', this.modelPath,
            '-c', '4096',
            '--port', String(this.port),
            '-ngl', this.gpuAvailable ? '99' : '0',
            '--embedding',
            '--host', '127.0.0.1'
        ]

        this.process = spawn(this.llamaServerPath, args, {
            stdio: ['ignore', 'pipe', 'pipe']
        })

        this.process.stdout?.on('data', (data) => {
            log(`[Embedding] ${data.toString().trim()}`)
        })
        this.process.stderr?.on('data', (data) => {
            log(`[Embedding ERROR] ${data.toString().trim()}`)
        })

        this.process.on('exit', (code) => {
            log(`[Embedding] embedding-server 已退出，代码: ${code}`)
            this.process = null
        })

        await this.waitForServer(this.port, 60000)
        log('[Embedding] embedding-server 启动成功，端口 8081')
    }

    async stop(): Promise<void> {
        if (this.process) {
            this.process.kill()
            this.process = null
            log('[Embedding] embedding-server 已停止')
        }
    }

    getStatus(): EmbeddingServerStatus {
        if (!this.process) {
            return {state: 'idle', message: 'Embedding server not running', gpuAvailable: this.gpuAvailable}
        }
        return {state: 'running', message: `Embedding server running on port ${this.port}`, gpuAvailable: this.gpuAvailable}
    }

    private waitForServer(port: number, timeout: number): Promise<void> {
        return new Promise((resolve, reject) => {
            const start = Date.now()
            const check = (): void => {
                const req = nodeHttp.get(`http://localhost:${port}`, () => {
                    resolve()
                })
                req.on('error', () => {
                    if (Date.now() - start > timeout) {
                        reject(new Error('embedding-server 启动超时'))
                    } else {
                        setTimeout(check, 1000)
                    }
                })
            }
            check()
        })
    }
}
```

- [ ] **Step 2: 在 serverManager.ts 中添加 embeddingManager**

在 `ServerManager` 类中添加属性：

```typescript
import {EmbeddingServerManager} from './units/embeddingServerManager'

export class ServerManager {
    // ... 现有属性 ...

    // 新增：embedding 服务管理器
    public embeddingManager: EmbeddingServerManager

    constructor() {
        // ... 现有代码 ...
        this.embeddingManager = new EmbeddingServerManager()
    }
```

- [ ] **Step 3: 提交**

```bash
git add src/main/units/embeddingServerManager.ts src/main/serverManager.ts
git commit -m "feat: 添加 EmbeddingServerManager 类

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 2: 创建工具函数 findLlamaServerExe

**Files:**
- Create: `src/main/units/llamaServerUtils.ts`

- [ ] **Step 1: 创建 llamaServerUtils.ts**

```typescript
import {join} from 'path'
import {existsSync} from 'fs'

/**
 * 查找 llama-server.exe，支持动态文件名
 */
export function findLlamaServerExe(dir: string): string {
    if (!existsSync(dir)) return ''
    try {
        const files = require('fs').readdirSync(dir)
        const exe = files.find((f: string) =>
            f.startsWith('llama-server') && f.endsWith('.exe'))
        return exe ? join(dir, exe) : ''
    } catch {
        return ''
    }
}
```

- [ ] **Step 2: 更新 embeddingServerManager.ts 使用工具函数**

将 `findLlamaServerExe` 的内联实现替换为导入：

```typescript
import {findLlamaServerExe} from './llamaServerUtils'

// 删除内联的 findLlamaServerExe 方法
```

- [ ] **Step 3: 提交**

```bash
git add src/main/units/llamaServerUtils.ts src/main/units/embeddingServerManager.ts
git commit -m "refactor: 抽取 findLlamaServerExe 为工具函数

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 3: 修改 embeddings.ts 端口

**Files:**
- Modify: `src/main/embeddings.ts`

- [ ] **Step 1: 修改端口**

```typescript
// 修改前
port: 8080

// 修改后
port: 8081
```

- [ ] **Step 2: 提交**

```bash
git add src/main/embeddings.ts
git commit -m "feat: embedding API 指向 8081 端口

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 4: 修改 indexManager.ts 向量维度

**Files:**
- Modify: `src/main/indexManager.ts`

- [ ] **Step 1: 修改向量维度**

```typescript
// 修改前
const EMBEDDING_DIM = 2560

// 修改后
const EMBEDDING_DIM = 384
```

- [ ] **Step 2: 提交**

```bash
git add src/main/indexManager.ts
git commit -m "feat: 向量维度从 2560 改为 384（匹配 bge 模型）

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 5: 修改 index.ts 启动/停止逻辑

**Files:**
- Modify: `src/main/index.ts`

- [ ] **Step 1: 修改启动逻辑**

```typescript
// 在 initializeModules 中
async function initializeModules(): Promise<void> {
    const userDataPath = app.getPath('userData')
    serverManager = new ServerManager()
    documentProcessor = new DocumentProcessor()
    indexManager = new IndexManager(userDataPath)
    ragEngine = new RagEngine(indexManager)
    await indexManager.initialize()
    await serverManager.embeddingManager.start()  // 新增：启动 embedding 服务
    await serverManager.start()                   // 启动 chat 服务
    log('Modules initialized')
}
```

- [ ] **Step 2: 修改停止逻辑**

```typescript
// 在 app.on('window-all-closed') 中
app.on('window-all-closed', async () => {
    await serverManager?.stop()                    // 先停止 chat
    await serverManager?.embeddingManager?.stop()  // 再停止 embedding
    if (process.platform !== 'darwin') app.quit()
})

// 在 app.on('before-quit') 中
app.on('before-quit', async () => {
    await serverManager?.stop()
    await serverManager?.embeddingManager?.stop()
    await indexManager?.close()
})
```

- [ ] **Step 3: 提交**

```bash
git add src/main/index.ts
git commit -m "feat: 启动/停止时管理 embedding 服务

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 6: 更新 CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: 更新架构文档**

在架构部分添加 embedding 服务说明：

```markdown
### 主进程模块（`src/main/`）

- **serverManager.ts** - 管理 llama-server 子进程
  - chat 服务（8080）：Qwen3-4B 对话
  - embeddingManager：独立管理 embedding 服务（8081），使用 bge-small-zh-v1.5 模型
```

- [ ] **Step 2: 提交**

```bash
git add CLAUDE.md
git commit -m "docs: 更新 CLAUDE.md 添加 embedding 服务说明

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## 数据迁移说明

实现完成后，用户需要：

1. 删除旧数据目录：
   ```
   C:\Users\{user}\AppData\Roaming\rag-knowledge-base\data\
   ```

2. 重新导入所有文档

---

## 验证步骤

1. 启动应用，检查日志：
   - `[Embedding] embedding-server 启动成功，端口 8081`
   - `llama-server 启动成功`（8080）

2. 导入文档，观察 embedding 向量化是否正常

3. 提问测试 RAG 检索功能
