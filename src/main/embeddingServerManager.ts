/**
 * Embedding llama-server 进程管理器（向量服务 8081）
 *
 * 职责：
 * 1. 启动/停止独立的 embedding llama-server 子进程（8081端口）
 * 2. 管理 bge-small-zh-v1.5 模型（用于将文本转为向量）
 *
 * 继承 LlamaServerBase，共享公共逻辑
 */

import {spawn} from 'child_process'
import {join} from 'path'
import {existsSync} from 'fs'
import {log} from './logger'
import * as fs from 'fs'
import {LlamaServerBase, ServerStatus} from './llamaServerBase'
import {getAppResourcesDir} from './utils/llamaServerUtils'

/** embedding 服务状态（供外部使用） */
export interface EmbeddingServerStatus {
    state: 'idle' | 'starting' | 'running' | 'error'
    message: string
    gpuAvailable?: boolean
}

/**
 * Embedding 服务管理器
 *
 * 与主对话服务（8080）分离，使用独立进程和端口（8081）
 * bge 模型必须使用 --pooling cls 参数，否则向量质量会严重下降
 */
export class EmbeddingServerManager extends LlamaServerBase {
    /** Embedding 服务专用端口 */
    private port = 8081
    /** bge 模型文件路径 */
    private modelPath!: string

    constructor() {
        super()
    }

    /**
     * 获取 bge 模型所在目录
     *
     * bge 模型存放于 resources/bge-small-zh-v1.5-gguf/ 子目录下
     */
    private getBgeModelDir(): string {
        const baseDir = getAppResourcesDir()
        return join(baseDir, 'bge-small-zh-v1.5-gguf')
    }

    /**
     * 查找 bge 模型文件
     *
     * 在 bge 模型目录中搜索 .gguf 文件
     */
    private findEmbeddingModel(): string {
        const modelDir = this.getBgeModelDir()

        try {
            if (!existsSync(modelDir)) return ''
            const files = fs.readdirSync(modelDir)
            const modelFile = files.find((f) => f.endsWith('.gguf'))
            return modelFile ? join(modelDir, modelFile) : ''
        } catch {
            return ''
        }
    }

    getStatus(): ServerStatus {
        const state: ServerStatus['state'] = this.process ? 'running' : 'idle'
        return {
            state,
            message: this.process ? `Embedding server running on port ${this.port}` : 'Embedding server not running',
            gpuAvailable: this.gpuAvailable,
            modelPath: this.modelPath,
            modelName: this.modelPath ? this.modelPath.split(/[/\\]/).pop() : undefined
        }
    }

    /**
     * 启动 embedding 服务
     *
     * 启动参数：
     * - -m: bge 模型路径
     * - -c 4096: 上下文窗口大小
     * - --port 8081: 独立端口
     * - -ngl: GPU 层数（99=尽量用 GPU）
     * - --embedding: 启用 embedding 模式
     * - --pooling cls: 必须参数，bge 模型专用
     */
    async start(): Promise<void> {
        if (this.process) {
            log('[Embedding] embedding-server 已在运行')
            return
        }

        await this.refreshPaths()
        this.modelPath = this.findEmbeddingModel()
        log(`[Embedding] llama-server 路径: ${this.llamaServerPath}`)
        log(`[Embedding] bge 模型路径: ${this.modelPath}`)

        if (!existsSync(this.llamaServerPath)) {
            throw new Error(`[Embedding] llama-server.exe 未找到: ${this.llamaServerPath}`)
        }
        if (!existsSync(this.modelPath)) {
            throw new Error(`[Embedding] bge 模型文件未找到: ${this.modelPath}`)
        }

        const args = [
            '-m', this.modelPath,
            '-c', '4096',
            '--port', String(this.port),
            '-ngl', this.gpuAvailable ? '99' : '0',
            '--embedding',
            '--pooling', 'cls',
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

        // GPU 冷启动较慢，增加等待时间到 90s
        await this._waitForServer(this.port, 90000)
        log('[Embedding] embedding-server 启动成功，端口 8081')
    }

    /** 停止 embedding 服务 */
    async stop(): Promise<void> {
        if (this.process) {
            this.process.kill()
            this.process = null
            log('[Embedding] embedding-server 已停止')
        }
    }
}
