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
    ragEngine = new RagEngine(serverManager, indexManager)
    await indexManager.initialize()  // 初始化 LanceDB 连接
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
    ipcMain.handle('server:start', () => serverManager.start())
    ipcMain.handle('server:stop', () => serverManager.stop())
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
            const text = await documentProcessor.parse(filePath)
            console.log(text, '单文件')
            const docId = await indexManager.addDocument(filePath, text)
            return {success: true, docId, textLength: text.length}
        } catch (error) {
            log('Document import error:', error)
            return {success: false, error: String(error)}
        }
    })

    // 批量导入文档
    ipcMain.handle('document:import-batch', async (_event, filePaths: string[]) => {
        console.log('执行：import-batch', filePaths)
        const results: any = []
        for (const filePath of filePaths) {
            try {
                const text = await documentProcessor.parse(filePath)
                console.log('解析完成, 开始添加到 LanceDB')
                const docId = await indexManager.addDocument(filePath, text)
                console.log('添加成功, docId:', docId)
                results.push({filePath, success: true, docId})
            } catch (error) {
                console.error('单个文件导入失败:', error)  // 关键：看这里
                results.push({filePath, success: false, error: String(error)})
            }
        }
        console.log('返回结果:', results)
        return results
    })


    // 文档列表和删除
    ipcMain.handle('document:list', () => indexManager.listDocuments())
    ipcMain.handle('document:delete', (_event, docId: string) =>
        indexManager.deleteDocument(docId)
    )

    // -------- RAG 问答 --------
    // 非流式查询：搜索 → 构建 prompt → 调用 llama-server → 返回结果
    ipcMain.handle('rag:query', async (_event, question: string) => {
        try {
            return await ragEngine.query(question)
        } catch (error) {
            log('RAG query error:', error)
            return {success: false, error: String(error)}
        }
    })

    // 流式查询：返回 prompt 和引用，让前端使用 fetch-event-source 调用 llama-server
    ipcMain.handle('rag:query-stream', async (_event, question: string) => {
        try {
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

    log('IPC handlers registered')
}

// ============================================
// Electron 应用生命周期
// ============================================

// 应用准备就绪：初始化日志、模块、窗口
app.whenReady().then(async () => {
    initLogger(join(app.getPath('userData'), 'logs', 'main.log'))
    log('App ready')
    electronApp.setAppUserModelId('com.rag.knowledgebase')

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
    await serverManager?.stop()
    if (process.platform !== 'darwin') app.quit()
})

// 应用退出前：停止 llama-server、关闭 LanceDB 连接
app.on('before-quit', async () => {
    await serverManager?.stop()
    await indexManager?.close()
})
