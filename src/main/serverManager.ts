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
import {existsSync, mkdirSync} from 'fs'
import {app, BrowserWindow} from 'electron'
// import http from 'http'
// import https from 'https'
// import AdmZip from 'adm-zip'
// import git from 'isomorphic-git'
import {log} from './logger'
import {getModelsDir, setModelsDir} from './store'
import * as fs from "node:fs";
import * as nodeHttp from 'http'
// import http from 'isomorphic-git/http/node'
import axios from "axios";
import path from "node:path";
import {getCUDAInfo} from "./units/nvidiaUtil";
import {EmbeddingServerManager} from "./units/embeddingServerManager";

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
    phase: 'model' | 'embedding' | 'done'  // 当前阶段
    fileName: string        // 当前下载的文件名
    current: number        // 当前阶段编号 1-3
    total: number           // 总阶段数
}

export class ServerManager {
    private process: ChildProcess | null = null
    private port = 8080                       // llama-server HTTP 端口
    private modelPath!: string                 // Qwen 模型路径
    // private _embeddingPath!: string              // Embedding 模型路径（预留）
    private llamaServerPath!: string           // llama-server.exe 路径
    private modelsDir!: string                 // 模型文件目录
    private cancellationToken: { cancelled: boolean } = {cancelled: false}
    private isDownloading = false
    // 缓存 GPU 检测结果，避免每次查询时重复文件系统检查
    private gpuAvailable: boolean

    // embedding 服务管理器
    public embeddingManager: EmbeddingServerManager

    // ========== 模型下载地址配置 ==========
    // llama-server: llama.cpp Windows x64 CPU 版本（ZIP 压缩包）
    // private readonly LLAMA_SERVER_URL = 'https://github.com/ggml-org/llama.cpp/releases/download/b5482/llama-b5482-bin-win-cpu-x64.zip'
    // Qwen3-1.7B 对话模型（GGUF 格式）
    // private readonly MODEL_REPO = 'Qwen/Qwen3-1.7B-GGUF'
    // private readonly MODEL_FILE = 'qwen3-1.7b-q4_k_m.gguf'
    private readonly MODEL_FILE = 'Qwen3-4B-Q5_K_M.gguf'
    // private readonly MODEL_FILE = 'Qwen3-1.7B-Q8_0.gguf'
    // BGE 中文 embedding 模型（用于向量化查询文本和文档）
    // private readonly EMBEDDING_FILE = 'bge-small-zh-v1.5-f16.gguf'

    constructor() {
        // 构造函数中检测 GPU，后续启动服务时使用缓存结果
        this.gpuAvailable = this.detectGpu()
        console.log(`GPU 可用性（检测）: ${this.gpuAvailable}`)
        log(`GPU 可用性（缓存）: ${this.gpuAvailable}`)
        this.embeddingManager = new EmbeddingServerManager()
        this.refreshPaths()
    }

    /**
     * 刷新模型路径
     * 自动扫描 modelsDir 及其子目录，查找实际的模型文件
     * 支持用户手动下载的模型（可能位于子目录中）
     */
    async refreshPaths(): Promise<void> {
        this.modelsDir = getModelsDir()

        const gpuInfo = await getCUDAInfo();
        if (gpuInfo.available) {
            console.log(`检测到 GPU: ${gpuInfo.model}, CUDA 版本: ${gpuInfo.version}`);
        } else {
            console.warn('警告: 未检测到可用 GPU，将回退至 CPU 模式');
        }

        // dev 模式：electron 可执行文件的上一级的上一级是项目根目录
        const devResourcesDir = join(app.getAppPath(), '..', '..', 'resources', 'llama-server-GPU')
        // 打包后（asarUnpack）：解压到 app.asar.unpacked/resources/
        const packedResourcesDir = join(process.resourcesPath!, 'app.asar.unpacked', 'resources', 'llama-server-GPU')

        // 自动检测：dev 模式用 dev 路径，打包后用 prod 路径
        const resourcesDir = existsSync(devResourcesDir) ? devResourcesDir : packedResourcesDir
        this.llamaServerPath = this.findLlamaServerExe(resourcesDir) || join(resourcesDir, 'llama-server.exe')
        log(`llama-server 路径: ${this.llamaServerPath}`)
        // 扫描查找 Qwen GGUF 模型文件
        this.modelPath = this.findModelFile('Qwen3', '.gguf') || ''

        // 扫描查找 embedding 模型文件
        // this._embeddingPath = this.findEmbeddingFile() || ''
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
    // private findEmbeddingFile(): string | null {
    //     try {
    //         const files = require('fs').readdirSync(this.modelsDir, {withFileTypes: true})
    //         for (const dir of files) {
    //             if (dir.isDirectory() && dir.name.includes('bge')) {
    //                 const subDir = join(this.modelsDir, dir.name)
    //                 const subFiles = require('fs').readdirSync(subDir)
    //                 const match = subFiles.find((f: string) => f.endsWith('.gguf'))
    //                 if (match) return join(subDir, match)
    //             }
    //         }
    //     } catch {
    //     }
    //     return null
    // }

    /** 查找 llama-server.exe，支持动态文件名 */
    private findLlamaServerExe(dir: string): string {
        if (!existsSync(dir)) return ''
        try {
            const files = require('fs').readdirSync(dir)
            const exe = files.find((f: string) =>
                f.startsWith('llama-server') && f.endsWith('.exe'))
            return exe ? join(dir, exe) : join(dir, 'llama-server.exe')
        } catch {
            return join(dir, 'llama-server.exe')
        }
    }

    // private getLlamaServerZipPath(): string {
    //     return join(this.modelsDir, 'llama-server.zip')
    // }

    /**
     * 解压 llama-server ZIP 包
     * llama.cpp 发布包是 ZIP 格式，需要解压到 llama-server 目录
     */
    // private extractLlamaServer(zipPath: string, targetDir: string): void {
    //     try {
    //         if (!existsSync(targetDir)) {
    //             mkdirSync(targetDir, {recursive: true})
    //         }
    //         const zip = new AdmZip(zipPath)
    //         zip.extractAllTo(targetDir, true)
    //         log(`解压成功到: ${targetDir}`)
    //         // 解压后刷新路径，获取实际文件名
    //         this.refreshPaths()
    //     } catch (err) {
    //         log(`解压失败: ${err}`)
    //         throw err
    //     }
    // }

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
        console.log('this.llamaServerPath:', this.llamaServerPath)
        // 构建 llama-server 参数
        // -m: 模型路径
        // -c: 上下文窗口大小
        // --port: HTTP 端口
        // -ngl: GPU 层数（0=仅CPU，99=尽量用GPU）
        // --host: 监听地址
        const args = [
            '-m', this.modelPath,
            '-c', '4096',
            '--port', String(this.port),
            '-ngl', this.gpuAvailable ? '99' : '0',
            '--host', '127.0.0.1'
        ]
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
     * 两阶段：Qwen 模型 → Embedding 模型（llama-server 打包进安装包）
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

            // ===== 阶段 1: 下载 Qwen3 模型 =====
            if (this.fileExists(this.modelPath, 100_000_000)) {
                log(`模型文件已存在: ${this.modelPath}`)
                win.webContents.send('server:download-progress', {
                    percent: 100, speed: '已存在', phase: 'model',
                    fileName: this.MODEL_FILE, current: 1, total: 2
                })
            } else {
                //     await this.cloneWithProgress(win, 'model', 1, 2)
                await this.downloadModelFile(win, 'model', 1, 2)
            }

            // ===== 阶段 2: 下载 Embedding 模型 =====
            // if (this.fileExists(this.embeddingPath, 10_000_000)) {
            //     win.webContents.send('server:download-progress', {
            //         percent: 100, speed: '已存在', phase: 'embedding',
            //         fileName: this.EMBEDDING_FILE, current: 2, total: 2
            //     })
            // } else {
            //     await this.cloneWithProgress(win, 'embedding', 2, 2)
            // }

            // 全部完成
            win.webContents.send('server:download-progress', {
                percent: 100, speed: 'All files ready', phase: 'done',
                fileName: '', current: 2, total: 2
            })
        } finally {
            this.isDownloading = false
        }
    }

    private async downloadModelFile(
        win: BrowserWindow,
        label: 'model' | 'embedding',
        current: number,
        total: number
    ) {
        // 1. 定义具体的模型文件直链 (以 Qwen3-4B-GGUF 的 Q4_K_M 为例)
        // const fileUrl = label === 'model'
        //     ? 'https://modelscope.cn'
        //     : '你的Embedding模型直链';

        const fileName = this.MODEL_FILE;
        const destPath = path.join(this.modelsDir, fileName);
        const baseUrl = "https://modelscope.cn";
        const repoPath = `Qwen/Qwen3-4B-GGUF`;
        const fileUrl = `${baseUrl}/api/v1/models/${repoPath}/repo?Revision=master&FilePath=${fileName}`;

        log(`开始下载文件: ${fileName}`);

        const writer = fs.createWriteStream(destPath);

        const response = await axios({
            url: fileUrl,
            method: 'GET',
            responseType: 'stream',
            timeout: 0, // 关键：禁用超时
        });

        const totalBytes = parseInt(response.headers['content-length'], 10);
        let downloadedBytes = 0;

        response.data.on('data', (chunk: Buffer) => {
            downloadedBytes += chunk.length;
            const percent = Math.round((downloadedBytes / totalBytes) * 100);

            // 发送进度到渲染进程
            win.webContents.send('server:download-progress', {
                percent,
                speed: '', // 可以根据时间计算下载速度
                phase: label,
                fileName,
                current,
                total
            });
        });

        response.data.pipe(writer);

        return new Promise((resolve, reject) => {
            writer.on('finish', () => {
                log(`${label} 下载完成`);
                resolve(true);
            });
            writer.on('error', (err) => {
                log(`${label} 下载失败: ${err.message}`);
                reject(err);
            });
        });
    }

    /** 格式化下载速度 */
    // private formatSpeed(bytes: number, startTime: number): string {
    //     const elapsed = (Date.now() - startTime) / 1000
    //     if (elapsed < 1) return '0 MB/s'
    //     const speed = bytes / elapsed / (1024 * 1024)
    //     return `${speed.toFixed(1)} MB/s`
    // }

    /**
     * 等待 llama-server 就绪
     * 通过轮询 HTTP 端口检测服务是否启动
     */
    private waitForServer(port: number, timeout: number): Promise<void> {
        return new Promise((resolve, reject) => {
            const start = Date.now()
            const check = (): void => {
                const req = nodeHttp.get(`http://localhost:${port}`, () => {
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
