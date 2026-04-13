import {app, shell, BrowserWindow, ipcMain, dialog} from 'electron'
import {join} from 'path'
import {electronApp, optimizer, is} from '@electron-toolkit/utils'
import {initLogger, log} from './logger'
import {ServerManager} from './serverManager'
import {DocumentProcessor} from './documentProcessor'
import {IndexManager} from './indexManager'
import {RagEngine} from './ragEngine'

// 全局单例
let serverManager: ServerManager
let documentProcessor: DocumentProcessor
let indexManager: IndexManager
let ragEngine: RagEngine

function createWindow(): void {
    const mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        minWidth: 900,
        minHeight: 600,
        show: false,
        frame: true,
        autoHideMenuBar: false,
        webPreferences: {
            preload: join(__dirname, '../preload/index.js'),
            sandbox: false,
            contextIsolation: true,
            nodeIntegration: false
        }
    })

    mainWindow.on('ready-to-show', () => {
        mainWindow.show()
        log('Window ready')
    })

    mainWindow.webContents.setWindowOpenHandler((details) => {
        shell.openExternal(details.url)
        return {action: 'deny'}
    })

    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
        mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
    } else {
        mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
    }
}

async function initializeModules(): Promise<void> {
    const userDataPath = app.getPath('userData')
    serverManager = new ServerManager(userDataPath)
    documentProcessor = new DocumentProcessor()
    indexManager = new IndexManager(userDataPath)
    ragEngine = new RagEngine(serverManager, indexManager)
    await indexManager.initialize()
    log('Modules initialized')
}

function registerIpcHandlers(): void {
    ipcMain.handle('server:status', () => serverManager.getStatus())
    ipcMain.handle('server:start', () => serverManager.start())
    ipcMain.handle('server:stop', () => serverManager.stop())
    ipcMain.handle('server:download-model', () => serverManager.downloadModel())
    ipcMain.handle('server:cancel-download', () => serverManager.cancelDownload())

    ipcMain.handle('document:import', async (_event, filePath: string) => {
        try {
            const text = await documentProcessor.parse(filePath)
            const docId = await indexManager.addDocument(filePath, text)
            return {success: true, docId, textLength: text.length}
        } catch (error) {
            log('Document import error:', error)
            return {success: false, error: String(error)}
        }
    })

    ipcMain.handle('document:import-batch', async (_event, filePaths: string[]) => {
        const results: any = []
        for (const filePath of filePaths) {
            try {
                const text = await documentProcessor.parse(filePath)
                const docId = await indexManager.addDocument(filePath, text)
                results.push({filePath, success: true, docId})
            } catch (error) {
                results.push({filePath, success: false, error: String(error)})
            }
        }
        return results
    })

    ipcMain.handle('document:list', () => indexManager.listDocuments())
    ipcMain.handle('document:delete', (_event, docId: string) =>
        indexManager.deleteDocument(docId)
    )

    ipcMain.handle('rag:query', async (_event, question: string) => {
        try {
            return await ragEngine.query(question)
        } catch (error) {
            log('RAG query error:', error)
            return {success: false, error: String(error)}
        }
    })

    ipcMain.handle('rag:query-stream', async (event, question: string) => {
        try {
            const stream = await ragEngine.queryStream(question)
            stream.on('data', (chunk) => event.sender.send('rag:chunk', chunk))
            stream.on('end', () => event.sender.send('rag:end'))
            stream.on('error', (err) => event.sender.send('rag:error', err.message))
        } catch (error) {
            event.sender.send('rag:error', String(error))
        }
    })

    ipcMain.handle('dialog:open-file', async () => {
        const result = await dialog.showOpenDialog({
            properties: ['openFile', 'multiSelections'],
            filters: [{name: 'Documents', extensions: ['pdf', 'docx', 'md', 'txt']}]
        })
        return result.filePaths
    })

    log('IPC handlers registered')
}

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

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
})

app.on('window-all-closed', async () => {
    await serverManager?.stop()
    if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', async () => {
    await serverManager?.stop()
    await indexManager?.close()
})
