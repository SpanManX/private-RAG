import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// 自定义 API（暴露给渲染进程）
const api = {
  // llama-server 管理
  server: {
    status: () => ipcRenderer.invoke('server:status'),
    start: () => ipcRenderer.invoke('server:start'),
    stop: () => ipcRenderer.invoke('server:stop'),
    downloadModel: () => ipcRenderer.invoke('server:download-model'),
    cancelDownload: () => ipcRenderer.invoke('server:cancel-download'),
    onDownloadProgress: (callback: (progress: { percent: number; speed: string }) => void) =>
      ipcRenderer.on('server:download-progress', (_event, progress) => callback(progress))
  },

  // 文档管理
  document: {
    import: (filePath: string) => ipcRenderer.invoke('document:import', filePath),
    importBatch: (filePaths: string[]) => ipcRenderer.invoke('document:import-batch', filePaths),
    list: () => ipcRenderer.invoke('document:list'),
    delete: (docId: string) => ipcRenderer.invoke('document:delete', docId)
  },

  // RAG 问答
  rag: {
    query: (question: string) => ipcRenderer.invoke('rag:query', question),
    queryStream: (question: string) => {
      ipcRenderer.invoke('rag:query-stream', question)
    },
    onChunk: (callback: (chunk: string) => void) =>
      ipcRenderer.on('rag:chunk', (_event, chunk) => callback(chunk)),
    onEnd: (callback: () => void) => ipcRenderer.once('rag:end', () => callback()),
    onError: (callback: (error: string) => void) =>
      ipcRenderer.on('rag:error', (_event, error) => callback(error))
  },

  // 文件对话框
  dialog: {
    openFile: () => ipcRenderer.invoke('dialog:open-file')
  }
}

// 使用 contextBridge 暴露 API
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error('Failed to expose API:', error)
  }
} else {
  // @ts-ignore
  window.electron = electronAPI
  // @ts-ignore
  window.api = api
}
