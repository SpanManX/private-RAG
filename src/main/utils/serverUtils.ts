/**
 * llama-server 共享工具函数
 *
 * 包含：
 * - GPU 检测
 * - 端口检测
 * - 服务等待
 * - 服务地址配置
 */

import {existsSync} from 'fs'
import * as nodeHttp from 'http'
import {log} from '../logger'

/** 服务类型枚举 */
export enum ServiceType {
    /** 对话服务（Chat） */
    CHAT = 'chat',
    /** 向量嵌入服务（Embedding） */
    EMBEDDING = 'embedding'
}

/**
 * 服务地址配置管理器
 */
export class ServerConfig {
    /** 服务主机地址 */
    private static readonly HOST = '127.0.0.1'

    /** 默认端口配置 */
    private static readonly DEFAULT_PORTS: Record<ServiceType, number> = {
        [ServiceType.CHAT]: 8080,
        [ServiceType.EMBEDDING]: 8081
    }

    /** 动态分配的端口缓存 */
    private static portCache: Partial<Record<ServiceType, number>> = {}

    /**
     * 获取服务基础 URL（不含路径）
     */
    static getBaseUrl(serviceType: ServiceType, port?: number): string {
        const p = port ?? this.getPort(serviceType)
        return `http://${this.HOST}:${p}`
    }

    /**
     * 获取服务完整 URL
     */
    static getUrl(serviceType: ServiceType, path: string = '', port?: number): string {
        return `${this.getBaseUrl(serviceType, port)}${path}`
    }

    /**
     * 获取服务端口
     */
    static getPort(serviceType: ServiceType): number {
        return this.portCache[serviceType] ?? this.DEFAULT_PORTS[serviceType]
    }

    /**
     * 获取主机地址
     */
    static getHost(): string {
        return this.HOST
    }

    /**
     * 查找可用端口
     *
     * 从默认端口开始检查，如果被占用则 +1 递增，直到找到可用端口
     * 最多尝试 100 次（8080 ~ 8180）
     */
    static async findAvailablePort(serviceType: ServiceType): Promise<number> {
        const basePort = this.DEFAULT_PORTS[serviceType]

        for (let offset = 0; offset <= 100; offset++) {
            const port = basePort + offset
            const available = await isPortAvailable(port)
            if (available) {
                this.portCache[serviceType] = port
                log(`[ServerConfig] ${serviceType} 服务端口: ${basePort} -> ${port} (动态分配)`)
                return port
            }
        }

        throw new Error(`找不到可用的 ${serviceType} 端口（已尝试 ${basePort} ~ ${basePort + 100}）`)
    }

    /**
     * 重置端口缓存
     */
    static resetPort(serviceType?: ServiceType): void {
        if (serviceType) {
            delete this.portCache[serviceType]
        } else {
            this.portCache = {}
        }
    }

    /**
     * 获取 llama-server 启动参数（host 和 port）
     */
    static getServerArgs(serviceType: ServiceType, port?: number): string[] {
        const p = port ?? this.getPort(serviceType)
        return ['--host', this.HOST, '--port', String(p)]
    }
}

/**
 * 检查端口是否已被占用
 *
 * @param port - 要检查的端口号
 * @returns true 表示端口可用（未占用），false 表示端口已被占用
 */
export function isPortAvailable(port: number): Promise<boolean> {
    return new Promise((resolve) => {
        const server = nodeHttp.createServer()
        server.once('error', () => {
            resolve(false) // 端口被占用
        })
        server.once('listening', () => {
            server.close()
            resolve(true) // 端口可用
        })
        server.listen(port, '127.0.0.1')
    })
}

/** 检测 GPU 是否可用（CUDA） */
export function detectGpu(): boolean {
    const cudaPaths = [
        'C:\\Program Files\\NVIDIA GPU Computing Toolkit\\CUDA',
        'C:\\Windows\\System32\\nvcuda.dll'
    ]
    return cudaPaths.some((p) => existsSync(p))
}

/** 等待服务就绪（轮询 HTTP 端口） */
export function waitForServer(port: number, timeout: number): Promise<void> {
    return new Promise((resolve, reject) => {
        const start = Date.now()
        const check = (): void => {
            const req = nodeHttp.get(`http://localhost:${port}`, () => {
                resolve()
            })
            req.on('error', () => {
                if (Date.now() - start > timeout) {
                    reject(new Error(`Server on port ${port} startup timeout`))
                } else {
                    setTimeout(check, 1000)
                }
            })
        }
        check()
    })
}
