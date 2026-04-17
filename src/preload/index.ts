/**
 * Preload 脚本 - 上下文桥接
 *
 * 作用：
 * 在渲染进程（Vue）和主进程（Node.js）之间建立安全的通信桥梁
 *
 * 安全机制：
 * - 使用 contextBridge 暴露 API，避免直接暴露 Node.js 环境
 * - 渲染进程通过 window.api 调用主进程功能
 * - 启用 contextIsolation，隔离渲染进程和 Node.js 环境
 */

import {contextBridge, ipcRenderer} from 'electron'
import {electronAPI} from '@electron-toolkit/preload'

// ============================================
// API 定义 - 暴露给渲染进程
// ============================================
const api = {
    // -------- llama-server 服务管理 --------
    server: {
        /** 获取服务状态 */
        status: () => ipcRenderer.invoke('server:status'),
        /** 启动 llama-server */
        start: () => ipcRenderer.invoke('server:start'),
        /** 停止 llama-server */
        stop: () => ipcRenderer.invoke('server:stop'),
        /** 下载模型文件 */
        downloadModel: () => ipcRenderer.invoke('server:download-model'),
        /** 取消下载 */
        cancelDownload: () => ipcRenderer.invoke('server:cancel-download'),
        /** 监听下载进度（流式事件） */
        onDownloadProgress: (callback: (progress: {
            percent: number
            speed: string
            phase: 'model' | 'embedding' | 'done'
            fileName: string
            current: number
            total: number
        }) => void) =>
            ipcRenderer.on('server:download-progress', (_event, progress) => callback(progress))
    },

    // -------- 文档管理 --------
    document: {
        /** 导入单个文档 */
        import: (filePath: string) => ipcRenderer.invoke('document:import', filePath),
        /** 批量导入文档 */
        importBatch: (filePaths: string[]) => ipcRenderer.invoke('document:import-batch', filePaths),
        /** 获取文档列表 */
        list: () => ipcRenderer.invoke('document:list'),
        /** 删除文档 */
        delete: (docId: string) => ipcRenderer.invoke('document:delete', docId)
    },

    // -------- RAG 问答 --------
    rag: {
        /** 非流式查询 */
        query: (question: string) => ipcRenderer.invoke('rag:query', question),
        /** 流式查询：返回 prompt 和 citations */
        queryStream: (question: string) => ipcRenderer.invoke('rag:query-stream', question),
        systemTemplate: () => ipcRenderer.invoke('rag:system-template'),
        /** 监听流式响应片段（已弃用，使用 fetch-event-source） */
        onChunk: (callback: (chunk: string) => void) =>
            ipcRenderer.on('rag:chunk', (_event, chunk) => callback(chunk)),
        /** 监听流式响应结束 */
        onEnd: (callback: () => void) => ipcRenderer.once('rag:end', () => callback()),
        /** 监听流式响应错误 */
        onError: (callback: (error: string) => void) =>
            ipcRenderer.on('rag:error', (_event, error) => callback(error))
    },

    // -------- 文件对话框 --------
    dialog: {
        /** 打开文件选择对话框 */
        openFile: () => ipcRenderer.invoke('dialog:open-file'),
        /** 选择目录对话框 */
        selectDirectory: () => ipcRenderer.invoke('dialog:select-directory')
    },

    // -------- 配置管理 --------
    config: {
        /** 获取模型目录路径 */
        getModelsDir: () => ipcRenderer.invoke('config:get-models-dir'),
        /** 设置模型目录路径 */
        setModelsDir: (dir: string) => ipcRenderer.invoke('config:set-models-dir', dir)
    }
}

// ============================================
// 上下文桥接
// ============================================
if (process.contextIsolated) {
    // 隔离上下文模式下，使用 contextBridge 暴露 API
    try {
        contextBridge.exposeInMainWorld('electron', electronAPI)
        contextBridge.exposeInMainWorld('api', api)
    } catch (error) {
        console.error('暴露 API 失败:', error)
    }
} else {
    // 非隔离模式下（兼容性考虑）
    // @ts-ignore
    window.electron = electronAPI
    // @ts-ignore
    window.api = api
}
