/**
 * llama-server 进程管理器（对话服务 8080）
 *
 * 职责：
 * 1. 启动/停止 llama-server 子进程
 * 2. 下载和管理 AI 模型文件
 * 3. 提供对话生成 API
 *
 * 继承 LlamaServerBase，共享公共逻辑
 */

import {existsSync, mkdirSync} from 'fs'
import {BrowserWindow} from 'electron'
import {log} from './logger'
import * as fs from 'node:fs'
import axios from 'axios'
import path from 'node:path'
import {LlamaServerBase} from './llamaServerBase'
import {ServerConfig, ServiceType} from './utils/serverUtils'
import {EmbeddingServerManager} from './embeddingServerManager'
import {ChildProcess, spawn} from "child_process";

/** 模型下载进度（IPC 事件发送） */
export interface DownloadProgress {
    percent: number      // 进度 0-100
    speed: string        // 下载速度
    phase: 'model' | 'embedding' | 'done'
    fileName: string     // 当前文件名
    current: number      // 当前阶段
    total: number       // 总阶段数
}

/**
 * 对话服务管理器
 *
 * 管理 Qwen3-4B 对话模型，启动在 8080 端口的 llama-server 进程
 * 同时持有 EmbeddingServerManager 实例，用于管理向量服务
 */
export class ServerManager extends LlamaServerBase {
    /** 下载取消标记 */
    private cancellationToken: { cancelled: boolean } = {cancelled: false}
    /** 是否正在下载 */
    private isDownloading = false

    /** embedding 服务管理器（独立进程） */
    public embeddingManager: EmbeddingServerManager

    /** Qwen 模型文件名 */
    private readonly MODEL_FILE = 'Qwen3-4B-Q5_K_M.gguf'

    protected readonly serviceType = ServiceType.CHAT
    protected readonly statusMessage = {
        running: 'llama-server running on port {port}',
        idle: 'Server not running'
    }

    constructor() {
        super()
        this.embeddingManager = new EmbeddingServerManager()
        this.refreshPaths()
    }

    /** 刷新路径（覆盖父类，添加 Qwen 模型扫描） */
    async refreshPaths(): Promise<void> {
        await super.refreshPaths()
        this.modelPath = this.findModelFile('Qwen3', '.gguf') || ''
        log(`[ServerManager] 模型路径: ${this.modelPath}`)
    }

    /**
     * 启动 llama-server 子进程
     *
     * 封装公共的进程创建和日志绑定逻辑：
     * - 设置 stdio 管道
     * - 绑定 stdout/stderr 日志输出
     * - 监听进程退出事件并清理状态
     *
     * @param args - llama-server 命令行参数
     */
    protected spawnProcess(args: string[]): ChildProcess {
        if (!existsSync(this.llamaServerPath)) {
            throw new Error(`llama-server.exe 未找到: ${this.llamaServerPath}`)
        }

        try {
            const process = spawn(this.llamaServerPath, args, {
                stdio: ['ignore', 'pipe', 'pipe']
            })

            process.stdout?.on('data', (data) => {
                log(`[llama-server] ${data.toString().trim()}`)
            })
            process.stderr?.on('data', (data) => {
                log(`[llama-server ERROR] ${data.toString().trim()}`)
            })

            process.on('exit', (code) => {
                log(`llama-server 已退出，代码: ${code}`)
                this.process = null
            })

            return process
        } catch (error) {
            throw new Error(`启动 llama-server 失败: ${error}`)
        }
    }

    /**
     * 启动对话服务
     *
     * 启动参数：
     * - -m: Qwen 模型路径
     * - -c 4096: 上下文窗口大小
     * - --port: 动态分配（默认 8080，端口占用时自动 +1）
     * - -ngl: GPU 层数（99=尽量用 GPU）
     */
    async start(): Promise<void> {
        if (this.process) {
            log('llama-server 已在运行')
            return
        }

        await this.refreshPaths()

        if (!existsSync(this.llamaServerPath)) {
            throw new Error(`未找到 llama-server.exe，请先下载并放入 ./resources/app.asar.unpacked/resources`)
        } else if (!existsSync(this.modelPath)) {
            throw new Error(`模型文件未找到，请到设置页面下载模型`)
        }

        // 动态查找可用端口
        const port = await ServerConfig.findAvailablePort(ServiceType.CHAT)

        const args = [
            '-m', this.modelPath,
            '-c', '4096',
            '-ngl', this.gpuAvailable ? '99' : '0',
            ...ServerConfig.getServerArgs(ServiceType.CHAT, port)
        ]

        this.process = this.spawnProcess(args)
        await this._waitForServer(port, 60000)
        log(`llama-server 启动成功，端口 ${port}`)
    }

    /** 停止对话服务 */
    async stop(): Promise<void> {
        if (this.process) {
            this.process.kill()
            this.process = null
            log('llama-server 已停止')
        }
    }

    /** 取消正在进行的模型下载 */
    cancelDownload(): void {
        if (this.isDownloading) {
            this.cancellationToken.cancelled = true
            log('下载已被用户取消')
        }
    }

    /**
     * 下载模型文件
     *
     * 从 ModelScope 下载 Qwen3-4B-GGUF 模型
     * 进度通过 IPC 事件实时推送到渲染进程
     */
    async downloadModel(): Promise<void> {
        const win = BrowserWindow.getAllWindows()[0]
        if (!win) return

        this.cancellationToken = {cancelled: false}
        this.isDownloading = true

        try {
            if (!existsSync(this.modelsDir)) {
                mkdirSync(this.modelsDir, {recursive: true})
            }

            // 检查文件是否已存在（至少 100MB）
            if (this.fileExists(this.modelPath, 100_000_000)) {
                log(`模型文件已存在: ${this.modelPath}`)
                win.webContents.send('server:download-progress', {
                    percent: 100, speed: '已存在', phase: 'model',
                    fileName: this.MODEL_FILE, current: 1, total: 2
                })
            } else {
                await this.downloadModelFile(win, 'model', 1, 2)
            }

            win.webContents.send('server:download-progress', {
                percent: 100, speed: 'All files ready', phase: 'done',
                fileName: '', current: 2, total: 2
            })
        } finally {
            this.isDownloading = false
        }
    }

    /**
     * 从 ModelScope 下载模型文件
     *
     * 使用流式下载，边下载边发送进度
     *
     * @param win - Electron 窗口，用于发送 IPC 进度事件
     * @param label - 下载阶段标签
     * @param current - 当前阶段编号
     * @param total - 总阶段数
     */
    private async downloadModelFile(
        win: BrowserWindow,
        label: 'model' | 'embedding',
        current: number,
        total: number
    ) {
        const fileName = this.MODEL_FILE
        const destPath = path.join(this.modelsDir, fileName)
        const baseUrl = 'https://modelscope.cn'
        const repoPath = 'Qwen/Qwen3-4B-GGUF'
        const fileUrl = `${baseUrl}/api/v1/models/${repoPath}/repo?Revision=master&FilePath=${fileName}`

        log(`开始下载文件: ${fileName}`)

        const writer = fs.createWriteStream(destPath)

        const response = await axios({
            url: fileUrl,
            method: 'GET',
            responseType: 'stream',
            timeout: 0,  // 大文件下载不设置超时
        })

        const totalBytes = parseInt(<string>response.headers['content-length'], 10)
        let downloadedBytes = 0

        // 流式下载，进度实时推送
        response.data.on('data', (chunk: Buffer) => {
            downloadedBytes += chunk.length
            const percent = Math.round((downloadedBytes / totalBytes) * 100)

            win.webContents.send('server:download-progress', {
                percent,
                speed: '',
                phase: label,
                fileName,
                current,
                total
            })
        })

        response.data.pipe(writer)

        return new Promise((resolve, reject) => {
            writer.on('finish', () => {
                log(`${label} 下载完成`)
                resolve(true)
            })
            writer.on('error', (err) => {
                log(`${label} 下载失败: ${err.message}`)
                reject(err)
            })
        })
    }
}
