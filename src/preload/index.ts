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
import IpcRendererEvent = Electron.IpcRendererEvent;

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
        /** 获取对话服务 URL */
        getServerUrl: () => ipcRenderer.invoke('server:get-url'),
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
        }) => void) => {
            ipcRenderer.on('server:download-progress', (_event, progress) => callback(progress))
            return () => ipcRenderer.removeAllListeners('server:download-progress')
        },
        /** 监听服务状态变化（事件驱动） */
        onStatusChange: (callback: (status: { chatRunning: boolean; embeddingRunning: boolean; gpuAvailable: boolean; modelMode: 'local' | 'online'; error?: string }) => void) => {
            ipcRenderer.on('server:status-changed', (_event, status) => callback(status))
            return () => ipcRenderer.removeAllListeners('server:status-changed')
        }
    },

    // -------- Embedding 服务管理 --------
    embedding: {
        /** 获取 Embedding 服务状态 */
        status: () => ipcRenderer.invoke('embedding:status'),
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
        delete: (docId: string) => ipcRenderer.invoke('document:delete', docId),
        /** 监听导入进度（流式事件） */
        onImportProgress: (callback: (progress: {
            phase: 'parsing' | 'vectorizing' | 'done' | 'idle'
            fileName: string
            fileIndex: number
            fileTotal: number
            chunkIndex: number
            chunkTotal: number
            percent: number
        }) => void) => {
            ipcRenderer.on('document:import-progress', (_event, progress) => callback(progress))
            return () => ipcRenderer.removeAllListeners('document:import-progress')
        }
    },

    // -------- RAG 问答 --------
    rag: {
        /** 非流式查询 */
        query: (question: string) => ipcRenderer.invoke('rag:query', question),
        /** 流式查询：返回 prompt 和 citations */
        queryStream: (question: string) => ipcRenderer.invoke('rag:query-stream', question),
        systemTemplate: () => ipcRenderer.invoke('rag:system-template'),
        /** 监听流式响应结束 */
        onEnd: (callback: () => void) => ipcRenderer.once('rag:end', () => callback()),
        /** 监听流式响应错误 */
        onError: (callback: (error: string) => void) =>
            ipcRenderer.on('rag:error', (_event, error) => callback(error))
    },

    // -------- 在线模式 RAG 问答 --------
    online: {
        /** 在线模式流式聊天：返回 prompt 和 citations */
        chatStream: (question: string) => ipcRenderer.invoke('online:chat-stream', question)
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
        setModelsDir: (dir: string) => ipcRenderer.invoke('config:set-models-dir', dir),
        /** 获取模型模式 */
        getModelMode: () => ipcRenderer.invoke('config:get-model-mode'),
        /** 设置模型模式 */
        setModelMode: (mode: 'local' | 'online') => ipcRenderer.invoke('config:set-model-mode', mode),
        /** 获取在线 API 配置 */
        getOnlineApi: () => ipcRenderer.invoke('config:get-online-api'),
        /** 设置在线 API 配置 */
        setOnlineApi: (apiConfig: { url: string; key: string; model: string }) =>
            ipcRenderer.invoke('config:set-online-api', apiConfig)
    },

    // -------- 全局错误提示 --------
    onGlobalError: (callback: any) => {
        // 先移除之前的监听器，防止多次触发重复弹窗
        ipcRenderer.removeAllListeners('global:error');
        ipcRenderer.on('global:error', (_event: IpcRendererEvent, message: string) => callback(message));
        // 返回取消订阅函数
        return () => {
            ipcRenderer.removeAllListeners('global:error');
        }
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
