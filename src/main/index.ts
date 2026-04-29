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
import {electronApp, is, optimizer} from '@electron-toolkit/utils'
import {initLogger, log} from './logger'
import {ServerManager} from './serverManager'
import {DocumentProcessor} from './documentProcessor'
import {IndexManager} from './indexManager'
import {RagEngine} from './ragEngine'
import {ServerConfig, ServiceType} from './utils/serverUtils'
import {getModelMode, setModelMode, getOnlineApiConfig, setOnlineApiConfig} from './store'

// ============================================
// 全局错误捕获（尽早注册，确保捕获所有阶段错误）
// ============================================
let mainWindow: BrowserWindow | null = null

/**
 * 检测路径是否包含中文字符
 */
function hasChinesePath(p: string): boolean {
    return /[\u4e00-\u9fa5]/.test(p)
}

/**
 * 初始化前检查路径，返回错误信息或 null
 */
function checkPathBeforeInit(): string | null {
    const exePath = app.getPath('exe')
    if (hasChinesePath(exePath)) {
        return `程序安装路径包含中文：${exePath}\n\n请将程序安装或移动到纯英文路径下，再重新启动。`
    }
    return null
}

process.on('uncaughtException', (error) => {
    try {
        if (mainWindow) {
            mainWindow.webContents.send('global-error', error.message)
        }
    } catch {
        // 避免发送错误时又触发这个 handler
    }
    log(`未捕获异常: ${error.message}\n${error.stack}`)
})

process.on('unhandledRejection', (reason) => {
    try {
        if (mainWindow) {
            mainWindow.webContents.send('global-error', String(reason))
        }
    } catch {
        // 避免发送错误时又触发这个 handler
    }
    log(`未处理 Promise 拒绝: ${reason}`)
})

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
function createWindow(): BrowserWindow {
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

    // 禁用后台节流，避免窗口被遮挡时 SSE 流式更新暂停
    mainWindow.webContents.setBackgroundThrottling(false)

    // 窗口准备好后显示
    mainWindow.on('ready-to-show', () => {
        mainWindow.show()
        log('Window ready')
    })

    if (!app.isPackaged) {
        // 启用 F12 打开 DevTools
        mainWindow.webContents.on('before-input-event', (_event, input) => {
            if (input.key === 'F12') {
                mainWindow.webContents.toggleDevTools()
            }
        })
    }

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
    return mainWindow
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
function registerIpcHandlers(win: BrowserWindow): void {
    // -------- 服务状态变化回调（监听进程退出/崩溃） --------
    serverManager.onStatusChange = (running) => {
        win.webContents.send('server:status-changed', {
            chatRunning: running,
            embeddingRunning: serverManager.embeddingManager.getStatus().state === 'running'
        })
    }
    serverManager.embeddingManager.onStatusChange = (running) => {
        win.webContents.send('server:status-changed', {
            chatRunning: serverManager.getStatus().state === 'running',
            embeddingRunning: running
        })
    }

    // -------- llama-server 服务管理 --------
    ipcMain.handle('server:status', () => serverManager.getStatus())
    ipcMain.handle('embedding:status', () => serverManager.embeddingManager.getStatus())
    ipcMain.handle('server:start', async () => {
        try {
            const mode = getModelMode()
            if (mode === 'online') {
                // 在线模式：只启动 embedding 服务
                await serverManager.embeddingManager.start()
            } else {
                // 本地模式：启动两个服务
                await serverManager.start()
                await serverManager.embeddingManager.start()
            }
            // 通知渲染进程服务状态变化
            win.webContents.send('server:status-changed', {
                chatRunning: serverManager.getStatus().state === 'running',
                embeddingRunning: serverManager.embeddingManager.getStatus().state === 'running'
            })
            return {success: true, status: serverManager.getStatus()}
        } catch (error) {
            log('启动服务失败:', error)
            win.webContents.send('global:error', String(error))
            return {success: false, error: String(error), status: serverManager.getStatus()}
        }
    })
    ipcMain.handle('server:stop', async () => {
        const mode = getModelMode()
        if (mode === 'online') {
            // 在线模式：只停止 embedding 服务
            await serverManager.embeddingManager.stop()
        } else {
            // 本地模式：停止两个服务
            await serverManager.stop()
            await serverManager.embeddingManager.stop()
        }
        // 通知渲染进程服务状态变化
        win.webContents.send('server:status-changed', {
            chatRunning: serverManager.getStatus().state === 'running',
            embeddingRunning: serverManager.embeddingManager.getStatus().state === 'running'
        })
        return serverManager.getStatus()
    })
    ipcMain.handle('server:get-url', () => {
        return ServerConfig.getUrl(ServiceType.CHAT)
    })
    ipcMain.handle('server:download-model', () => serverManager.downloadModel())
    ipcMain.handle('server:cancel-download', () => serverManager.cancelDownload())

    // -------- 配置管理 --------
    ipcMain.handle('config:get-models-dir', () => serverManager.getModelsDir())
    ipcMain.handle('config:set-models-dir', (_event, dir: string) => {
        serverManager.updateModelsDir(dir)
        return {success: true}
    })
    ipcMain.handle('config:get-model-mode', () => getModelMode())
    ipcMain.handle('config:set-model-mode', async (_event, mode: 'local' | 'online') => {
        try {
            await serverManager.stop()
            await serverManager.embeddingManager.stop()
            setModelMode(mode)
            return {success: true, mode}
        } catch (error) {
            log('模式切换失败:', error)
            return {success: false, error: String(error)}
        }
    })
    ipcMain.handle('config:get-online-api', () => getOnlineApiConfig())
    ipcMain.handle('config:set-online-api', (_event, apiConfig: { url: string; key: string; model: string }) => {
        setOnlineApiConfig(apiConfig)
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
            // 导入前检查服务是否运行（根据模式判断）
            const mode = getModelMode()
            if (mode === 'online') {
                // 在线模式：只检查 embedding 服务
                if (serverManager.embeddingManager.getStatus().state !== 'running') {
                    return {success: false, error: 'Embedding 服务未启动。请先点击"启动服务"。'}
                }
            } else {
                // 本地模式：检查两个服务
                const chatStatus = serverManager.getStatus().state
                const embedStatus = serverManager.embeddingManager.getStatus().state
                if (chatStatus !== 'running') {
                    return {success: false, error: '对话服务未启动。请先点击"启动服务"。'}
                }
                if (embedStatus !== 'running') {
                    return {success: false, error: 'Embedding 服务未启动。请先点击"启动服务"。'}
                }
            }

            const text = await documentProcessor.parse(filePath)
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

    // -------- 在线模式 RAG 问答 --------
    ipcMain.handle('online:chat-stream', async (_event, question: string) => {
        try {
            if (serverManager.embeddingManager.getStatus().state !== 'running') {
                return {success: false, error: 'Embedding 服务未启动。请先点击"启动服务"。'}
            }
            const {prompt, citations} = await ragEngine.buildPrompt(question)
            return {success: true, prompt, citations}
        } catch (error) {
            log('在线查询错误:', error)
            return {success: false, error: String(error)}
        }
    })

    // -------- 文件选择对话框 --------
    ipcMain.handle('dialog:open-file', async () => {
        const result = await dialog.showOpenDialog({
            properties: ['openFile', 'multiSelections'],
            filters: [{name: 'Documents', extensions: ['pdf', 'docx', 'md', 'txt', 'xlsx', 'xls']}]
        })
        return result.filePaths
    })
}


// ============================================
// Electron 应用生命周期
// ============================================

// 应用准备就绪：初始化日志、模块、窗口
app.whenReady().then(async () => {
    // 初始化日志
    initLogger(join(app.getPath('userData'), 'logs', 'main.log'))
    log('App ready')
    electronApp.setAppUserModelId('com.privrag.app')

    // 创建窗口
    mainWindow = createWindow()

    // 检查路径（中文路径会导致 llama-server 无法加载模型）
    const pathError = checkPathBeforeInit()
    if (pathError) {
        log(`[路径检查失败] ${pathError}`)
        dialog.showErrorBox('路径错误', pathError)
        app.quit()
        return
    }

    app.on('browser-window-created', (_, window) => {
        optimizer.watchWindowShortcuts(window)
    })

    await initializeModules()
    registerIpcHandlers(mainWindow)

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
