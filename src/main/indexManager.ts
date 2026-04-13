/**
 * LanceDB 向量数据库管理器
 *
 * 职责：
 * 1. 管理文档分块（512 字符为一个 chunk）
 * 2. 存储文档向量（未来集成 embedding 时启用）
 * 3. 创建和维护全文搜索索引（FTS）
 * 4. 执行相似性搜索
 * 5. 追踪文档元数据
 *
 * 当前使用全文搜索（Full-Text Search）
 * 未来可扩展为向量搜索（需要 llama-server embedding API）
 */

import { join } from 'path'
import { existsSync, mkdirSync } from 'fs'
import { randomUUID } from 'crypto'
import * as lancedb from '@lancedb/lancedb'
import { Index } from '@lancedb/lancedb'
import { log } from './logger'

/** 搜索结果结构 */
export interface SearchResult {
  docId: string       // 文档唯一 ID
  fileName: string    // 文件名
  chunkText: string   // 匹配的文本块
  score: number       // 相似度分数
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

export class IndexManager {
  private db!: lancedb.Connection
  private table!: lancedb.Table
  // 内存中的文档记录缓存（用于 listDocuments）
  private docs: Map<string, DocumentRecord> = new Map()

  constructor(private userDataPath: string) {}

  /**
   * 初始化 LanceDB 连接
   * - 连接或创建数据库（位于 userData/data 目录）
   * - 创建或打开 'chunks' 表
   * - 为 chunkText 列创建全文搜索索引
   */
  async initialize(): Promise<void> {
    const dbPath = join(this.userDataPath, 'data')

    // 确保数据目录存在
    if (!existsSync(dbPath)) {
      mkdirSync(dbPath, { recursive: true })
    }

    log(`LanceDB 数据库路径: ${dbPath}`)
    this.db = await lancedb.connect(dbPath)

    try {
      // 尝试打开已存在的表
      this.table = await this.db.openTable('chunks')
      log('LanceDB 表已打开')
    } catch {
      // 表不存在，创建新表
      this.table = await this.db.createTable('chunks', [
        { name: 'id', type: 'utf8' },              // 每条记录的唯一 ID
        { name: 'docId', type: 'utf8' },          // 所属文档的 ID
        { name: 'fileName', type: 'utf8' },        // 文件名
        { name: 'chunkIndex', type: 'int32' },     // 在文档中的块序号
        { name: 'chunkText', type: 'utf8' }        // 块文本内容
      ])
      log('LanceDB 表已创建')

      // 为 chunkText 列创建全文搜索索引（FTS）
      await this.table.createIndex('chunkText', {
        config: Index.fts(),
        replace: true
      })
      log('全文搜索索引已创建')
    }

    log(`LanceDB 初始化完成: ${dbPath}`)
  }

  /**
   * 将文本分块
   * - 按换行分割成段落
   * - 将段落合并成约 512 字符的块
   * - 过滤掉太短的块（< 10 字符）
   */
  private chunkText(text: string): string[] {
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

    // 构建记录
    const records = chunks.map((chunkText, chunkIndex) => ({
      id: randomUUID(),
      docId,
      fileName,
      chunkIndex,
      chunkText
    }))

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
   * 搜索相关文档块（全文搜索）
   * @param query 查询文本
   * @param topK 返回最多 topK 个结果
   * @returns 匹配的搜索结果
   */
  async search(query: string, topK = 5): Promise<SearchResult[]> {
    try {
      // 使用全文搜索查询
      const results = await this.table.query()
        .fullTextSearch(query)
        .limit(topK)
        .toArray()

      return (Array.isArray(results) ? results : []).map(
        (r: any) => ({
          docId: r.docId as string,
          fileName: r.fileName as string,
          chunkText: r.chunkText as string,
          score: 0.8  // 全文搜索不返回分数，统一设为 0.8
        })
      )
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
