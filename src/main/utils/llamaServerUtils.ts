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
 * - 打包后（packed）：process.resourcesPath/app.asar.unpacked/resources/
 *   示例：C:\Users\xxx\AppData\...\resources\
 *
 * 优先使用开发路径，如果不存在则使用打包后的路径
 */
export function getAppResourcesDir(): string {
    // dev 模式：直接从项目根目录读取 resources
    const devResourcesDir = join(app.getAppPath(), 'resources')
    // 打包后：从 asar 包外部读取（electron-builder unpack 选项）
    const packedResourcesDir = join(process.resourcesPath!, 'app.asar.unpacked', 'resources')
    return existsSync(devResourcesDir) ? devResourcesDir : packedResourcesDir
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
        // 匹配 llama-server 开头且 .exe 结尾的文件
        const exe = files.find((f) =>
            f.startsWith('llama-server') && f.endsWith('.exe'))
        return exe ? join(dir, exe) : ''
    } catch {
        return ''
    }
}
