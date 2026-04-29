/**
 * LlamaServer 抽象基类
 *
 * 职责：提取 ServerManager 和 EmbeddingServerManager 的公共逻辑
 *
 * 共享内容：
 * - GPU 检测（构造函数中缓存结果）
 * - llama-server 路径查找
 * - 模型文件扫描（支持子目录嵌套搜索）
 * - 进程启动/停止的公共模式
 * - 目录配置管理（从 store 读取/写入）
 */

// 从 serverUtils.ts 重新导出，保持向后兼容
export {ServerConfig, ServiceType} from './utils/serverUtils'

import {ChildProcess} from 'child_process'
import {join} from 'path'
import {log} from './logger'
import {getModelsDir, setModelsDir} from './store'
import {detectGpu, waitForServer, ServiceType, ServerConfig} from './utils/serverUtils'
import {findLlamaServerExe, getLlamaServerDir} from './utils/llamaServerUtils'
import * as fs from 'fs'

/** llama-server 服务状态 */
export interface ServerStatus {
    state: 'idle' | 'starting' | 'running' | 'error'
    message: string
    gpuAvailable?: boolean
    /** 模型文件路径（可选） */
    modelPath?: string
    /** 模型文件名（可选） */
    modelName?: string
}

/**
 * llama-server 进程管理基类
 *
 * 子类需要实现：
 * - start(): 启动服务
 * - stop(): 停止服务
 * - serviceType: 服务类型（用于 getStatus）
 * - statusMessage: 状态消息模板
 */
export abstract class LlamaServerBase {
    /** llama-server 子进程 */
    protected process: ChildProcess | null = null
    /** 模型文件存放目录（用户配置） */
    protected modelsDir!: string
    /** GPU 是否可用（检测一次，后续复用） */
    protected gpuAvailable!: boolean
    /** llama-server.exe 完整路径 */
    protected llamaServerPath!: string
    /** 模型文件路径 */
    protected modelPath!: string

    /** 服务类型（子类必须定义） */
    protected abstract readonly serviceType: ServiceType
    /** 状态消息模板 */
    protected abstract readonly statusMessage: { running: string; idle: string }
    /** 状态变化回调（用于通知外部，如渲染进程） */
    public onStatusChange?: (running: boolean) => void

    constructor() {
        this.gpuAvailable = detectGpu()
    }

    /** 公开访问 GPU 可用性 */
    public getGpuAvailable(): boolean {
        return this.gpuAvailable
    }

    /**
     * 通知状态变化
     */
    protected notifyStatusChange(): void {
        if (this.onStatusChange) {
            this.onStatusChange(this.process !== null)
        }
    }

    /**
     * 获取服务状态（基类实现）
     * 子类通过 serviceType 和 statusMessage 自定义消息
     */
    getStatus(): ServerStatus {
        const state: ServerStatus['state'] = this.process ? 'running' : 'idle'
        const port = ServerConfig.getPort(this.serviceType)
        return {
            state,
            message: this.process
                ? this.statusMessage.running.replace('{port}', String(port))
                : this.statusMessage.idle,
            gpuAvailable: this.gpuAvailable,
            modelPath: this.modelPath,
            modelName: this.modelPath ? this.modelPath.split(/[/\\]/).pop() : undefined
        }
    }

    /**
     * 刷新模型路径
     *
     * 1. 从 store 获取用户配置的 modelsDir
     * 2. 使用 llamaServerUtils 定位 llama-server.exe
     * 3. 子类可覆盖以扫描各自的模型文件
     */
    protected async refreshPaths(): Promise<void> {
        this.modelsDir = getModelsDir()
        const llamaServerDir = getLlamaServerDir()
        this.llamaServerPath = findLlamaServerExe(llamaServerDir) || join(llamaServerDir, 'llama-server.exe')
        log(`llama-server 路径: ${this.llamaServerPath}`)
    }

    /**
     * 扫描 modelsDir 及子目录，查找匹配的模型文件
     *
     * 搜索顺序：
     * 1. 先遍历子目录（用户可能按模型名建了子文件夹）
     * 2. 再搜索根目录
     *
     * @param prefix - 文件名前缀（如 'Qwen3'）
     * @param ext - 文件扩展名（如 '.gguf'）
     */
    protected findModelFile(prefix: string, ext: string): string | null {
        try {
            const files = fs.readdirSync(this.modelsDir, {withFileTypes: true})
            for (const dir of files) {
                if (dir.isDirectory()) {
                    const subDir = join(this.modelsDir, dir.name)
                    const subFiles = fs.readdirSync(subDir)
                    const match = subFiles.find((f: string) =>
                        f.startsWith(prefix) && f.endsWith(ext))
                    if (match) return join(subDir, match)
                }
            }
            // 直接在 modelsDir 下查找
            const rootFiles = fs.readdirSync(this.modelsDir)
            const rootMatch = rootFiles.find((f: string) =>
                f.startsWith(prefix) && f.endsWith(ext))
            if (rootMatch) return join(this.modelsDir, rootMatch)
        } catch {
        }
        return null
    }

    /** 获取当前模型目录 */
    public getModelsDir(): string {
        return this.modelsDir
    }

    /**
     * 更新模型目录
     *
     * 会同时更新 store 中的持久化配置和内存中的路径缓存
     */
    public updateModelsDir(dir: string): void {
        setModelsDir(dir)
        this.refreshPaths()
        log(`模型目录已更新: ${dir}`)
    }

    /**
     * 检查文件是否存在且大小合理
     *
     * @param path - 文件路径
     * @param minSize - 最小文件大小（字节），默认 1024，防止空文件
     */
    protected fileExists(path: string, minSize: number = 1024): boolean {
        try {
            const stats = fs.statSync(path)
            return stats.size >= minSize
        } catch {
            return false
        }
    }

    /**
     * 等待服务就绪
     *
     * 轮询 HTTP 端口，直到服务响应或超时
     *
     * @param port - 服务端口
     * @param timeout - 超时时间（毫秒）
     */
    protected async _waitForServer(port: number, timeout: number): Promise<void> {
        await waitForServer(port, timeout)
    }

    /** 启动服务（子类实现） */
    abstract start(): Promise<void>

    /** 停止服务（子类实现） */
    abstract stop(): Promise<void>
}
