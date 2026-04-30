import * as fs from 'fs'
import * as path from 'path'

let logFile: string | null = null

export function initLogger(filePath: string): void {
  logFile = filePath
  const dir = path.dirname(filePath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

export function log(...args: unknown[]): void {
  const msg = args.map((a) => String(a)).join(' ')
  const line = `[${new Date().toISOString()}] ${msg}`
  console.log(line)
  if (logFile) {
    try {
      fs.appendFileSync(logFile, line + '\n')
    } catch (err) {
      throw new Error(`Failed to write to log file: ${err}`)
    }
  }
}
