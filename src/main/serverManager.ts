import { spawn, ChildProcess } from 'child_process'
import { join } from 'path'
import { existsSync, mkdirSync, createWriteStream } from 'fs'
import { BrowserWindow } from 'electron'
import http from 'http'
import https from 'https'
import { log } from './logger'

export interface ServerStatus {
  state: 'idle' | 'starting' | 'running' | 'error'
  message: string
  gpuAvailable?: boolean
}

export interface DownloadProgress {
  percent: number
  speed: string
}

export class ServerManager {
  private process: ChildProcess | null = null
  private port = 8080
  private modelPath: string
  private embeddingPath: string
  private llamaServerPath: string
  private modelsDir: string

  // ModelScope 国内镜像
  private readonly LLAMA_SERVER_URL = 'https://github.com/ggerganov/llama.cpp/releases/download/b4706/llama-server-windows-x64.exe'
  private readonly MODEL_URL = 'https://modelscope.cn/models/Qwen/Qwen3-1.5B-GGUF/resolve/main/qwen3-1.5b-q4_k_m.gguf'
  private readonly EMBEDDING_URL = 'https://modelscope.cn/models/AI-ModelScope/bge-small-zh-v1.5/resolve/main/'

  constructor(private userDataPath: string) {
    this.modelsDir = join(userDataPath, 'models')
    this.llamaServerPath = join(this.modelsDir, 'llama-server.exe')
    this.modelPath = join(this.modelsDir, 'qwen3-1.5b-q4_k_m.gguf')
    this.embeddingPath = join(this.modelsDir, 'bge-small-zh-v1.5-f16.gguf')
  }

  getStatus(): ServerStatus {
    if (!this.process) {
      return { state: 'idle', message: 'Server not running' }
    }
    return { state: 'running', message: `llama-server running on port ${this.port}` }
  }

  private detectGpu(): boolean {
    const cudaPaths = [
      'C:\\Program Files\\NVIDIA GPU Computing Toolkit\\CUDA',
      'C:\\Windows\\System32\\nvcuda.dll'
    ]
    return cudaPaths.some((p) => existsSync(p))
  }

  async start(): Promise<void> {
    if (this.process) {
      log('llama-server already running')
      return
    }

    const gpuAvailable = this.detectGpu()
    log(`GPU available: ${gpuAvailable}`)

    if (!existsSync(this.llamaServerPath)) {
      throw new Error(`llama-server.exe not found. Please download it from Settings page first.`)
    }

    if (!existsSync(this.modelPath)) {
      throw new Error(`Model file not found. Please download it from Settings page first.`)
    }

    const args = [
      '-m', this.modelPath,
      '-c', '4096',
      '--port', String(this.port),
      '-ngl', gpuAvailable ? '99' : '0',
      '--embedding', this.embeddingPath,
      '--host', '127.0.0.1'
    ]

    this.process = spawn(this.llamaServerPath, args, {
      stdio: ['ignore', 'pipe', 'pipe']
    })

    this.process.stdout?.on('data', (data) => {
      log(`[llama-server] ${data.toString().trim()}`)
    })

    this.process.stderr?.on('data', (data) => {
      log(`[llama-server ERROR] ${data.toString().trim()}`)
    })

    this.process.on('exit', (code) => {
      log(`llama-server exited with code: ${code}`)
      this.process = null
    })

    await this.waitForServer(this.port, 60000)
    log('llama-server started successfully')
  }

  async stop(): Promise<void> {
    if (this.process) {
      this.process.kill()
      this.process = null
      log('llama-server stopped')
    }
  }

  async downloadModel(): Promise<void> {
    const win = BrowserWindow.getAllWindows()[0]
    if (!win) return

    if (!existsSync(this.modelsDir)) {
      mkdirSync(this.modelsDir, { recursive: true })
    }

    // 1. 下载 llama-server.exe
    log('Downloading llama-server.exe...')
    await this.downloadFile(this.LLAMA_SERVER_URL, this.llamaServerPath, win, 'llama-server')
    log('llama-server.exe downloaded')

    // 2. 下载 Qwen3 模型
    log('Downloading Qwen3-1.5B model...')
    await this.downloadFile(this.MODEL_URL, this.modelPath, win, 'model')
    log('Qwen3 model downloaded')

    win.webContents.send('server:download-progress', {
      percent: 100,
      speed: 'All files ready'
    })
  }

  private async downloadFile(
    url: string,
    destPath: string,
    win: BrowserWindow,
    label: string
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const mod = url.startsWith('https') ? https : http
      const file = createWriteStream(destPath)

      mod.get(url, (res) => {
        // follow redirects
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          mod.get(res.headers.location, (res2) => {
            this.doDownload(res2, file, win, label).then(resolve).catch(reject)
          }).on('error', reject)
          return
        }

        this.doDownload(res, file, win, label).then(resolve).catch(reject)
      }).on('error', reject)
    })
  }

  private async doDownload(
    res: http.IncomingMessage,
    file: ReturnType<typeof createWriteStream>,
    win: BrowserWindow,
    label: string
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      let downloadedBytes = 0
      const totalBytes = parseInt(res.headers['content-length'] ?? '0', 10) || 100_000_000

      res.on('data', (chunk: Buffer) => {
        downloadedBytes += chunk.length
        file.write(chunk)
        const percent = Math.round((downloadedBytes / totalBytes) * 100)
        win.webContents.send('server:download-progress', {
          percent,
          speed: this.formatSpeed(downloadedBytes, Date.now())
        })
      })

      res.on('end', () => {
        file.end()
        log(`${label} download complete`)
        resolve()
      })

      res.on('error', (err) => {
        file.destroy()
        reject(err)
      })
    })
  }

  private formatSpeed(bytes: number, startTime: number): string {
    const elapsed = (Date.now() - startTime) / 1000
    if (elapsed < 1) return '0 MB/s'
    const speed = bytes / elapsed / (1024 * 1024)
    return `${speed.toFixed(1)} MB/s`
  }

  async generate(prompt: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const body = JSON.stringify({ prompt })
      const req = http.request(
        {
          hostname: 'localhost',
          port: this.port,
          path: '/completion',
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
        },
        (res) => {
          let data = ''
          res.on('data', (chunk) => (data += chunk))
          res.on('end', () => {
            try {
              const parsed = JSON.parse(data)
              resolve(parsed.content ?? data)
            } catch {
              resolve(data)
            }
          })
        }
      )
      req.on('error', reject)
      req.write(body)
      req.end()
    })
  }

  async generateStream(prompt: string): Promise<import('stream').Readable> {
    const response = await fetch(`http://localhost:${this.port}/completion`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, stream: true })
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }

    const reader = response.body?.getReader()
    if (!reader) throw new Error('Failed to read response stream')

    const { Readable } = await import('stream')
    return Readable.from(async function* () {
      const decoder = new TextDecoder()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        yield decoder.decode(value)
      }
    }())
  }

  private waitForServer(port: number, timeout: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const start = Date.now()
      const check = (): void => {
        const req = http.get(`http://localhost:${port}`, () => {
          resolve()
        })
        req.on('error', () => {
          if (Date.now() - start > timeout) {
            reject(new Error('llama-server start timeout'))
          } else {
            setTimeout(check, 1000)
          }
        })
      }
      check()
    })
  }
}
