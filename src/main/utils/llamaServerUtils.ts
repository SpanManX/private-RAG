import {join} from 'path'
import * as fs from 'fs'
import {existsSync} from 'fs'

/**
 * 查找 llama-server.exe，支持动态文件名
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
