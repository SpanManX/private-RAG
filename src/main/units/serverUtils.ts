/**
 * llama-server 共享工具函数
 */

import {existsSync} from 'fs'
import * as nodeHttp from 'http'

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
