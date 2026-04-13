/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const component: DefineComponent<object, object, any>
  export default component
}

interface Window {
  electron: typeof import('@electron-toolkit/preload').electronAPI
  api: {
    server: {
      status: () => Promise<{ state: 'idle' | 'starting' | 'running' | 'error'; message: string; gpuAvailable?: boolean }>
      start: () => Promise<void>
      stop: () => Promise<void>
      downloadModel: () => Promise<void>
      cancelDownload: () => Promise<void>
      onDownloadProgress: (callback: (progress: {
        percent: number
        speed: string
        phase: 'llama-server' | 'model' | 'embedding' | 'done'
        fileName: string
        current: number
        total: number
      }) => void) => void
    }
    document: {
      import: (filePath: string) => Promise<{ success: boolean; docId?: string; textLength?: number; error?: string }>
      importBatch: (filePaths: string[]) => Promise<{ filePath: string; success: boolean; docId?: string; error?: string }[]>
      list: () => Promise<Array<{ id: string; fileName: string; createdAt: number; textLength?: number }>>
      delete: (docId: string) => Promise<void>
    }
    rag: {
      query: (question: string) => Promise<{
        success: boolean
        answer?: string
        citations?: Array<{ docId: string; fileName: string; score: number; excerpt: string }>
        error?: string
      }>
      queryStream: (question: string) => void
      onChunk: (callback: (chunk: string) => void) => void
      onEnd: (callback: () => void) => void
      onError: (callback: (error: string) => void) => void
    }
    dialog: {
      openFile: () => Promise<string[]>
      selectDirectory: () => Promise<string | null>
    }
    config: {
      getModelsDir: () => Promise<string>
      setModelsDir: (dir: string) => Promise<{ success: boolean }>
    }
  }
}
