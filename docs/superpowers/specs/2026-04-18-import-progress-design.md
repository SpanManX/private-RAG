# 文档导入进度展示 & 服务状态拦截

## 目标

1. 文档导入时实时展示分阶段进度（解析 → 向量化）
2. 大模型服务未启动时，拦截上传文件和发送消息操作，并给出明确提示

---

## 1. 服务状态感知

### 实现方式

在 `documentStore` 中新增 `isServerRunning` 状态，通过 IPC `server:status` 查询。启动时获取一次，之后通过 `setInterval` 每 3 秒轮询更新。

### 影响范围

| 入口 | 行为 |
|------|------|
| 发送消息 | 检查 `isServerRunning`，未启动则禁用按钮并显示提示 |
| 上传文件 | 检查 `isServerRunning`，未启动则在原地显示提示，不执行导入 |

---

## 2. 未启动服务时的拦截

### 聊天页面（ChatArea.vue）

- 发送按钮始终可点击，但点击后检测服务状态
- 若 `isServerRunning === false`：在输入框上方显示灰色提示条 "服务未启动，无法发送消息"
- 提示条在 3 秒后自动消失

### 上传组件（FileUploader.vue）

- 点击后检测服务状态
- 若 `isServerRunning === false`：在原地显示红色提示 "请先启动模型服务"，3 秒后自动消失
- 若服务正常：执行导入

---

## 3. 导入进度展示

### 进度数据结构

```typescript
interface ImportProgress {
  phase: 'parsing' | 'vectorizing' | 'done' | 'idle'
  fileName: string          // 当前处理的文件名
  fileIndex: number         // 当前文件编号（1-based）
  fileTotal: number        // 总文件数
  chunkIndex: number        // 当前处理的 chunk 编号
  chunkTotal: number        // 总 chunk 数
  percent: number           // 总体百分比 0-100
}
```

### 两阶段进度

```
阶段一：解析文档 ████████░░░░░░░░░░ 45%   ← 按文件推进
阶段二：生成向量 ░░░░░░░░░░░░░░░░░░░░ 0%   ← 按 chunk 推进
```

- **阶段一（parsing）**：文件解析（PDF/DOCX/MD/TXT → 纯文本），逐文件推进，`percent = (fileIndex / fileTotal) * 50`
- **阶段二（vectorizing）**：分块 + 逐块调用 embedding，`percent = 50 + (chunkIndex / chunkTotal) * 50`
- **完成后（done）**：显示 "导入完成，X 个文档已就绪"，2 秒后自动恢复上传区域

### UI 位置

覆盖上传区域（FileUploader.vue 内部），不干扰页面其他内容。

---

## 4. IPC 事件变更

### 主进程 → 渲染进程

新增 `document:import-progress` 事件，流式推送进度：

```typescript
// 主进程
win.webContents.send('document:import-progress', {
  phase: 'parsing',
  fileName: 'xxx.pdf',
  fileIndex: 2,
  fileTotal: 3,
  chunkIndex: 0,
  chunkTotal: 10,
  percent: 66
})
```

### preload 暴露

```typescript
document: {
  importBatch: (filePaths: string[]) => ipcRenderer.invoke('document:import-batch', filePaths),
  onImportProgress: (callback: (progress: ImportProgress) => void) =>
    ipcRenderer.on('document:import-progress', (_event, progress) => callback(progress))
}
```

---

## 5. 组件变更清单

| 文件 | 变更内容 |
|------|---------|
| `src/main/index.ts` | `document:import-batch` 改为流式推送进度事件 |
| `src/main/indexManager.ts` | `addDocument` 新增 `totalChunks` 参数支持增量进度 |
| `src/preload/index.ts` | 新增 `onImportProgress` 事件订阅 |
| `src/renderer/src/stores/documentStore.ts` | 新增 `isServerRunning`、`importProgress` 状态及轮询逻辑 |
| `src/renderer/src/components/FileUploader.vue` | 覆盖进度 UI + 服务未启动提示 |
| `src/renderer/src/components/ChatArea.vue` | 输入框上方服务状态提示条 |

---

## 6. 状态机

```
idle
  ↓ (点击上传)
server offline? ──── 是 ──→ showTip("请先启动模型服务") → idle
  ↓ 否
parsing (file 1/N)
  ↓ (所有文件解析完)
vectorizing (chunk i/M)
  ↓ (所有chunk处理完)
done ("导入完成")
  ↓ (2秒后)
idle
```
