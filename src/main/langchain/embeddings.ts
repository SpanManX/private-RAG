/**
 * LangChain Embeddings 模块
 *
 * 封装 llama-server 的 Embedding API 为 LangChain 兼容接口
 */

import {Embeddings} from '@langchain/core/embeddings'
import http from 'http'


/**
 * LangChain Embeddings 实现，调用 llama-server Embedding API
 */
export class LlamaEmbeddings extends Embeddings {
  constructor() {
    super({})
  }

  /**
   * 嵌入单个文本
   */
  async embedQuery(text: string): Promise<number[]> {
    return this.embedText(text)
  }

  /**
   * 嵌入多个文本
   */
  async embedDocuments(texts: string[]): Promise<number[][]> {
    return Promise.all(texts.map((t) => this.embedText(t)))
  }

  /**
   * 调用 llama-server embedding API
   */
  private embedText(text: string): Promise<number[]> {
    return new Promise((resolve, reject) => {
      const body = JSON.stringify({input: text})

      const req = http.request(
        {
          host: '127.0.0.1',
          port: 8080,
          path: '/embedding',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body)
          }
        },
        (res) => {
          let data = ''
          res.on('data', (chunk) => (data += chunk))
          res.on('end', () => {
            try {
              const parsed = JSON.parse(data)

              // llama-server 返回格式: [{"index":0,"embedding":[[...],...]}] 或 {"embedding": [...]}
              let embedding: number[]
              if (Array.isArray(parsed)) {
                const emb = parsed[0]?.embedding
                embedding = Array.isArray(emb) ? (Array.isArray(emb[0]) ? emb[0] : emb) : []
              } else {
                embedding = parsed.embedding || []
              }

              // 归一化向量（L2 norm）
              const norm = Math.sqrt(
                embedding.reduce((sum: number, v: number) => sum + v * v, 0)
              )
              const normalized = norm > 0 ? embedding.map((v: number) => v / norm) : embedding

              resolve(normalized)
            } catch {
              reject(new Error(`Embedding parse error: ${data}`))
            }
          })
        }
      )

      req.on('error', reject)
      req.write(body)
      req.end()
    })
  }
}

// 导出单例
let embeddingsInstance: LlamaEmbeddings | null = null

export function getEmbeddings(): LlamaEmbeddings {
  if (!embeddingsInstance) {
    embeddingsInstance = new LlamaEmbeddings()
  }
  return embeddingsInstance
}
