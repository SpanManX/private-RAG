import {join} from 'path'
import * as fs from 'fs'
import {existsSync} from 'fs'
import {app} from 'electron'

/**
 * 获取应用资源目录
 *
 * Electron 打包后的资源路径与开发时不同：
 * - 开发模式（dev）：app.getAppPath()/resources/
 *   示例：D:\GitHub\rag-knowledge-base\resources\
 * - 打包后（packed）：process.resourcesPath/resources/
 *   示例：C:\Users\xxx\AppData\...\resources\
 */
export function getAppResourcesDir(): string {
    // 检测是否在打包环境中
    // asar 文件路径中会包含 .asar 或 app.asar
    const inAsar = app.getAppPath().includes('.asar')

    // 打包后用 process.resourcesPath（extraResources 放在此目录）
    if (inAsar) {
        return join(process.resourcesPath!, 'resources')
    }

    // 开发模式：直接从项目根目录读取 resources
    return join(app.getAppPath(), 'resources')
}

/**
 * 获取 llama-server 可执行文件所在目录
 * llama-server 存放于 resources/llama-server/ 子目录下
 */
export function getLlamaServerDir(): string {
    return join(getAppResourcesDir(), 'llama-server')
}

/**
 * 在指定目录中查找 llama-server.exe
 *
 * llama-server 的文件名可能因版本而异（如 llama-server.exe、llama-server-windows.exe 等）
 * 因此使用前缀匹配而非硬编码文件名
 *
 * @param dir - 要搜索的目录
 * @returns 完整的 llama-server.exe 路径，如果未找到则返回空字符串
 */
export function findLlamaServerExe(dir: string): string {
    if (!existsSync(dir)) return ''
    try {
        const files = fs.readdirSync(dir)
        const exe = files.find((f) =>
            f.startsWith('llama-server') && f.endsWith('.exe'))
        return exe ? join(dir, exe) : ''
    } catch {
        return ''
    }
}
