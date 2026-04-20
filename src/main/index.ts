/**
 * RAG 知识库 - Electron 主进程入口
 *
 * 负责：
 * 1. 初始化 Electron 应用和浏览器窗口
 * 2. 管理全局模块单例（ServerManager、DocumentProcessor、IndexManager、RagEngine）
 * 3. 注册 IPC 处理器，连接主进程和渲染进程
 */

import {app, shell, BrowserWindow, ipcMain, dialog} from 'electron'
import {join} from 'path'
import {electronApp, optimizer, is} from '@electron-toolkit/utils'
import {initLogger, log} from './logger'
import {ServerManager} from './serverManager'
import {DocumentProcessor} from './documentProcessor'
import {IndexManager} from './indexManager'
import {RagEngine} from './ragEngine'

// ============================================
// 全局模块单例
// ============================================
let serverManager: ServerManager
let documentProcessor: DocumentProcessor
let indexManager: IndexManager
let ragEngine: RagEngine

/**
 * 创建浏览器窗口
 * - 窗口尺寸：1200x800，最小 900x600
 * - 启用 contextIsolation 保护安全
 * - preload 脚本用于 IPC 通信
 */
function createWindow(): void {
    const mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        minWidth: 900,
        minHeight: 600,
        show: false,           // 初始隐藏，等待 ready-to-show 再显示
        frame: true,           // 使用系统原生窗口边框
        autoHideMenuBar: false,
        webPreferences: {
            preload: join(__dirname, '../preload/index.js'),
            sandbox: false,
            contextIsolation: true,   // 隔离上下文，防止 XSS
            nodeIntegration: false     // 禁用 Node.js 集成
        }
    })
    mainWindow.setMenu(null);
    // 窗口准备好后显示
    mainWindow.on('ready-to-show', () => {
        mainWindow.show()
        log('Window ready')
    })

    // 阻止外部链接在当前窗口打开，转为系统默认浏览器
    mainWindow.webContents.setWindowOpenHandler((details) => {
        shell.openExternal(details.url)
        return {action: 'deny'}
    })

    // 开发模式使用 Vite 开发的 URL，生产模式使用打包后的 HTML
    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
        mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
    } else {
        mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
    }
}

/**
 * 初始化所有核心模块
 * - ServerManager：管理 llama-server 子进程
 * - DocumentProcessor：解析 PDF/DOCX/MD/TXT 文档
 * - IndexManager：管理 LanceDB 向量数据库
 * - RagEngine：编排 RAG 问答流程
 */
async function initializeModules(): Promise<void> {
    const userDataPath = app.getPath('userData')
    serverManager = new ServerManager()
    documentProcessor = new DocumentProcessor()
    indexManager = new IndexManager(userDataPath)
    ragEngine = new RagEngine(indexManager)
    await indexManager.initialize()  // 初始化 LanceDB 连接
    await serverManager.refreshPaths()
    log('Modules initialized')
}

/**
 * 注册 IPC 处理器
 *
 * IPC 通信允许渲染进程（Vue）调用主进程功能：
 * - server:* - llama-server 服务管理
 * - document:* - 文档导入/删除/列表
 * - rag:* - RAG 问答
 * - dialog:* - 文件对话框
 * - config:* - 配置管理
 */
function registerIpcHandlers(): void {
    // -------- llama-server 服务管理 --------
    ipcMain.handle('server:status', () => serverManager.getStatus())
    ipcMain.handle('embedding:status', () => serverManager.embeddingManager.getStatus())
    ipcMain.handle('server:start', async () => {
        // 仅在用户点击“启动服务”时启动两个服务
        await serverManager.start()
        await serverManager.embeddingManager.start()
        return serverManager.getStatus()
    })
    ipcMain.handle('server:stop', async () => {
        // 停止顺序：先 chat 服务，再 embedding 服务
        await serverManager.stop()
        await serverManager.embeddingManager.stop()
        return serverManager.getStatus()
    })
    ipcMain.handle('server:download-model', () => serverManager.downloadModel())
    ipcMain.handle('server:cancel-download', () => serverManager.cancelDownload())

    // -------- 配置管理 --------
    ipcMain.handle('config:get-models-dir', () => serverManager.getModelsDir())
    ipcMain.handle('config:set-models-dir', (_event, dir: string) => {
        serverManager.updateModelsDir(dir)
        return {success: true}
    })

    // -------- 目录选择对话框 --------
    ipcMain.handle('dialog:select-directory', async () => {
        const result = await dialog.showOpenDialog({
            properties: ['openDirectory']
        })
        return result.filePaths[0] || null
    })

    // -------- 文档导入 --------
    // 导入单个文档：解析 → 分块 → 向量化 → 存储
    ipcMain.handle('document:import', async (_event, filePath: string) => {
        try {
            if (serverManager.embeddingManager.getStatus().state !== 'running') {
                return {success: false, error: 'Embedding service is not running. Please click "启动服务" first.'}
            }
            const text = await documentProcessor.parse(filePath)
            console.log(text, '单文件')
            const docId = await indexManager.addDocument(filePath, text)
            return {success: true, docId, textLength: text.length}
        } catch (error) {
            log('Document import error:', error)
            return {success: false, error: String(error)}
        }
    })

    // 批量导入文档（带流式进度）
    ipcMain.handle('document:import-batch', async (_event, filePaths: string[]) => {
        const win = BrowserWindow.getAllWindows()[0]
        if (!win) return []
        if (serverManager.embeddingManager.getStatus().state !== 'running') {
            win.webContents.send('document:import-progress', {
                phase: 'done',
                fileName: '',
                fileIndex: 0,
                fileTotal: filePaths.length,
                chunkIndex: 0,
                chunkTotal: 0,
                percent: 100
            })
            return filePaths.map((filePath) => ({
                filePath,
                success: false,
                error: 'Embedding service is not running. Please click "启动服务" first.'
            }))
        }

        try {
            // ===== 阶段一：解析所有文件，统计总 chunk 数 =====
            const parsedFiles: { filePath: string; text: string; chunks: string[] }[] = []
            for (let i = 0; i < filePaths.length; i++) {
                const filePath = filePaths[i]
                const text = await documentProcessor.parse(filePath)
                const chunks = indexManager.chunkText(text)
                parsedFiles.push({filePath, text, chunks})

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
                const {filePath, text, chunks} = parsedFiles[i]
                const docId = await indexManager.addDocumentWithProgress(
                    filePath, text, chunks,
                    () => {
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
                results.push({filePath, success: true, docId})
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
        } catch (error) {
            log('Document batch import error:', error)
            win.webContents.send('document:import-progress', {
                phase: 'done',
                fileName: '',
                fileIndex: filePaths.length,
                fileTotal: filePaths.length,
                chunkIndex: 0,
                chunkTotal: 0,
                percent: 100
            })
            return filePaths.map((filePath) => ({
                filePath,
                success: false,
                error: String(error)
            }))
        }
    })


    // 文档列表和删除
    ipcMain.handle('document:list', () => indexManager.listDocuments())
    ipcMain.handle('document:delete', (_event, docId: string) =>
        indexManager.deleteDocument(docId)
    )

    // -------- RAG 问答 --------
    // 非流式查询：搜索 → 构建 prompt → 调用 llama-server → 返回结果
    // ipcMain.handle('rag:query', async (_event, question: string) => {
    //     try {
    //         return await ragEngine.query(question)
    //     } catch (error) {
    //         log('RAG query error:', error)
    //         return {success: false, error: String(error)}
    //     }
    // })

    // 流式查询：返回 prompt 和引用，让前端使用 fetch-event-source 调用 llama-server
    ipcMain.handle('rag:query-stream', async (_event, question: string) => {
        try {
            if (serverManager.getStatus().state !== 'running') {
                return {success: false, error: 'Model service is not running. Please click "启动服务" first.'}
            }
            if (serverManager.embeddingManager.getStatus().state !== 'running') {
                return {success: false, error: 'Embedding service is not running. Please click "启动服务" first.'}
            }
            const {prompt, citations} = await ragEngine.buildPrompt(question)
            return {success: true, prompt, citations}
        } catch (error) {
            log('RAG query error:', error)
            return {success: false, error: String(error)}
        }
    })

    ipcMain.handle('rag:system-template', () => ragEngine.systemTemplate)

    // -------- 文件选择对话框 --------
    ipcMain.handle('dialog:open-file', async () => {
        const result = await dialog.showOpenDialog({
            properties: ['openFile', 'multiSelections'],
            filters: [{name: 'Documents', extensions: ['pdf', 'docx', 'md', 'txt']}]
        })
        return result.filePaths
    })

    // -------- 全局错误提示 --------
    ipcMain.on('show-global-error', (_event, error: string) => {
        const win = BrowserWindow.getAllWindows()[0]
        if (win) {
            win.webContents.send('global:error', error)
        }
    })

    log('IPC handlers registered')
}

// ============================================
// Electron 应用生命周期
// ============================================

// 应用准备就绪：初始化日志、模块、窗口
app.whenReady().then(async () => {
    initLogger(join(app.getPath('userData'), 'logs', 'main.log'))
    log('App ready')
    electronApp.setAppUserModelId('com.privrag.app')

    app.on('browser-window-created', (_, window) => {
        optimizer.watchWindowShortcuts(window)
    })

    await initializeModules()
    registerIpcHandlers()
    createWindow()

    // macOS：点击 Dock 图标时重建窗口
    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
})

// 所有窗口关闭时退出应用（macOS 除外）
app.on('window-all-closed', async () => {
    // 先停止 chat 服务，再停止 embedding 服务
    await serverManager?.stop()
    await serverManager?.embeddingManager?.stop()
    if (process.platform !== 'darwin') app.quit()
})

// 应用退出前：停止 llama-server、关闭 LanceDB 连接
app.on('before-quit', async () => {
    await serverManager?.stop()
    await serverManager?.embeddingManager?.stop()
    await indexManager?.close()
})
