# 文档导入进度 & 服务状态拦截 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**目标：** 在文档导入时实时展示分阶段进度（大模型未启动时拦截上传和发送操作）

**架构：**
- 主进程：`indexManager.addDocument` 拆出 chunk 统计，批量导入改为"先统计再处理"的两阶段流程，每处理完一个 chunk 推送一次 IPC 事件
- Preload：新增 `onImportProgress` 事件订阅，透传进度
- 渲染进程：documentStore 新增 `isServerRunning` 轮询 + `importProgress` 状态，FileUploader 覆盖进度 UI，ChatArea 新增提示条

**技术栈：** Electron IPC、Pinia、Vue 3

---

## 文件变更总览

| 文件 | 操作 | 职责 |
|------|------|------|
| `src/main/index.ts` | 修改 | 改造 `document:import-batch`，两阶段处理 + 推送进度 IPC 事件 |
| `src/preload/index.ts` | 修改 | 暴露 `onImportProgress` 事件订阅 |
| `src/renderer/src/stores/documentStore.ts` | 修改 | `isServerRunning` 状态 + 轮询 + `importProgress` 状态 |
| `src/renderer/src/components/FileUploader.vue` | 修改 | 覆盖进度 UI + 服务未启动提示 |
| `src/renderer/src/components/ChatArea.vue` | 修改 | 服务未启动时输入框上方提示条 |

---

## Task 1: 主进程 — 改造 `document:import-batch` 为流式进度

**Files:**
- Modify: `src/main/index.ts:136-153`

**当前代码（136-153行）：**
```typescript
ipcMain.handle('document:import-batch', async (_event, filePaths: string[]) => {
    const results: any = []
    for (const filePath of filePaths) {
        const text = await documentProcessor.parse(filePath)
        const docId = await indexManager.addDocument(filePath, text)
        results.push({filePath, success: true, docId})
    }
    return results
})
```

**实现：**

- [ ] **Step 1: 重写 `document:import-batch` 为两阶段处理**

替换为：

```typescript
ipcMain.handle('document:import-batch', async (_event, filePaths: string[]) => {
    const win = BrowserWindow.getAllWindows()[0]
    if (!win) return []

    // ===== 阶段一：解析所有文件，统计总 chunk 数 =====
    const parsedFiles: { filePath: string; text: string; chunks: string[] }[] = []
    for (let i = 0; i < filePaths.length; i++) {
        const filePath = filePaths[i]
        const text = await documentProcessor.parse(filePath)
        const chunks = indexManager.chunkText(text)  // 需要暴露 chunkText
        parsedFiles.push({ filePath, text, chunks })

        win.webContents.send('document:import-progress', {
            phase: 'parsing',
            fileName: filePath.split(/[/\\]/).pop() ?? filePath,
            fileIndex: i + 1,
            fileTotal: filePaths.length,
            chunkIndex: 0,
            chunkTotal: 0,
            percent: Math.round(((i + 1) / filePaths.length) * 50)
        })
    }

    // ===== 阶段二：向量化所有 chunk =====
    const results: any = []
    let globalChunkIndex = 0
    const totalChunks = parsedFiles.reduce((sum, f) => sum + f.chunks.length, 0)

    for (let i = 0; i < parsedFiles.length; i++) {
        const { filePath, text, chunks } = parsedFiles[i]
        // 从 indexManager 的 addDocument 中提取向量化逻辑单独调用
        const docId = await indexManager.addDocumentWithProgress(
            filePath, text, chunks,
            (chunkIdx) => {
                globalChunkIndex++
                win.webContents.send('document:import-progress', {
                    phase: 'vectorizing',
                    fileName: filePath.split(/[/\\]/).pop() ?? filePath,
                    fileIndex: i + 1,
                    fileTotal: filePaths.length,
                    chunkIndex: globalChunkIndex,
                    chunkTotal: totalChunks,
                    percent: 50 + Math.round((globalChunkIndex / totalChunks) * 50)
                })
            }
        )
        results.push({ filePath, success: true, docId })
    }

    win.webContents.send('document:import-progress', {
        phase: 'done',
        fileName: '',
        fileIndex: filePaths.length,
        fileTotal: filePaths.length,
        chunkIndex: totalChunks,
        chunkTotal: totalChunks,
        percent: 100
    })

    return results
})
```

---

## Task 2: indexManager — 暴露 `chunkText` 并新增 `addDocumentWithProgress`

**Files:**
- Modify: `src/main/indexManager.ts`

**实现：**

- [ ] **Step 1: 将 `chunkText` 方法改为 public**

`indexManager.ts:148` 附近，将 `private chunkText` 改为 `chunkText`（去掉 private），允许外部调用。

- [ ] **Step 2: 新增 `addDocumentWithProgress` 方法**

在 `addDocument` 方法之后新增：

```typescript
/**
 * 向量化文档（带进度回调）
 * @param filePath 原始文件路径
 * @param text 解析后的纯文本
 * @param chunks 预分块的文本数组
 * @param onChunkProgress 每处理完一个 chunk 调用的回调，参数为 chunk 索引
 * @returns 生成的文档 ID
 */
async addDocumentWithProgress(
    filePath: string,
    text: string,
    chunks: string[],
    onChunkProgress: (chunkIndex: number) => void
): Promise<string> {
    const docId = randomUUID()
    const fileName = filePath.split(/[/\\]/).pop() ?? filePath

    type ChunkRecord = {
        id: string
        docId: string
        fileName: string
        chunkIndex: number
        chunkText: string
        vector: number[]
    }
    const records: ChunkRecord[] = []

    for (let i = 0; i < chunks.length; i++) {
        const chunkText = chunks[i]
        let embedding: number[]
        try {
            embedding = await this.embeddings.embedQuery(chunkText)
        } catch (err) {
            log(`Embedding 错误: ${err}，使用零向量`)
            embedding = Array(EMBEDDING_DIM).fill(0)
        }

        records.push({
            id: randomUUID(),
            docId,
            fileName,
            chunkIndex: i,
            chunkText,
            vector: embedding
        })

        onChunkProgress(i)
    }

    await this.table.add(records)

    this.docs.set(docId, {
        id: docId,
        fileName,
        createdAt: Date.now(),
        textLength: text.length
    })

    log(`文档已索引: ${fileName}, ${chunks.length} 个块`)
    return docId
}
```

---

## Task 3: Preload — 暴露 `onImportProgress` 事件

**Files:**
- Modify: `src/preload/index.ts`

**实现：**

- [ ] **Step 1: 在 `document` API 中新增 `onImportProgress`**

在 `src/preload/index.ts:44-53` 的 `document` 对象中，新增：

```typescript
/** 监听导入进度（流式事件） */
onImportProgress: (callback: (progress: {
    phase: 'parsing' | 'vectorizing' | 'done' | 'idle'
    fileName: string
    fileIndex: number
    fileTotal: number
    chunkIndex: number
    chunkTotal: number
    percent: number
}) => void) =>
    ipcRenderer.on('document:import-progress', (_event, progress) => callback(progress))
```

完整替换为：

```typescript
document: {
    import: (filePath: string) => ipcRenderer.invoke('document:import', filePath),
    importBatch: (filePaths: string[]) => ipcRenderer.invoke('document:import-batch', filePaths),
    list: () => ipcRenderer.invoke('document:list'),
    delete: (docId: string) => ipcRenderer.invoke('document:delete', docId),
    onImportProgress: (callback: (progress: {
        phase: 'parsing' | 'vectorizing' | 'done' | 'idle'
        fileName: string
        fileIndex: number
        fileTotal: number
        chunkIndex: number
        chunkTotal: number
        percent: number
    }) => void) =>
        ipcRenderer.on('document:import-progress', (_event, progress) => callback(progress))
},
```

---

## Task 4: documentStore — 新增 `isServerRunning` + `importProgress` 状态

**Files:**
- Modify: `src/renderer/src/stores/documentStore.ts`

**实现：**

- [ ] **Step 1: 新增 `ImportProgress` 接口和状态**

在 `documentStore.ts` 文件顶部（`DocumentRecord` 接口之后）添加：

```typescript
export interface ImportProgress {
    phase: 'parsing' | 'vectorizing' | 'done' | 'idle'
    fileName: string
    fileIndex: number
    fileTotal: number
    chunkIndex: number
    chunkTotal: number
    percent: number
}
```

- [ ] **Step 2: 新增状态和轮询逻辑**

在 `documents` 状态之后新增：

```typescript
/** 服务是否运行中 */
const isServerRunning = ref(false)

/** 导入进度 */
const importProgress = ref<ImportProgress>({
    phase: 'idle',
    fileName: '',
    fileIndex: 0,
    fileTotal: 0,
    chunkIndex: 0,
    chunkTotal: 0,
    percent: 0
})

let serverPollInterval: ReturnType<typeof setInterval> | null = null

async function fetchServerStatus(): Promise<void> {
    const status = await window.api.server.status()
    isServerRunning.value = status.state === 'running'
}

function startServerPoll(): void {
    fetchServerStatus()
    serverPollInterval = setInterval(fetchServerStatus, 3000)
}

function stopServerPoll(): void {
    if (serverPollInterval) {
        clearInterval(serverPollInterval)
        serverPollInterval = null
    }
}
```

- [ ] **Step 3: 在 `importBatch` 中订阅进度事件**

```typescript
async function importBatch(filePaths: string[]): Promise<void> {
    isImporting.value = true
    importProgress.value = {
        phase: 'parsing',
        fileName: '',
        fileIndex: 0,
        fileTotal: filePaths.length,
        chunkIndex: 0,
        chunkTotal: 0,
        percent: 0
    }

    window.api.document.onImportProgress((progress) => {
        importProgress.value = progress
        if (progress.phase === 'done') {
            isImporting.value = false
            // 2秒后恢复idle
            setTimeout(() => {
                importProgress.value = {
                    phase: 'idle', fileName: '', fileIndex: 0,
                    fileTotal: 0, chunkIndex: 0, chunkTotal: 0, percent: 0
                }
            }, 2000)
        }
    })

    const results = await window.api.document.importBatch(filePaths)
    console.log('importBatch 结果:', results)
    await refreshDocuments()
    if (results[0]?.phase !== 'done') {
        isImporting.value = false
    }
}
```

- [ ] **Step 4: 导出新状态**

在 return 语句中新增导出：

```typescript
return {
    documents,
    isImporting,
    isServerRunning,
    importProgress,
    startServerPoll,
    stopServerPoll,
    refreshDocuments,
    importFile,
    importBatch,
    deleteDocument
}
```

---

## Task 5: FileUploader — 覆盖进度 UI + 服务未启动提示

**Files:**
- Modify: `src/renderer/src/components/FileUploader.vue`

**实现：**

- [ ] **Step 1: 注入 store 并订阅轮询**

```typescript
const documentStore = useDocumentStore()

onMounted(() => {
    documentStore.startServerPoll()
})

onUnmounted(() => {
    documentStore.stopServerPoll()
})
```

- [ ] **Step 2: 点击时检查服务状态，未启动显示提示**

```typescript
async function handleFileDialog(): Promise<void> {
    if (!documentStore.isServerRunning) {
        serverOfflineTip.value = true
        setTimeout(() => { serverOfflineTip.value = false }, 3000)
        return
    }
    const filePaths = await window.api.dialog.openFile()
    if (filePaths.length > 0) {
        await documentStore.importBatch(filePaths)
        emit('imported')
    }
}
```

- [ ] **Step 3: 模板改造**

```vue
<template>
  <!-- 进度显示状态 -->
  <div v-if="documentStore.importProgress.phase !== 'idle'" class="file-uploader progress-panel">
    <div class="progress-phase1">
      <span class="phase-label">阶段一：解析文档</span>
      <div class="progress-bar">
        <div class="progress-fill" :style="{ width: Math.min(documentStore.importProgress.percent, 50) + '%' }"></div>
      </div>
      <span class="phase-percent">{{ Math.min(documentStore.importProgress.percent, 50) }}%</span>
    </div>
    <div class="progress-phase2" v-if="documentStore.importProgress.phase === 'vectorizing' || documentStore.importProgress.phase === 'done'">
      <span class="phase-label">阶段二：生成向量</span>
      <div class="progress-bar">
        <div class="progress-fill progress-fill-green" :style="{ width: Math.max(0, documentStore.importProgress.percent - 50) + '%' }"></div>
      </div>
      <span class="phase-percent">{{ Math.max(0, documentStore.importProgress.percent - 50) }}%</span>
    </div>
    <div class="progress-done" v-if="documentStore.importProgress.phase === 'done'">
      导入完成，{{ documentStore.importProgress.fileTotal }} 个文档已就绪
    </div>
    <div class="progress-file" v-else>
      {{ documentStore.importProgress.fileName }} ({{ documentStore.importProgress.fileIndex }}/{{ documentStore.importProgress.fileTotal }})
    </div>
  </div>

  <!-- 服务未启动提示 -->
  <div v-else-if="serverOfflineTip" class="file-uploader offline-tip" @click="serverOfflineTip = false">
    <span>请先启动模型服务</span>
  </div>

  <!-- 默认上传区域 -->
  <div
    v-else
    class="file-uploader"
    :class="{ dragging: isDragging }"
    @click="handleFileDialog"
    @dragover.prevent="isDragging = true"
    @dragleave="isDragging = false"
    @drop.prevent="handleDrop"
  >
    <slot>
      <div class="upload-content">
        <span class="upload-icon">+</span>
        <span class="upload-text">导入文档</span>
      </div>
    </slot>
  </div>
</template>
```

- [ ] **Step 4: 新增样式**

```css
/* 进度面板 */
.progress-panel {
  flex-direction: column;
  align-items: stretch;
  gap: 8px;
  padding: 16px;
}

.progress-phase1, .progress-phase2 {
  display: flex;
  align-items: center;
  gap: 8px;
}

.phase-label {
  font-size: 12px;
  color: #6b7280;
  min-width: 100px;
}

.progress-bar {
  flex: 1;
  height: 6px;
  background: #e5e7eb;
  border-radius: 3px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: #3b82f6;
  transition: width 0.3s ease;
  border-radius: 3px;
}

.progress-fill-green {
  background: #10b981;
}

.phase-percent {
  font-size: 12px;
  color: #374151;
  min-width: 32px;
  text-align: right;
}

.progress-file {
  font-size: 12px;
  color: #9ca3af;
  text-align: center;
}

.progress-done {
  font-size: 13px;
  color: #059669;
  text-align: center;
  font-weight: 500;
}

/* 服务未启动提示 */
.offline-tip {
  border-color: #fca5a5;
  background: #fef2f2;
  color: #dc2626;
  font-size: 13px;
  cursor: pointer;
}
```

---

## Task 6: ChatArea — 输入框上方服务状态提示条

**Files:**
- Modify: `src/renderer/src/components/ChatArea.vue`

**实现：**

- [ ] **Step 1: 注入 store 并订阅轮询**

```typescript
import { useChatStore } from '@/stores/chatStore'
import { useDocumentStore } from '@/stores/documentStore'

const chatStore = useChatStore()
const documentStore = useDocumentStore()
const showOfflineTip = ref(false)

onMounted(() => {
    documentStore.startServerPoll()
})

onUnmounted(() => {
    documentStore.stopServerPoll()
})
```

- [ ] **Step 2: 发送时检查服务状态**

```typescript
async function handleSend(): Promise<void> {
    const text = inputText.value.trim()
    if (!text || chatStore.isGenerating) return

    if (!documentStore.isServerRunning) {
        showOfflineTip.value = true
        setTimeout(() => { showOfflineTip.value = false }, 3000)
        return
    }

    inputText.value = ''
    await chatStore.sendMessage(text)
    await nextTick()
    scrollToBottom()
}
```

- [ ] **Step 3: 模板中新增提示条**

在 `<div class="input-area">` 之前添加：

```vue
<div v-if="showOfflineTip" class="offline-tip-bar">
    服务未启动，无法发送消息
</div>
```

- [ ] **Step 4: 新增样式**

```css
.offline-tip-bar {
    padding: 8px 20px;
    background: #f3f4f6;
    color: #6b7280;
    font-size: 13px;
    text-align: center;
    border-bottom: 1px solid #e5e7eb;
}
```

---

## Task 7: 验证构建

- [ ] **Step 1: 运行类型检查**

```bash
npm run typecheck
```

- [ ] **Step 2: 本地运行测试**

```bash
npm run dev
```

测试项：
1. 未启动服务时上传文件 → 显示红色提示
2. 未启动服务时发送消息 → 显示灰色提示条
3. 启动服务后上传文档 → 显示两阶段进度条 → 完成后自动恢复
4. 进度百分比随 chunk 处理实时更新

- [ ] **Step 3: 提交**

```bash
git add -A
git commit -m "feat: 文档导入进度展示 & 大模型服务状态拦截"
```
