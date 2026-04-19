/**
 * LanceDB 向量数据库管理器
 *
 * 职责：
 * 1. 管理文档分块（512 字符为一个 chunk）
 * 2. 存储文档向量（通过 llama-server embedding API 生成）
 * 3. 执行向量相似性搜索
 * 4. 追踪文档元数据
 *
 * 当前使用向量搜索（BGE-small-zh-v1.5 生成 384 维向量）
 */

import {join} from 'path'
import {existsSync, mkdirSync} from 'fs'
import {randomUUID} from 'crypto'
import * as lancedb from '@lancedb/lancedb'
import {Field, FixedSizeList, Float32, Int32, Utf8, Schema} from 'apache-arrow'
import {Index} from '@lancedb/lancedb'
import {log} from './logger'
import {getEmbeddings} from './langchain/embeddings'

/** 搜索结果结构 */
export interface SearchResult {
    docId: string       // 文档唯一 ID
    fileName: string    // 文件名
    chunkText: string   // 匹配的文本块
    score: number       // 相似度分数（余弦相似度）
}

/** 文档记录结构 */
export interface DocumentRecord {
    id: string          // 文档唯一 ID
    fileName: string    // 文件名
    createdAt: number   // 创建时间戳
    textLength: number  // 原始文本长度
}

/** 每个 chunk 的大小（字符数） */
const CHUNK_SIZE = 512
/**
 * Embedding 向量维度
 * bge-small-zh-v1.5 = 384 维
 **/
const EMBEDDING_DIM = 384

export class IndexManager {
    private db!: lancedb.Connection
    private table!: lancedb.Table
    // 内存中的文档记录缓存（用于 listDocuments）
    private docs: Map<string, DocumentRecord> = new Map()
    // LangChain Embeddings 实例
    private embeddings = getEmbeddings()

    constructor(private userDataPath: string) {
    }

    /**
     * 初始化 LanceDB 连接
     * - 连接或创建数据库（位于 userData/data 目录）
     * - 创建或打开 'chunks' 表
     * - 为向量列创建 IVF_PQ 索引
     */
    async initialize(): Promise<void> {
        const dbPath = join(this.userDataPath, 'data')

        // 确保数据目录存在
        if (!existsSync(dbPath)) {
            mkdirSync(dbPath, {recursive: true})
        }

        log(`LanceDB 数据库路径: ${dbPath}`)
        this.db = await lancedb.connect(dbPath)

        // 定义表 schema（使用 Apache Arrow 类型）
        const schema = new Schema([
            new Field('id', new Utf8()),
            new Field('docId', new Utf8()),
            new Field('fileName', new Utf8()),
            new Field('chunkIndex', new Int32()),
            new Field('chunkText', new Utf8()),
            // 384 维向量列（fixed_size_list）
            new Field('vector', new FixedSizeList(EMBEDDING_DIM, new Field('item', new Float32())))
        ])

        try {
            // 尝试打开已存在的表
            this.table = await this.db.openTable('chunks')
            log('LanceDB 表已打开')
            // 从 LanceDB 加载已存在的文档列表
            await this.loadDocuments()
        } catch {
            // 表不存在，创建新表
            this.table = await this.db.createEmptyTable('chunks', schema)
            log('LanceDB 表已创建（带向量列）')
            log(`向量维度: ${EMBEDDING_DIM}（bge-small-zh-v1.5）`)

            // 为 vector 列创建 IVF_PQ 索引（用于高效相似性搜索）
            await this.table.createIndex('vector', {
                config: Index.ivfPq({
                    numPartitions: 64,
                    numSubVectors: 96
                }),
                replace: true
            })
            log('向量索引已创建')
        }

        log(`LanceDB 初始化完成: ${dbPath}`)
    }

    /**
     * 从 LanceDB 加载已存在的文档列表
     * 在初始化时调用，用于恢复内存缓存
     */
    private async loadDocuments(): Promise<void> {
        try {
            // 获取所有唯一的 docId 和 fileName
            // 使用 distinct 查询获取唯一文档
            const chunks = await this.table.query().select(['docId', 'fileName']).toArray()

            // 按 docId 分组，收集每个文档的信息
            const docMap = new Map<string, DocumentRecord>()
            for (const chunk of chunks) {
                const r = chunk as any
                if (!docMap.has(r.docId)) {
                    docMap.set(r.docId, {
                        id: r.docId,
                        fileName: r.fileName,
                        createdAt: Date.now(), // LanceDB 不存储创建时间，用当前时间
                        textLength: 0 // LanceDB 不存储原始长度
                    })
                }
            }

            this.docs = docMap
            log(`从 LanceDB 加载了 ${this.docs.size} 个文档`)
        } catch (err) {
            log(`加载文档列表失败: ${err}`)
        }
    }

    /**
     * 将文本分块
     * - 按换行分割成段落
     * - 将段落合并成约 512 字符的块
     * - 过滤掉太短的块（< 10 字符）
     */
    chunkText(text: string): string[] {
        const chunks: string[] = []

        // 按换行分割段落
        const paragraphs = text.split(/\n+/).filter((p) => p.trim())
        let current = ''

        for (const para of paragraphs) {
            if ((current + para).length > CHUNK_SIZE) {
                // 当前块已满，保存并开始新块
                if (current) chunks.push(current.trim())
                current = para
            } else {
                current += '\n' + para
            }
        }
        // 处理最后一个块
        if (current.trim()) chunks.push(current.trim())

        // 过滤掉太短的块
        return chunks.filter((c) => c.length > 10)
    }

    /**
     * 添加文档到向量数据库
     * @param filePath 原始文件路径
     * @param text 解析后的纯文本
     * @returns 生成的文档 ID
     */
    async addDocument(filePath: string, text: string): Promise<string> {
        const docId = randomUUID()

        // 提取文件名（去掉路径）
        const fileName = filePath.split(/[/\\]/).pop() ?? filePath

        // 文本分块
        const chunks = this.chunkText(text)

        // 为每个 chunk 生成向量
        type ChunkRecord = {
            id: string
            docId: string
            fileName: string
            chunkIndex: number
            chunkText: string
            vector: number[]
        }
        const records: ChunkRecord[] = []
        for (let i = 0; i < chunks.length; i++) {
            const chunkText = chunks[i]
            // 调用 LangChain Embeddings 获取向量
            let embedding: number[]
            try {
                embedding = await this.embeddings.embedQuery(chunkText)
            } catch (err) {
                log(`Embedding 错误: ${err}，使用零向量`)
                embedding = Array(EMBEDDING_DIM).fill(0)
            }

            records.push({
                id: randomUUID(),
                docId,
                fileName,
                chunkIndex: i,
                chunkText,
                vector: embedding
            })
        }

        // 添加到 LanceDB
        await this.table.add(records)

        // 更新内存缓存
        this.docs.set(docId, {
            id: docId,
            fileName,
            createdAt: Date.now(),
            textLength: text.length
        })

        log(`文档已索引: ${fileName}, ${chunks.length} 个块`)
        return docId
    }

    /**
     * 向量化文档（带进度回调）
     * @param filePath 原始文件路径
     * @param text 解析后的纯文本
     * @param chunks 预分块的文本数组
     * @param onChunkProgress 每处理完一个 chunk 调用的回调，参数为 chunk 索引
     * @returns 生成的文档 ID
     */
    async addDocumentWithProgress(
        filePath: string,
        text: string,
        chunks: string[],
        onChunkProgress: (chunkIndex: number) => void
    ): Promise<string> {
        const docId = randomUUID()
        const fileName = filePath.split(/[/\\]/).pop() ?? filePath

        type ChunkRecord = {
            id: string
            docId: string
            fileName: string
            chunkIndex: number
            chunkText: string
            vector: number[]
        }
        const records: ChunkRecord[] = []

        for (let i = 0; i < chunks.length; i++) {
            const chunkText = chunks[i]
            let embedding: number[]
            try {
                embedding = await this.embeddings.embedQuery(chunkText)
            } catch (err) {
                log(`Embedding 错误: ${err}，使用零向量`)
                embedding = Array(EMBEDDING_DIM).fill(0)
            }

            records.push({
                id: randomUUID(),
                docId,
                fileName,
                chunkIndex: i,
                chunkText,
                vector: embedding
            })

            onChunkProgress(i)
        }

        await this.table.add(records)

        this.docs.set(docId, {
            id: docId,
            fileName,
            createdAt: Date.now(),
            textLength: text.length
        })

        log(`文档已索引: ${fileName}, ${chunks.length} 个块`)
        return docId
    }

    /**
     * 搜索相关文档块（向量相似性搜索）
     * @param query 查询文本
     * @param topK 返回最多 topK 个结果
     * @returns 匹配的搜索结果
     */
    async search(query: string, topK = 5): Promise<SearchResult[]> {
        try {
            // 1. 将查询文本转换为向量
            let queryVector: number[]
            try {
                queryVector = await this.embeddings.embedQuery(query)
                console.log(`查询 "${query}" 的向量前5维: ${queryVector.slice(0, 5).join(', ')}`)
            } catch (err) {
                log(`Query embedding 错误: ${err}`)
                return []
            }

            // 2. 执行向量相似性搜索
            // nearestTo 找到最近的向量，_distance 表示 L2 距离
            const results = await this.table
                .query()
                .nearestTo(queryVector)
                .limit(topK)
                .toArray()

            log(`搜索结果数量: ${results.length}, 距离: ${results.map(r => (r as any)._distance).join(', ')}`)

            // 过滤掉距离过大的结果（距离 > 0.8 表示相似度很低）
            const DISTANCE_THRESHOLD = 0.8
            return (Array.isArray(results) ? results : [])
                .filter((r: any) => (r as any)._distance < DISTANCE_THRESHOLD)
                .map((r: any) => ({
                    docId: r.docId as string,
                    fileName: r.fileName as string,
                    chunkText: r.chunkText as string,
                    score: Math.max(0, Math.exp(-(r._distance ?? 0)))
                }))
        } catch (error) {
            log(`搜索错误: ${error}`)
            return []
        }
    }

    /** 返回所有已导入文档的列表 */
    listDocuments(): DocumentRecord[] {
        return Array.from(this.docs.values())
    }

    /**
     * 删除文档及其所有块
     * @param docId 要删除的文档 ID
     */
    async deleteDocument(docId: string): Promise<void> {
        // 从 LanceDB 删除所有属于该文档的块
        await this.table.delete(`docId = '${docId}'`)
        // 从内存缓存移除
        this.docs.delete(docId)
        log(`文档已删除: ${docId}`)
    }

    /** 关闭连接 */
    async close(): Promise<void> {
        log('IndexManager 已关闭')
    }
}
