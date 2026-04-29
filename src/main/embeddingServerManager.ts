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
import {LlamaServerBase} from './llamaServerBase'
import {ServerConfig, ServiceType} from './utils/serverUtils'
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
    protected readonly serviceType = ServiceType.EMBEDDING
    protected readonly statusMessage = {
        running: 'Embedding server running on port {port}',
        idle: 'Embedding server not running'
    }

    constructor() {
        super()
    }

    /**
     * 获取 bge 模型所在目录
     *
     * bge 模型存放于 resources/bge-small-zh-v1.5-gguf/ 子目录下
     */
    private getBgeModelDir(): string {
        return getAppResourcesDir('bge-small-zh-v1.5-gguf')
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

    /**
     * 启动 embedding 服务
     *
     * 启动参数：
     * - -m: bge 模型路径
     * - -c 4096: 上下文窗口大小
     * - --port: 动态分配（默认 8081，端口占用时自动 +1）
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

        // 动态查找可用端口
        const port = await ServerConfig.findAvailablePort(ServiceType.EMBEDDING)

        const args = [
            '-m', this.modelPath,
            '-c', '4096',
            '-ngl', this.gpuAvailable ? '99' : '0',
            '--embedding',
            '--pooling', 'cls',
            ...ServerConfig.getServerArgs(ServiceType.EMBEDDING, port)
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
        await this._waitForServer(port, 90000)
        log(`[Embedding] embedding-server 启动成功，端口 ${port}`)
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
