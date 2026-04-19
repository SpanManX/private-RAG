/**
 * Embedding llama-server 进程管理器
 *
 * 职责：
 * 1. 启动/停止独立的 embedding llama-server 子进程（8081端口）
 * 2. 管理 bge-small-zh-v1.5 模型
 */

import {spawn, ChildProcess} from 'child_process'
import {join} from 'path'
import {existsSync} from 'fs'
import {app} from 'electron'
import {log} from '../logger'
import {findLlamaServerExe} from './llamaServerUtils'
import * as fs from 'fs'
import {detectGpu, waitForServer} from './serverUtils'

/** embedding 服务状态 */
export interface EmbeddingServerStatus {
    state: 'idle' | 'starting' | 'running' | 'error'
    message: string
    gpuAvailable?: boolean
}

export class EmbeddingServerManager {
    private process: ChildProcess | null = null
    private port = 8081  // embedding 专用端口
    private modelPath!: string
    private llamaServerPath!: string
    private gpuAvailable: boolean

    constructor() {
        this.gpuAvailable = detectGpu()
    }

    /** 初始化路径（需在 start 前调用） */
    init(): void {
        console.log(`[Embedding] app.getAppPath() = ${app.getAppPath()}`)
        console.log(`[Embedding] process.resourcesPath = ${process.resourcesPath}`)

        // dev 模式：app.getAppPath() 直接返回项目根目录
        const devResourcesDir = join(app.getAppPath(), 'resources', 'llama-server-GPU')
        // 打包后
        const packedResourcesDir = join(process.resourcesPath!, 'app.asar.unpacked', 'resources', 'llama-server-GPU')

        console.log(`[Embedding] devResourcesDir = ${devResourcesDir}, exists: ${existsSync(devResourcesDir)}`)
        console.log(`[Embedding] packedResourcesDir = ${packedResourcesDir}, exists: ${existsSync(packedResourcesDir)}`)

        const resourcesDir = existsSync(devResourcesDir) ? devResourcesDir : packedResourcesDir
        this.llamaServerPath = findLlamaServerExe(resourcesDir) || join(resourcesDir, 'llama-server.exe')
        log(`[Embedding] llama-server 路径: ${this.llamaServerPath}`)

        // 查找 bge 模型
        this.modelPath = this.findEmbeddingModel()
        log(`[Embedding] bge 模型路径: ${this.modelPath}`)
    }

    private findEmbeddingModel(): string {
        // dev 模式：app.getAppPath() 直接返回项目根目录
        const devModelDir = join(app.getAppPath(), 'resources', 'bge-small-zh-v1.5-gguf')
        // 打包后
        const packedModelDir = join(process.resourcesPath!, 'app.asar.unpacked', 'resources', 'bge-small-zh-v1.5-gguf')

        console.log(`[Embedding] devModelDir = ${devModelDir}, exists: ${existsSync(devModelDir)}`)
        console.log(`[Embedding] packedModelDir = ${packedModelDir}, exists: ${existsSync(packedModelDir)}`)

        const modelDir = existsSync(devModelDir) ? devModelDir : packedModelDir

        try {
            if (!existsSync(modelDir)) return ''
            const files = fs.readdirSync(modelDir)
            const modelFile = files.find((f) => f.endsWith('.gguf'))
            return modelFile ? join(modelDir, modelFile) : ''
        } catch (e) {
            console.log(`[Embedding] 读取模型目录失败: ${e}`)
            return ''
        }
    }

    async start(): Promise<void> {
        if (this.process) {
            log('[Embedding] embedding-server 已在运行')
            return
        }

        if (!existsSync(this.llamaServerPath)) {
            throw new Error(`[Embedding] llama-server.exe 未找到: ${this.llamaServerPath}`)
        }
        if (!existsSync(this.modelPath)) {
            throw new Error(`[Embedding] bge 模型文件未找到: ${this.modelPath}`)
        }

        // bge 模型必须使用 --pooling cls，否则向量质量严重下降
        const args = [
            '-m', this.modelPath,
            '-c', '4096',
            '--port', String(this.port),
            '-ngl', this.gpuAvailable ? '99' : '0',
            '--embedding',
            '--pooling', 'cls',  // bge 必须加此参数
            '--host', '127.0.0.1'
        ]

        log(`[Embedding] 启动参数: ${args.join(' ')}`)

        this.process = spawn(this.llamaServerPath, args, {
            stdio: ['ignore', 'pipe', 'pipe']
        })

        this.process.stdout?.on('data', (data) => {
            log(`[Embedding] ${data.toString().trim()}`)
        })
        this.process.stderr?.on('data', (data) => {
            log(`[Embedding ERROR] ${data.toString().trim()}`)
        })

        this.process.on('exit', (code) => {
            log(`[Embedding] embedding-server 已退出，代码: ${code}`)
            this.process = null
        })

        // 等待时间增加到 90s，GPU 冷启动可能较慢
        await waitForServer(this.port, 90000)
        log('[Embedding] embedding-server 启动成功，端口 8081')
    }

    async stop(): Promise<void> {
        if (this.process) {
            this.process.kill()
            this.process = null
            log('[Embedding] embedding-server 已停止')
        }
    }

    getStatus(): EmbeddingServerStatus {
        if (!this.process) {
            return {state: 'idle', message: 'Embedding server not running', gpuAvailable: this.gpuAvailable}
        }
        return {state: 'running', message: `Embedding server running on port ${this.port}`, gpuAvailable: this.gpuAvailable}
    }
}
