/**
 * llama-server 进程管理器
 *
 * 职责：
 * 1. 启动/停止 llama-server 子进程
 * 2. 下载和管理 AI 模型文件
 * 3. 检测 GPU 可用性
 * 4. 提供 HTTP API 调用（generate / generateStream）
 *
 * llama-server 是 llama.cpp 的服务器版本，提供 HTTP 接口用于：
 * - 对话生成（/completion）
 * - Embedding 向量化（--embedding 参数）
 */

import {spawn, ChildProcess} from 'child_process'
import {join} from 'path'
import {existsSync, mkdirSync, createWriteStream, writeFileSync} from 'fs'
import {BrowserWindow} from 'electron'
import http from 'http'
import https from 'https'
import AdmZip from 'adm-zip'
import {downloadFile} from '@huggingface/hub'
import {log} from './logger'
import {getModelsDir, setModelsDir} from './store'

/** llama-server 服务状态 */
export interface ServerStatus {
    state: 'idle' | 'starting' | 'running' | 'error'
    message: string
    gpuAvailable?: boolean   // GPU 是否可用（CUDA）
}

/** 模型下载进度 */
export interface DownloadProgress {
    percent: number         // 进度百分比 0-100
    speed: string          // 下载速度字符串
    phase: 'llama-server' | 'model' | 'embedding' | 'done'  // 当前阶段
    fileName: string        // 当前下载的文件名
    current: number        // 当前阶段编号 1-3
    total: number           // 总阶段数
}

export class ServerManager {
    private process: ChildProcess | null = null
    private port = 8080                       // llama-server HTTP 端口
    private modelPath!: string                 // Qwen 模型路径
    private embeddingPath!: string              // Embedding 模型路径
    private llamaServerPath!: string           // llama-server.exe 路径
    private modelsDir!: string                 // 模型文件目录
    private cancellationToken: { cancelled: boolean } = {cancelled: false}
    private isDownloading = false
    // 缓存 GPU 检测结果，避免每次查询时重复文件系统检查
    private gpuAvailable: boolean

    // ========== 模型下载地址配置 ==========
    // llama-server: llama.cpp Windows x64 CPU 版本（ZIP 压缩包）
    private readonly LLAMA_SERVER_URL = 'https://github.com/ggml-org/llama.cpp/releases/download/b5482/llama-b5482-bin-win-cpu-x64.zip'
    // Qwen3-1.7B 对话模型（GGUF 格式）
    private readonly MODEL_REPO = 'Qwen/Qwen3-1.7B-GGUF'
    private readonly MODEL_FILE = 'qwen3-1.7b-q4_k_m.gguf'
    // BGE 中文 embedding 模型（用于向量化查询文本和文档）
    private readonly EMBEDDING_REPO = 'CompendiumLabs/bge-small-zh-v1.5-gguf'
    private readonly EMBEDDING_FILE = 'bge-small-zh-v1.5-f16.gguf'

    constructor() {
        this.refreshPaths()
        // 构造函数中检测 GPU，后续启动服务时使用缓存结果
        this.gpuAvailable = this.detectGpu()
        log(`GPU 可用性（缓存）: ${this.gpuAvailable}`)
    }

    /**
     * 刷新模型路径
     * 自动扫描 modelsDir 及其子目录，查找实际的模型文件
     * 支持用户手动下载的模型（可能位于子目录中）
     */
    private refreshPaths(): void {
        this.modelsDir = getModelsDir()
        const llamaServerDir = join(this.modelsDir, 'llama-server')

        // 查找 llama-server.exe（文件名可能因版本而异）
        this.llamaServerPath = this.findLlamaServerExe(llamaServerDir)

        // 扫描查找 Qwen GGUF 模型文件
        this.modelPath = this.findModelFile('Qwen3', '.gguf')
            || join(this.modelsDir, 'qwen3-1.7b-q4_k_m.gguf')

        // 扫描查找 embedding 模型文件
        this.embeddingPath = this.findEmbeddingFile()
            || join(this.modelsDir, 'bge-small-zh-v1.5-f16.gguf')
    }

    /**
     * 扫描 modelsDir 及子目录，查找匹配的模型文件
     * @param prefix 文件名前缀（如 'Qwen3'）
     * @param ext 文件扩展名（如 '.gguf'）
     */
    private findModelFile(prefix: string, ext: string): string | null {
        try {
            const files = require('fs').readdirSync(this.modelsDir, {withFileTypes: true})
            for (const dir of files) {
                if (dir.isDirectory()) {
                    const subDir = join(this.modelsDir, dir.name)
                    const subFiles = require('fs').readdirSync(subDir)
                    const match = subFiles.find((f: string) =>
                        f.startsWith(prefix) && f.endsWith(ext))
                    if (match) return join(subDir, match)
                }
            }
            // 直接在 modelsDir 下查找
            const rootFiles = require('fs').readdirSync(this.modelsDir)
            const rootMatch = rootFiles.find((f: string) =>
                f.startsWith(prefix) && f.endsWith(ext))
            if (rootMatch) return join(this.modelsDir, rootMatch)
        } catch {
        }
        return null
    }

    /** 扫描查找 embedding 模型文件 */
    private findEmbeddingFile(): string | null {
        try {
            const files = require('fs').readdirSync(this.modelsDir, {withFileTypes: true})
            for (const dir of files) {
                if (dir.isDirectory() && dir.name.includes('bge')) {
                    const subDir = join(this.modelsDir, dir.name)
                    const subFiles = require('fs').readdirSync(subDir)
                    const match = subFiles.find((f: string) => f.endsWith('.gguf'))
                    if (match) return join(subDir, match)
                }
            }
        } catch {
        }
        return null
    }

    private getLlamaServerDir(): string {
        return join(this.modelsDir, 'llama-server')
    }

    /** 查找 llama-server.exe，支持动态文件名 */
    private findLlamaServerExe(dir: string): string {
        try {
            const files = require('fs').readdirSync(dir)
            const exe = files.find((f: string) =>
                f.startsWith('llama-server') && f.endsWith('.exe'))
            return exe ? join(dir, exe) : join(dir, 'llama-server.exe')
        } catch {
            return join(dir, 'llama-server.exe')
        }
    }

    private findExistingLlamaServer(dir: string): string | null {
        try {
            const files = require('fs').readdirSync(dir)
            const exe = files.find((f: string) =>
                f.startsWith('llama-server') && f.endsWith('.exe'))
            return exe ? join(dir, exe) : null
        } catch {
            return null
        }
    }

    private getLlamaServerZipPath(): string {
        return join(this.modelsDir, 'llama-server.zip')
    }

    /**
     * 解压 llama-server ZIP 包
     * llama.cpp 发布包是 ZIP 格式，需要解压到 llama-server 目录
     */
    private extractLlamaServer(zipPath: string, targetDir: string): void {
        try {
            if (!existsSync(targetDir)) {
                mkdirSync(targetDir, {recursive: true})
            }
            const zip = new AdmZip(zipPath)
            zip.extractAllTo(targetDir, true)
            log(`解压成功到: ${targetDir}`)
            // 解压后刷新路径，获取实际文件名
            this.refreshPaths()
        } catch (err) {
            log(`解压失败: ${err}`)
            throw err
        }
    }

    /** 获取当前模型目录 */
    getModelsDir(): string {
        return this.modelsDir
    }

    /** 更新模型目录并刷新路径 */
    updateModelsDir(dir: string): void {
        setModelsDir(dir)
        this.refreshPaths()
        log(`模型目录已更新: ${dir}`)
    }

    /** 获取服务状态 */
    getStatus(): ServerStatus {
        if (!this.process) {
            return {state: 'idle', message: 'Server not running', gpuAvailable: this.gpuAvailable}
        }
        return {state: 'running', message: `llama-server running on port ${this.port}`, gpuAvailable: this.gpuAvailable}
    }

    /**
     * 检测 GPU 是否可用
     * 通过检查 CUDA 安装路径和 nvcuda.dll 文件
     */
    private detectGpu(): boolean {
        const cudaPaths = [
            'C:\\Program Files\\NVIDIA GPU Computing Toolkit\\CUDA',
            'C:\\Windows\\System32\\nvcuda.dll'
        ]
        return cudaPaths.some((p) => existsSync(p))
    }

    /** 检查文件是否存在且大小合理 */
    private fileExists(path: string, minSize: number = 1024): boolean {
        try {
            const stats = {size: require('fs').statSync(path).size}
            return stats.size >= minSize
        } catch {
            return false
        }
    }

    /** 取消正在进行的下载 */
    cancelDownload(): void {
        if (this.isDownloading) {
            this.cancellationToken.cancelled = true
            log('下载已被用户取消')
        }
    }

    /**
     * 启动 llama-server
     * - 检查必需的文件是否存在
     * - 启动子进程
     * - 等待服务就绪
     */
    async start(): Promise<void> {
        if (this.process) {
            log('llama-server 已在运行')
            return
        }

        log(`GPU 可用性: ${this.gpuAvailable}`)

        // 检查必需文件
        if (!existsSync(this.llamaServerPath)) {
            throw new Error(`llama-server.exe 未找到，请先从设置页面下载`)
        }
        if (!existsSync(this.modelPath)) {
            throw new Error(`模型文件未找到，请先从设置页面下载`)
        }

        // 构建 llama-server 参数
        // -m: 模型路径
        // -c: 上下文窗口大小
        // --port: HTTP 端口
        // -ngl: GPU 层数（0=仅CPU，99=尽量用GPU）
        // --embedding: 启用 embedding 模型
        // --host: 监听地址
        const args = [
            '-m', this.modelPath,
            '-c', '4096',
            '--port', String(this.port),
            '-ngl', this.gpuAvailable ? '99' : '0',
            // '--embedding', this.embeddingPath,
            // '--pooling', 'cls',  // BEG 必须加这个参数，否则向量效果很差
            '--embedding',
            '--host', '127.0.0.1'
        ]
        console.log('llamaServerPath:', this.llamaServerPath)
        console.log('args:', args)
        // 启动子进程
        this.process = spawn(this.llamaServerPath, args, {
            stdio: ['ignore', 'pipe', 'pipe']
        })

        // 捕获标准输出和错误
        this.process.stdout?.on('data', (data) => {
            log(`[llama-server] ${data.toString().trim()}`)
        })
        this.process.stderr?.on('data', (data) => {
            log(`[llama-server ERROR] ${data.toString().trim()}`)
        })

        // 进程退出时清理
        this.process.on('exit', (code) => {
            log(`llama-server 已退出，代码: ${code}`)
            this.process = null
        })

        // 等待服务就绪（最多 60 秒）
        await this.waitForServer(this.port, 60000)
        log('llama-server 启动成功')
    }

    /** 停止 llama-server */
    async stop(): Promise<void> {
        if (this.process) {
            this.process.kill()
            this.process = null
            log('llama-server 已停止')
        }
    }

    /**
     * 下载所有必需的模型文件
     * 三阶段：llama-server → Qwen 模型 → Embedding 模型
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

            // ===== 阶段 1: 下载并解压 llama-server =====
            const llamaServerDir = this.getLlamaServerDir()
            const existingExe = this.findExistingLlamaServer(llamaServerDir)
            if (existingExe && this.fileExists(existingExe, 1024)) {
                // 已存在，跳过
                win.webContents.send('server:download-progress', {
                    percent: 100, speed: '已存在', phase: 'llama-server',
                    fileName: 'llama-server.exe', current: 1, total: 3
                })
            } else {
                // 下载并解压
                const zipPath = this.getLlamaServerZipPath()
                await this.downloadFileHttp(this.LLAMA_SERVER_URL, zipPath, win, 'llama-server', 1)
                this.extractLlamaServer(zipPath, llamaServerDir)
            }

            // ===== 阶段 2: 下载 Qwen3 模型 =====
            if (this.fileExists(this.modelPath, 100_000_000)) {
                win.webContents.send('server:download-progress', {
                    percent: 100, speed: '已存在', phase: 'model',
                    fileName: this.MODEL_FILE, current: 2, total: 3
                })
            } else {
                await this.downloadFromHub(this.MODEL_REPO, this.MODEL_FILE, this.modelPath, win, 'model', 2)
            }

            // ===== 阶段 3: 下载 Embedding 模型 =====
            if (this.fileExists(this.embeddingPath, 10_000_000)) {
                win.webContents.send('server:download-progress', {
                    percent: 100, speed: '已存在', phase: 'embedding',
                    fileName: this.EMBEDDING_FILE, current: 3, total: 3
                })
            } else {
                await this.downloadFromHub(this.EMBEDDING_REPO, this.EMBEDDING_FILE, this.embeddingPath, win, 'embedding', 3)
            }

            // 全部完成
            win.webContents.send('server:download-progress', {
                percent: 100, speed: 'All files ready', phase: 'done',
                fileName: '', current: 3, total: 3
            })
        } finally {
            this.isDownloading = false
        }
    }

    /**
     * 使用 HuggingFace SDK 下载模型文件
     * 通过 hf-mirror.com 镜像站加速国内下载
     */
    private async downloadFromHub(
        repo: string,
        fileName: string,
        destPath: string,
        win: BrowserWindow,
        label: string,
        phase: 1 | 2 | 3
    ): Promise<void> {
        log(`从 HuggingFace 下载 ${label}: ${repo}/${fileName}`)

        try {
            const blob = await downloadFile({
                repo: repo,
                path: fileName,
                hubUrl: 'https://hf-mirror.com'  // 使用国内镜像
            })

            if (!blob) {
                throw new Error('下载失败，文件为空')
            }

            const totalBytes = blob.size
            log(`${label} 文件大小: ${totalBytes} bytes`)

            // 将 Blob 转换为 Buffer 并写入文件
            const arrayBuffer = await blob.arrayBuffer()
            const buffer = Buffer.from(arrayBuffer)

            // 分块发送进度（简化版，实际进度依赖内存中的完整下载）
            const chunkSize = Math.max(1, Math.floor(totalBytes / 100))
            for (let i = 0; i < 100; i++) {
                if (this.cancellationToken.cancelled) {
                    throw new Error('Download cancelled')
                }
                const progress = Math.min((i + 1) * chunkSize, totalBytes)
                const percent = Math.round((progress / totalBytes) * 100)
                win.webContents.send('server:download-progress', {
                    percent,
                    speed: `${(progress / 1024 / 1024).toFixed(1)} MB`,
                    phase: {1: 'llama-server', 2: 'model', 3: 'embedding'}[phase] as string,
                    fileName,
                    current: phase,
                    total: 3
                })
            }

            writeFileSync(destPath, buffer)
            log(`${label} 下载完成: ${destPath}`)
        } catch (err) {
            log(`${label} 下载失败: ${err}`)
            throw err
        }
    }

    /**
     * HTTP 下载文件（用于 llama-server）
     * 支持重定向，自动选择 http/https 模块
     */
    private async downloadFileHttp(
        url: string,
        destPath: string,
        win: BrowserWindow,
        label: string,
        phase: 1 | 2 | 3
    ): Promise<void> {
        log(`开始下载 ${label}: ${url}`)

        return new Promise((resolve, reject) => {
            if (this.cancellationToken.cancelled) {
                reject(new Error('Download cancelled'))
                return
            }

            const mod = url.startsWith('https') ? https : http
            const file = createWriteStream(destPath)

            const req = mod.get(url, (res) => {
                log(`${label} 响应状态: ${res.statusCode}`)
                // 处理重定向
                if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                    log(`${label} 重定向到: ${res.headers.location}`)
                    mod.get(res.headers.location, (res2) => {
                        this.doDownload(res2, file, win, label, phase, destPath.split(/[/\\]/).pop() || '')
                            .then(resolve).catch(reject)
                    }).on('error', reject)
                    return
                }
                this.doDownload(res, file, win, label, phase, destPath.split(/[/\\]/).pop() || '')
                    .then(resolve).catch(reject)
            }).on('error', (err) => {
                log(`${label} 下载错误: ${err.message}`)
                reject(err)
            })

            // 30 秒连接超时
            req.setTimeout(30000, () => {
                log(`${label} 连接超时`)
                req.destroy()
                reject(new Error(`${label} 连接超时，请检查网络`))
            })
        })
    }

    /** 执行实际下载，实时更新进度 */
    private async doDownload(
        res: http.IncomingMessage,
        file: ReturnType<typeof createWriteStream>,
        win: BrowserWindow,
        label: string,
        phase: 1 | 2 | 3,
        fileName: string
    ): Promise<void> {
        return new Promise((resolve, reject) => {
            let downloadedBytes = 0
            const totalBytes = parseInt(res.headers['content-length'] ?? '0', 10) || 100_000_000
            const phaseNames = {1: 'llama-server', 2: 'model', 3: 'embedding'} as const

            res.on('data', (chunk: Buffer) => {
                if (this.cancellationToken.cancelled) {
                    file.destroy()
                    reject(new Error('Download cancelled'))
                    return
                }
                downloadedBytes += chunk.length
                file.write(chunk)
                const percent = Math.round((downloadedBytes / totalBytes) * 100)
                win.webContents.send('server:download-progress', {
                    percent, speed: this.formatSpeed(downloadedBytes, Date.now()),
                    phase: phaseNames[phase], fileName, current: phase, total: 3
                })
            })

            res.on('end', () => {
                file.end()
                log(`${label} 下载完成`)
                resolve()
            })

            res.on('error', (err) => {
                file.destroy()
                reject(err)
            })
        })
    }

    /** 格式化下载速度 */
    private formatSpeed(bytes: number, startTime: number): string {
        const elapsed = (Date.now() - startTime) / 1000
        if (elapsed < 1) return '0 MB/s'
        const speed = bytes / elapsed / (1024 * 1024)
        return `${speed.toFixed(1)} MB/s`
    }

    /**
     * 调用 llama-server 生成文本（非流式）
     * POST /completion { prompt: string }
     */
    async generate(prompt: string): Promise<string> {
        return new Promise((resolve, reject) => {
            const body = JSON.stringify({
                prompt,
                temperature: 0.3,      // 降低随机性
                max_tokens: 1024,       // 限制最大 token 数
                stop: ['---', 'User question:', '\n\n\n']  // 停止序列
            })
            const req = http.request(
                {
                    hostname: 'localhost',
                    port: this.port,
                    path: '/completion',
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Content-Length': Buffer.byteLength(body)
                    }
                },
                (res) => {
                    let data = ''
                    res.on('data', (chunk) => (data += chunk))
                    res.on('end', () => {
                        try {
                            const parsed = JSON.parse(data)
                            resolve(parsed.content ?? data)
                        } catch {
                            resolve(data)
                        }
                    })
                }
            )
            req.on('error', reject)
            req.write(body)
            req.end()
        })
    }

    /**
     * 调用 llama-server 生成文本（流式）
     * POST /completion { prompt: string, stream: true }
     * 返回 Node.js Readable 流
     */
    // async generateStream(prompt: string): Promise<import('stream').Readable> {
    //     const response = await fetch(`http://localhost:${this.port}/completion`, {
    //         method: 'POST',
    //         headers: {'Content-Type': 'application/json'},
    //         body: JSON.stringify({
    //             prompt,
    //             stream: true,
    //             temperature: 0.3,
    //             max_tokens: 1024,
    //             stop: ['---', 'User question:', '\n\n\n']
    //         })
    //     })
    //
    //     if (!response.ok) {
    //         throw new Error(`HTTP ${response.status}`)
    //     }
    //
    //     const reader = response.body?.getReader()
    //     if (!reader) throw new Error('Failed to read response stream')
    //
    //     const {Readable} = await import('stream')
    //     // 将 Web ReadableStream 转换为 Node.js Readable
    //     return Readable.from(async function* () {
    //         const decoder = new TextDecoder()
    //         while (true) {
    //             const {done, value} = await reader.read()
    //             if (done) break
    //             yield decoder.decode(value)
    //         }
    //     }())
    // }

    /**
     * 调用 llama-server 生成文本嵌入向量
     * POST /embedding { content: string }
     * 返回归一化的 float32 向量数组
     */
    async embed(text: string): Promise<number[]> {
        return new Promise((resolve, reject) => {
            const body = JSON.stringify({input: text})
            const req = http.request(
                {
                    host: '127.0.0.1',
                    port: this.port,
                    path: '/embedding',
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Content-Length': Buffer.byteLength(body)
                    }
                },
                (res) => {
                    let data = ''
                    res.on('data', (chunk) => (data += chunk))
                    res.on('end', () => {
                        try {
                            const parsed = JSON.parse(data)
                            log(`Embedding 响应: ${JSON.stringify(parsed).substring(0, 200)}`)
                            // llama-server 返回格式: [{"index":0,"embedding":[[...],...]}] 或 {"embedding": [...]}
                            let embedding: number[]
                            if (Array.isArray(parsed)) {
                                // 数组格式: [{"embedding": [[...]]}]
                                const emb = parsed[0]?.embedding
                                embedding = Array.isArray(emb) ? (Array.isArray(emb[0]) ? emb[0] : emb) : []
                            } else {
                                // 对象格式: {"embedding": [...]}
                                embedding = parsed.embedding || []
                            }
                            log(`Embedding 向量维度: ${embedding.length}`)
                            // 归一化向量（L2 norm）
                            const norm = Math.sqrt(embedding.reduce((sum: number, v: number) => sum + v * v, 0))
                            const normalized = norm > 0 ? embedding.map((v: number) => v / norm) : embedding
                            resolve(normalized)
                        } catch {
                            reject(new Error(`Embedding parse error: ${data}`))
                        }
                    })
                }
            )
            req.on('error', reject)
            req.write(body)
            req.end()
        })
    }

    /**
     * 等待 llama-server 就绪
     * 通过轮询 HTTP 端口检测服务是否启动
     */
    private waitForServer(port: number, timeout: number): Promise<void> {
        return new Promise((resolve, reject) => {
            const start = Date.now()
            const check = (): void => {
                const req = http.get(`http://localhost:${port}`, () => {
                    resolve()
                })
                req.on('error', () => {
                    if (Date.now() - start > timeout) {
                        reject(new Error('llama-server 启动超时'))
                    } else {
                        setTimeout(check, 1000)
                    }
                })
            }
            check()
        })
    }
}
