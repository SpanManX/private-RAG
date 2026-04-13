# 阶段二功能增强实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完善 llama-server 进程管理，增加 embedding 模型下载、重复下载检查、下载取消、三段式进度 UI、停止按钮、状态自动刷新和错误提示。

**Architecture:** 在 `serverManager.ts` 中新增 cancellationToken 和三段式下载逻辑；在 preload/index.ts 新增 cancelDownload API；在 Settings.vue 中新增完整下载状态 UI。

**Tech Stack:** Electron IPC, Vue 3 Composition API, TypeScript

---

## 文件变更概览

| 文件 | 变更 |
|------|------|
| `src/main/serverManager.ts` | cancellationToken、下载取消、embedding 下载、进度增强 |
| `src/main/index.ts` | 新增 `server:cancel-download` handler |
| `src/preload/index.ts` | 新增 `cancelDownload` API |
| `src/renderer/src/views/Settings.vue` | 三段式进度、停止按钮、取消按钮、自动刷新、错误提示 |

---

## Task 1: serverManager.ts - 核心逻辑增强

**Modify:** `src/main/serverManager.ts`

- [ ] **Step 1: 更新 DownloadProgress 接口**

```typescript
export interface DownloadProgress {
  percent: number
  speed: string
  phase: 'llama-server' | 'model' | 'embedding' | 'done'
  fileName: string
  current: number   // 当前阶段 1-3
  total: number      // 总阶段数
}
```

- [ ] **Step 2: 新增 cancellationToken、isDownloading 和 gpuAvailable 缓存字段**

```typescript
export class ServerManager {
  private process: ChildProcess | null = null
  private port = 8080
  private modelPath: string
  private embeddingPath: string
  private llamaServerPath: string
  private modelsDir: string
  private cancellationToken: { cancelled: boolean } = { cancelled: false }
  private isDownloading = false
  private gpuAvailable: boolean   // 缓存 GPU 检测结果，避免每 3 秒轮询时重复文件系统检查
  // ...
}
```

- [ ] **Step 2b: 构造函数中检测一次 GPU 并缓存**

在 `constructor` 末尾添加：
```typescript
this.gpuAvailable = this.detectGpu()
log(`GPU available (cached): ${this.gpuAvailable}`)
```

- [ ] **Step 3: 新增 fileExists 方法（重复下载检查）**

```typescript
private fileExists(path: string, minSize: number = 1024): boolean {
  try {
    const fs = require('fs')
    const stats = fs.statSync(path)
    return stats.size >= minSize
  } catch {
    return false
  }
}
```

- [ ] **Step 4: 新增 cancelDownload 方法**

```typescript
cancelDownload(): void {
  if (this.isDownloading) {
    this.cancellationToken.cancelled = true
    log('Download cancelled by user')
  }
}
```

- [ ] **Step 5: 重构 downloadModel 方法为三段式下载**

```typescript
async downloadModel(): Promise<void> {
  const win = BrowserWindow.getAllWindows()[0]
  if (!win) return

  this.cancellationToken = { cancelled: false }
  this.isDownloading = true

  try {
    if (!existsSync(this.modelsDir)) {
      mkdirSync(this.modelsDir, { recursive: true })
    }

    // 1. 下载 llama-server.exe
    if (this.fileExists(this.llamaServerPath, 1024)) {
      win.webContents.send('server:download-progress', {
        percent: 100, speed: '已存在', phase: 'llama-server',
        fileName: 'llama-server.exe', current: 1, total: 3
      })
    } else {
      await this.downloadFile(this.LLAMA_SERVER_URL, this.llamaServerPath, win, 'llama-server', 1)
    }

    // 2. 下载 Qwen3 模型
    if (this.fileExists(this.modelPath, 100_000_000)) {
      win.webContents.send('server:download-progress', {
        percent: 100, speed: '已存在', phase: 'model',
        fileName: 'qwen3-1.5b-q4_k_m.gguf', current: 2, total: 3
      })
    } else {
      await this.downloadFile(this.MODEL_URL, this.modelPath, win, 'model', 2)
    }

    // 3. 下载 embedding 模型
    const embeddingFileName = 'bge-small-zh-v1.5-f16.gguf'
    if (this.fileExists(this.embeddingPath, 10_000_000)) {
      win.webContents.send('server:download-progress', {
        percent: 100, speed: '已存在', phase: 'embedding',
        fileName: embeddingFileName, current: 3, total: 3
      })
    } else {
      await this.downloadFile(this.EMBEDDING_URL + embeddingFileName, this.embeddingPath, win, 'embedding', 3)
    }

    win.webContents.send('server:download-progress', {
      percent: 100, speed: 'All files ready', phase: 'done',
      fileName: '', current: 3, total: 3
    })
  } finally {
    this.isDownloading = false
  }
}
```

- [ ] **Step 6: 重构 downloadFile 支持取消和阶段**

```typescript
private async downloadFile(
  url: string,
  destPath: string,
  win: BrowserWindow,
  label: string,
  phase: 1 | 2 | 3
): Promise<void> {
  const fileName = destPath.split(/[/\\]/).pop() || ''

  return new Promise((resolve, reject) => {
    if (this.cancellationToken.cancelled) {
      reject(new Error('Download cancelled'))
      return
    }

    const mod = url.startsWith('https') ? https : http
    const file = createWriteStream(destPath)

    mod.get(url, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        mod.get(res.headers.location, (res2) => {
          this.doDownload(res2, file, win, label, phase, fileName).then(resolve).catch(reject)
        }).on('error', reject)
        return
      }
      this.doDownload(res, file, win, label, phase, fileName).then(resolve).catch(reject)
    }).on('error', reject)
  })
}
```

- [ ] **Step 7: 重构 doDownload 支持取消检查**

```typescript
private async doDownload(
  res: http.IncomingMessage,
  file: ReturnType<typeof createWriteStream>,
  win: BrowserWindow,
  label: string,
  phase: 1 | 2 | 3,
  fileName: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    let downloadedBytes = 0
    const totalBytes = parseInt(res.headers['content-length'] ?? '0', 10) || 100_000_000
    const phaseNames = { 1: 'llama-server', 2: 'model', 3: 'embedding' } as const

    res.on('data', (chunk: Buffer) => {
      if (this.cancellationToken.cancelled) {
        file.destroy()
        reject(new Error('Download cancelled'))
        return
      }
      downloadedBytes += chunk.length
      file.write(chunk)
      const percent = Math.round((downloadedBytes / totalBytes) * 100)
      win.webContents.send('server:download-progress', {
        percent, speed: this.formatSpeed(downloadedBytes, Date.now()),
        phase: phaseNames[phase], fileName, current: phase, total: 3
      })
    })

    res.on('end', () => {
      file.end()
      log(`${label} download complete`)
      resolve()
    })

    res.on('error', (err) => {
      file.destroy()
      reject(err)
    })
  })
}
```

- [ ] **Step 8: getStatus 返回缓存的 gpuAvailable**

```typescript
getStatus(): ServerStatus {
  if (!this.process) {
    return { state: 'idle', message: 'Server not running', gpuAvailable: this.gpuAvailable }
  }
  return { state: 'running', message: `llama-server running on port ${this.port}`, gpuAvailable: this.gpuAvailable }
}
```

> 注意：`gpuAvailable` 使用构造函数中缓存的值，避免每次 `getStatus()` 调用时重复文件系统检查。

- [ ] **Step 9: Commit**

```bash
git add src/main/serverManager.ts
git commit -m "feat(server): add embedding download, cancellation, and 3-phase progress"
```

---

## Task 2: index.ts IPC handler

**Modify:** `src/main/index.ts`

- [ ] **Step 1: 新增 cancel-download handler（在 registerIpcHandlers 中）**

```typescript
ipcMain.handle('server:cancel-download', () => {
  serverManager.cancelDownload()
})
```

- [ ] **Step 2: Commit**

```bash
git add src/main/index.ts
git commit -m "feat(ipc): add server:cancel-download handler"
```

---

## Task 3: preload/index.ts API

**Modify:** `src/preload/index.ts`

- [ ] **Step 1: 新增 cancelDownload API**

```typescript
server: {
  // ... existing
  cancelDownload: () => ipcRenderer.invoke('server:cancel-download'),
}
```

- [ ] **Step 2: Commit**

```bash
git add src/preload/index.ts
git commit -m "feat(preload): expose cancelDownload API"
```

---

## Task 4: Settings.vue UI 增强

**Modify:** `src/renderer/src/views/Settings.vue`

- [ ] **Step 1: 更新 script setup - 新增状态和取消逻辑**

```typescript
<script setup lang="ts">
import { onMounted, ref, onUnmounted, computed } from 'vue'

const serverStatus = ref<'idle' | 'starting' | 'running' | 'error'>('idle')
const statusMessage = ref('')
const gpuAvailable = ref(false)
const downloadProgress = ref({ percent: 0, speed: '', phase: '', fileName: '', current: 0, total: 3 })
const isDownloading = ref(false)
const errorMessage = ref('')
const showError = ref(false)
let statusPollInterval: ReturnType<typeof setInterval> | null = null

onMounted(async () => {
  await checkServerStatus()
  startStatusPoll()
})

onUnmounted(() => {
  stopStatusPoll()
})

function startStatusPoll() {
  statusPollInterval = setInterval(checkServerStatus, 3000)
}

function stopStatusPoll() {
  if (statusPollInterval) {
    clearInterval(statusPollInterval)
    statusPollInterval = null
  }
}

async function checkServerStatus() {
  const status = await window.api.server.status()
  serverStatus.value = status.state === 'running' ? 'running' : (status.state === 'error' ? 'error' : 'idle')
  statusMessage.value = status.message
  gpuAvailable.value = status.gpuAvailable ?? false
}

async function startServer() {
  clearError()
  serverStatus.value = 'starting'
  statusMessage.value = '正在启动模型服务...'
  try {
    await window.api.server.start()
    await checkServerStatus()
  } catch (e) {
    showErrorMsg(String(e))
    serverStatus.value = 'error'
  }
}

async function stopServer() {
  clearError()
  await window.api.server.stop()
  await checkServerStatus()
}

async function downloadModel() {
  clearError()
  isDownloading.value = true
  downloadProgress.value = { percent: 0, speed: '', phase: 'llama-server', fileName: 'llama-server.exe', current: 1, total: 3 }
  statusMessage.value = '正在下载模型...'

  window.api.server.onDownloadProgress((progress) => {
    downloadProgress.value = progress
    if (progress.phase === 'done') {
      statusMessage.value = '所有文件已就绪'
      isDownloading.value = false
    } else {
      statusMessage.value = `下载中: ${progress.fileName} - ${progress.percent}%`
    }
  })

  try {
    await window.api.server.downloadModel()
  } catch (e) {
    if (String(e).includes('cancelled')) {
      statusMessage.value = '下载已取消'
    } else {
      showErrorMsg(String(e))
    }
    isDownloading.value = false
  }
}

async function cancelDownload() {
  await window.api.server.cancelDownload()
  isDownloading.value = false
  statusMessage.value = '下载已取消'
}

function showErrorMsg(msg: string) {
  errorMessage.value = msg
  showError.value = true
}

function clearError() {
  errorMessage.value = ''
  showError.value = false
}

const canStart = computed(() => serverStatus.value === 'idle' || serverStatus.value === 'error')
const canDownload = computed(() => !isDownloading.value && serverStatus.value !== 'starting')
```

- [ ] **Step 2: 更新 template - 完整 UI**

```vue
<template>
  <div class="settings">
    <h1>设置</h1>

    <!-- 错误提示 -->
    <div v-if="showError" class="error-alert">
      <span>{{ errorMessage }}</span>
      <button class="error-close" @click="clearError">&times;</button>
    </div>

    <!-- 模型服务状态 -->
    <section class="settings-section">
      <h2>模型服务</h2>
      <div class="status-card">
        <div class="status-row">
          <span class="label">状态:</span>
          <span class="status-badge" :class="serverStatus">{{ getStatusLabel() }}</span>
          <span class="gpu-badge" :class="gpuAvailable ? 'gpu-ok' : 'gpu-none'">
            GPU: {{ gpuAvailable ? '可用' : '不可用' }}
          </span>
        </div>
        <div class="status-row">
          <span class="label">信息:</span>
          <span class="value">{{ statusMessage }}</span>
        </div>
        <div class="actions">
          <button
            v-if="serverStatus === 'running'"
            class="btn btn-danger"
            @click="stopServer"
          >
            停止服务
          </button>
          <button
            v-else
            class="btn btn-primary"
            :disabled="serverStatus === 'starting'"
            @click="startServer"
          >
            启动服务
          </button>
        </div>
      </div>
    </section>

    <!-- 模型下载 -->
    <section class="settings-section">
      <h2>模型下载</h2>
      <div class="status-card">
        <div v-if="isDownloading" class="download-active">
          <div class="download-file">
            正在下载: <strong>{{ downloadProgress.fileName }}</strong>
          </div>
          <div class="progress-bar">
            <div class="progress-fill" :style="{ width: downloadProgress.percent + '%' }"></div>
          </div>
          <div class="download-meta">
            <span>{{ downloadProgress.percent }}%</span>
            <span>{{ downloadProgress.speed }}</span>
            <span>阶段 {{ downloadProgress.current }}/{{ downloadProgress.total }}</span>
          </div>
          <div class="actions">
            <button class="btn btn-warning" @click="cancelDownload">取消下载</button>
          </div>
        </div>
        <div v-else class="download-idle">
          <div class="actions">
            <button
              class="btn btn-secondary"
              :disabled="serverStatus === 'starting'"
              @click="downloadModel"
            >
              下载模型
            </button>
          </div>
        </div>
      </div>
    </section>

    <!-- 文档统计 -->
    <section class="settings-section">
      <h2>文档统计</h2>
      <div class="status-card">
        <div class="status-row">
          <span class="label">已导入文档:</span>
          <span class="value">{{ documentStore.documents.length }} 个</span>
        </div>
      </div>
    </section>

    <!-- 模型信息 -->
    <section class="settings-section">
      <h2>模型信息</h2>
      <div class="status-card">
        <div class="status-row">
          <span class="label">对话模型:</span>
          <span class="value">Qwen3-1.5B-GGUF (Q4 量化)</span>
        </div>
        <div class="status-row">
          <span class="label">Embedding:</span>
          <span class="value">bge-small-zh-v1.5</span>
        </div>
      </div>
    </section>
  </div>
</template>
```

- [ ] **Step 3: 更新 style - 新增错误提示和下载样式**

```css
<style scoped>
/* 新增错误提示 */
.error-alert {
  background: #fee2e2;
  border: 1px solid #fecaca;
  color: #dc2626;
  padding: 12px 16px;
  border-radius: 8px;
  margin-bottom: 20px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.error-close {
  background: none;
  border: none;
  font-size: 20px;
  color: #dc2626;
  cursor: pointer;
  padding: 0 4px;
}

/* 新增 GPU 徽章 */
.gpu-badge {
  font-size: 12px;
  padding: 2px 8px;
  border-radius: 4px;
  margin-left: auto;
}
.gpu-badge.gpu-ok {
  background: #d1fae5;
  color: #059669;
}
.gpu-badge.gpu-none {
  background: #f3f4f6;
  color: #6b7280;
}

/* 新增下载样式 */
.download-file {
  font-size: 14px;
  color: #374151;
  margin-bottom: 8px;
}
.download-meta {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: #6b7280;
  margin-top: 4px;
}

/* 按钮变体 */
.btn-danger {
  background: #dc2626;
  color: white;
}
.btn-danger:hover:not(:disabled) {
  background: #b91c1c;
}
.btn-warning {
  background: #f59e0b;
  color: white;
}
.btn-warning:hover:not(:disabled) {
  background: #d97706;
}
</style>
```

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/views/Settings.vue
git commit -m "feat(ui): enhance Settings with 3-phase download, stop button, and error handling"
```

---

## 验证清单

- [ ] 类型检查通过：`npm run typecheck`
- [ ] 下载 llama-server 时 phase='llama-server'
- [ ] 下载 model 时 phase='model'
- [ ] 下载 embedding 时 phase='embedding'
- [ ] 下载完成后 phase='done'
- [ ] 点击取消后下载停止
- [ ] 已存在文件跳过下载（speed='已存在'）
- [ ] 服务运行时有"停止服务"红色按钮
- [ ] 服务停止后按钮变回"启动服务"
- [ ] 状态每 3 秒自动刷新
- [ ] 下载出错显示红色错误提示
- [ ] 错误提示可关闭
- [ ] GPU 状态正确显示
