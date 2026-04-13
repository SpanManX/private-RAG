/**
 * RAG 引擎 - 检索增强生成核心逻辑
 *
 * 职责：
 * 1. 检索相关文档块（调用 IndexManager 全文搜索）
 * 2. 构建包含上下文的 prompt
 * 3. 调用 llama-server 生成答案
 * 4. 返回答案和引用来源
 *
 * RAG（Retrieval-Augmented Generation）流程：
 * 用户问题 → 检索相似文档 → 构建 prompt → LLM 生成答案 → 返回答案+引用
 */

import { Readable } from 'stream'
import { ServerManager } from './serverManager'
import { IndexManager } from './indexManager'

/** RAG 答案块 */
export interface RagChunk {
  content: string
  /** 引用来源列表 */
  citations?: {
    docId: string       // 文档 ID
    fileName: string    // 文件名
    score: number       // 相似度分数
    excerpt: string     // 文档摘录（前 100 字符）
  }[]
}

/**
 * RAG 引擎类
 * 编排检索和生成流程
 */
export class RagEngine {
  /**
   * RAG prompt 模板
   * - 要求模型基于参考文档回答
   * - 如果文档不相关则如实说明
   * - 要求引用文档来源
   */
  private queryTemplate = `Please answer the user's question based on the reference documents.
If the reference documents do not contain relevant information, state so honestly.

---
{context}
---

User question: {question}

Please provide an accurate and concise answer, citing the document sources.`

  constructor(
    private serverManager: ServerManager,
    private indexManager: IndexManager
  ) {}

  /**
   * 执行 RAG 查询（非流式）
   *
   * 流程：
   * 1. 使用全文搜索检索 top-5 相关文档块
   * 2. 如果没有相关文档，返回提示信息
   * 3. 构建包含上下文的 prompt
   * 4. 调用 llama-server 生成答案
   * 5. 构建引用来源列表
   *
   * @param question 用户问题
   * @returns 查询结果（成功/失败、答案、引用）
   */
  async query(question: string): Promise<{
    success: boolean
    answer?: string
    citations?: RagChunk['citations']
    error?: string
  }> {
    // ===== 1. 检索相关文档块 =====
    const searchResults = await this.indexManager.search(question, 5)

    // 没有相关文档
    if (searchResults.length === 0) {
      return {
        success: true,
        answer: 'No relevant documents found. Please import documents first.',
        citations: []
      }
    }

    // ===== 2. 构建上下文 =====
    // 格式：[Document 1] 文件名\n 文档内容
    const context = searchResults
      .map((r, i) => `[Document ${i + 1}] ${r.fileName}\n${r.chunkText}`)
      .join('\n\n')

    // ===== 3. 构建 prompt =====
    const prompt = this.queryTemplate
      .replace('{context}', context)
      .replace('{question}', question)

    // ===== 4. 生成答案 =====
    const answer = await this.serverManager.generate(prompt)

    // ===== 5. 构建引用来源 =====
    const citations = searchResults.map((r) => ({
      docId: r.docId,
      fileName: r.fileName,
      score: r.score,
      excerpt: r.chunkText.substring(0, 100) + '...'
    }))

    return { success: true, answer, citations }
  }

  /**
   * 执行 RAG 查询（流式）
   * 与 query() 类似，但通过流式接口实时返回生成内容
   *
   * @param question 用户问题
   * @returns Node.js Readable 流，逐步输出生成内容
   */
  async queryStream(question: string): Promise<Readable> {
    // 检索相关文档
    const searchResults = await this.indexManager.search(question, 5)

    // 构建上下文
    const context =
      searchResults.length === 0
        ? '(No relevant documents found)'
        : searchResults
            .map((r, i) => `[Document ${i + 1}] ${r.fileName}\n${r.chunkText}`)
            .join('\n\n')

    // 构建 prompt
    const prompt = this.queryTemplate
      .replace('{context}', context)
      .replace('{question}', question)

    // 返回流式响应
    return this.serverManager.generateStream(prompt)
  }
}
