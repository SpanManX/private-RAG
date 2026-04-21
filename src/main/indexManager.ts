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

type ChunkRecord = {
    id: string
    docId: string
    fileName: string
    chunkIndex: number
    chunkText: string
    vector: number[]
}

/** 每个 chunk 的大小（字符数） */
const CHUNK_SIZE = 512
const TABLE_NAME = 'chunks'

export class IndexManager {
    private db!: lancedb.Connection
    private table: lancedb.Table | null = null
    private embeddingDim: number | null = null
    // 内存中的文档记录缓存（用于 listDocuments）
    private docs: Map<string, DocumentRecord> = new Map()
    // LangChain Embeddings 实例
    private embeddings = getEmbeddings()
    // 索引是否已构建（避免重复建索引）
    private indexBuilt = false

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

        const tableNames = await this.db.tableNames()
        if (tableNames.includes(TABLE_NAME)) {
            this.table = await this.db.openTable(TABLE_NAME)
            this.embeddingDim = await this.getTableVectorDimension(this.table)
            this.indexBuilt = true  // 已有表假设已有索引
            log(`LanceDB 表已打开，向量维度: ${this.embeddingDim ?? 'unknown'}`)
            await this.loadDocuments()
        } else {
            // 不提前建表，等拿到 embedding 真实维度后再建
            this.table = null
            this.embeddingDim = null
            this.docs.clear()
            log('LanceDB 表尚未创建，将在首次向量化时按真实维度创建')
        }

        log(`LanceDB 初始化完成: ${dbPath}`)
    }

    /**
     * 构建 LanceDB 表的 Schema
     * @param embeddingDim 向量维度
     */
    private buildSchema(embeddingDim: number): Schema {
        return new Schema([
            new Field('id', new Utf8()),
            new Field('docId', new Utf8()),
            new Field('fileName', new Utf8()),
            new Field('chunkIndex', new Int32()),
            new Field('chunkText', new Utf8()),
            new Field('vector', new FixedSizeList(embeddingDim, new Field('item', new Float32())))
        ])
    }

    /**
     * 计算 IVF_PQ 索引的子向量数量
     * 子向量维度通常为 16 或 8 的倍数，以获得最佳性能
     */
    private recommendedNumSubVectors(dim: number): number {
        if (dim % 16 === 0) return Math.max(1, dim / 16)
        if (dim % 8 === 0) return Math.max(1, dim / 8)
        return 1
    }

    /**
     * 创建 chunks 表
     * @param embeddingDim 向量维度（由首个 embedding 决定）
     */
    private async createChunksTable(embeddingDim: number): Promise<void> {
        const schema = this.buildSchema(embeddingDim)
        this.table = await this.db.createEmptyTable(TABLE_NAME, schema)
        this.embeddingDim = embeddingDim
        log(`LanceDB 表已创建（向量维度: ${embeddingDim}）`)
        // 不在空表上建索引，等添加数据后再建
    }

    /** 在已有数据的表上创建向量索引（必须在有数据后才能调用） */
    private async buildVectorIndex(): Promise<void> {
        if (!this.table || !this.embeddingDim) return
        try {
            const rowCount = await this.table.countRows()
            // 数据量太少不建索引（IVF_PQ 需要足够数据）
            if (rowCount < 10) {
                log(`数据量太少（${rowCount} 个），跳过索引构建`)
                return
            }
            // 分区数不超过行数
            const numPartitions = Math.min(64, rowCount)
            await this.table.createIndex('vector', {
                config: Index.ivfPq({
                    numPartitions,
                    numSubVectors: this.recommendedNumSubVectors(this.embeddingDim)
                }),
                replace: true
            })
            log(`向量索引已创建（${numPartitions} 个分区，${rowCount} 个向量）`)
        } catch (err) {
            log(`建索引失败（非严重）: ${err}`)
        }
    }

    /**
     * 从表 Schema 中提取向量维度
     * @param table LanceDB 表实例
     * @returns 向量维度，或 null 如果无法获取
     */
    private async getTableVectorDimension(table: lancedb.Table): Promise<number | null> {
        const schema = await table.schema()
        const vectorField = schema.fields.find((f) => f.name === 'vector')
        if (!vectorField) return null
        const vectorType = vectorField.type as any
        if (!vectorType || typeof vectorType.listSize !== 'number') return null
        return vectorType.listSize
    }

    /**
     * 确保表已创建且维度匹配
     * 如果表不存在或维度不匹配，会自动重建
     * @param dim 期望的向量维度
     */
    private async ensureTableForDimension(dim: number): Promise<void> {
        if (!this.table) {
            await this.createChunksTable(dim)
            return
        }

        const tableDim = this.embeddingDim ?? (await this.getTableVectorDimension(this.table))
        if (tableDim === dim) {
            this.embeddingDim = dim
            return
        }

        const rows = await this.table.countRows()
        if (rows === 0) {
            log(`检测到空表维度不匹配（table=${tableDim}, embedding=${dim}），自动重建表`)
            this.table.close()
            await this.db.dropTable(TABLE_NAME)
            this.docs.clear()
            this.indexBuilt = false
            await this.createChunksTable(dim)
            return
        }

        throw new Error(
            `Embedding dimension mismatch: current index=${tableDim}, model output=${dim}. ` +
            `Please delete existing documents and re-import.`
        )
    }

    /**
     * 从 LanceDB 加载已存在的文档列表
     * 在初始化时调用，用于恢复内存缓存
     */
    private async loadDocuments(): Promise<void> {
        if (!this.table) {
            this.docs.clear()
            return
        }
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
     * 验证 embedding 向量的有效性
     * @param embedding 向量数组
     * @param context 上下文信息（用于错误提示）
     * @throws 如果向量无效（类型错误、维度不匹配、包含非有限值）
     */
    private validateEmbeddingOrThrow(embedding: number[], context: string): number[] {
        if (!Array.isArray(embedding)) {
            throw new Error(`Invalid embedding type (${context})`)
        }
        const expectedDim = this.embeddingDim ?? embedding.length
        if (!this.embeddingDim) {
            this.embeddingDim = expectedDim
        }
        if (embedding.length !== expectedDim) {
            throw new Error(
                `Invalid embedding dimension (${context}): expected ${expectedDim}, got ${embedding.length}`
            )
        }
        if (embedding.some((value) => !Number.isFinite(value))) {
            throw new Error(`Embedding contains non-finite values (${context})`)
        }
        return embedding
    }

    /**
     * 生成文本的 embedding 向量
     * @param text 要向量化的文本
     * @param context 上下文信息（用于错误提示）
     */
    private async embedOrThrow(text: string, context: string): Promise<number[]> {
        const embedding = await this.embeddings.embedQuery(text)
        return this.validateEmbeddingOrThrow(embedding, context)
    }

    /**
     * 添加文档到向量数据库
     * @param filePath 原始文件路径
     * @param text 解析后的纯文本
     * @returns 生成的文档 ID
     */
    async addDocument(filePath: string, text: string): Promise<string> {
        const docId = randomUUID()
        const fileName = filePath.split(/[/\\]/).pop() ?? filePath
        const chunks = this.chunkText(text)

        await this._processChunks(docId, fileName, chunks)

        this.docs.set(docId, {id: docId, fileName, createdAt: Date.now(), textLength: text.length})
        log(`文档已索引: ${fileName}, ${chunks.length} 个块`)
        return docId
    }

    /**
     * 向量化文档（带进度回调）
     * @param filePath 原始文件路径
     * @param text 解析后的纯文本
     * @param chunks 预分块的文本数组
     * @param onChunkProgress 每处理完一个 chunk 调用的回调
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

        await this._processChunks(docId, fileName, chunks, onChunkProgress)

        this.docs.set(docId, {id: docId, fileName, createdAt: Date.now(), textLength: text.length})
        log(`文档已索引: ${fileName}, ${chunks.length} 个块`)
        return docId
    }

    /**
     * 公共逻辑：处理 chunk 向量化和存储
     */
    private async _processChunks(
        docId: string,
        fileName: string,
        chunks: string[],
        onChunkProgress?: (chunkIndex: number) => void
    ): Promise<void> {
        if (chunks.length === 0) {
            throw new Error(`No valid chunks generated for file: ${fileName}`)
        }

        const records: ChunkRecord[] = []

        for (let i = 0; i < chunks.length; i++) {
            const embedding = await this.embedOrThrow(chunks[i], `doc=${docId}, file=${fileName}, chunk=${i}`)

            if (i === 0) {
                await this.ensureTableForDimension(embedding.length)
            }

            records.push({id: randomUUID(), docId, fileName, chunkIndex: i, chunkText: chunks[i], vector: embedding})
            onChunkProgress?.(i)
        }

        if (!this.table) {
            throw new Error('Vector table is not initialized')
        }
        await this.table.add(records)

        if (!this.indexBuilt) {
            this.indexBuilt = true
            await this.buildVectorIndex()
        }
    }

    /**
     * 搜索相关文档块（向量相似性搜索）
     * @param query 查询文本
     * @param topK 返回最多 topK 个结果
     * @returns 匹配的搜索结果
     */
    async search(query: string, topK = 5): Promise<SearchResult[]> {
        if (!this.table) {
            return []
        }
        try {
            // 1. 将查询文本转换为向量
            let queryVector: number[]
            try {
                queryVector = this.validateEmbeddingOrThrow(
                    await this.embeddings.embedQuery(query),
                    `query=${query.slice(0, 40)}`
                )
                await this.ensureTableForDimension(queryVector.length)
                console.log(`[Search] 查询 "${query}" 向量维度: ${queryVector.length}, 前5维: ${queryVector.slice(0, 5).join(', ')}`)
            } catch (err) {
                log(`Query embedding 错误: ${err}`)
                return []
            }

            // 2. 执行向量相似性搜索
            const results = await this.table
                .query()
                .nearestTo(queryVector)
                .limit(topK)
                .toArray()

            console.log(`[Search] 原始结果: ${results.length}, 距离: ${results.map(r => (r as any)._distance).join(', ')}`)

            // 过滤掉距离过大的结果（距离 < 1.5，约等于余弦相似度 > 0.22）
            const DISTANCE_THRESHOLD = 1.5
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
        if (!this.table) {
            this.docs.delete(docId)
            return
        }
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
