/// <reference types="vite/client" />

declare module '*.vue' {
    import type {DefineComponent} from 'vue'
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const component: DefineComponent<object, object, any>
    export default component
}

interface Window {
    electron: typeof import('@electron-toolkit/preload').electronAPI
    api: {
        onGlobalError: (callback: (errorMsg: string) => void) => void;
        server: {
            status: () => Promise<{
                state: 'idle' | 'starting' | 'running' | 'error';
                message: string;
                gpuAvailable?: boolean;
                modelName?: string;
                modelPath?: string
            }>
            start: () => Promise<{
                success: boolean;
                error?: string;
                status?: {
                    state: 'idle' | 'starting' | 'running' | 'error';
                    message: string;
                    gpuAvailable?: boolean;
                    modelName?: string;
                    modelPath?: string
                }
            }>
            stop: () => Promise<void>
            downloadModel: () => Promise<void>
            cancelDownload: () => Promise<void>
            getServerUrl: () => Promise<string>
            onDownloadProgress: (callback: (progress: {
                percent: number
                speed: string
                phase: 'model' | 'embedding' | 'done'
                fileName: string
                current: number
                total: number
            }) => void) => void
            onStatusChange: (callback: (status: {
                chatRunning: boolean
                embeddingRunning: boolean
                gpuAvailable: boolean
            }) => void) => void
        }
        document: {
            import: (filePath: string) => Promise<{
                success: boolean;
                docId?: string;
                textLength?: number;
                error?: string
            }>
            importBatch: (filePaths: string[]) => Promise<{
                filePath: string;
                success: boolean;
                docId?: string;
                error?: string
            }[]>
            list: () => Promise<Array<{ id: string; fileName: string; createdAt: number; textLength?: number }>>
            delete: (docId: string) => Promise<void>
            onImportProgress: (callback: (progress: {
                phase: 'parsing' | 'vectorizing' | 'done' | 'idle'
                fileName: string
                fileIndex: number
                fileTotal: number
                chunkIndex: number
                chunkTotal: number
                percent: number
            }) => void) => void
        }
        rag: {
            query: (question: string) => Promise<{
                success: boolean
                answer?: string
                citations?: Array<{ docId: string; fileName: string; score: number; excerpt: string }>
                error?: string
            }>
            queryStream: (question: string) => Promise<{
                success: boolean
                prompt?: string
                citations?: Array<{ docId: string; fileName: string; score: number; excerpt: string }>
                error?: string
            }>
            systemTemplate: () => Promise<{ role: string, content: string }>,
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
            getModelMode: () => Promise<'local' | 'online'>
            setModelMode: (mode: 'local' | 'online') => Promise<{ success: boolean; mode?: 'local' | 'online'; error?: string }>
            getOnlineApi: () => Promise<{ url: string; key: string; model: string }>
            setOnlineApi: (apiConfig: { url: string; key: string; model: string }) => Promise<{ success: boolean }>
        }
        online: {
            chatStream: (question: string) => Promise<{
                success: boolean
                prompt?: string
                citations?: Array<{ docId: string; fileName: string; score: number; excerpt: string }>
                error?: string
            }>
        }
        embedding: {
            status: () => Promise<{
                state: 'idle' | 'starting' | 'running' | 'error';
                message: string;
                gpuAvailable?: boolean;
                modelName?: string
            }>
        }
    }
}
