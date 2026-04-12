import { join } from 'path'
import { existsSync, mkdirSync } from 'fs'
import { randomUUID } from 'crypto'
import * as lancedb from '@lancedb/lancedb'
import { log } from './logger'

export interface SearchResult {
  docId: string
  fileName: string
  chunkText: string
  score: number
}

export interface DocumentRecord {
  id: string
  fileName: string
  createdAt: number
  textLength: number
}

const CHUNK_SIZE = 512

export class IndexManager {
  private db!: lancedb.Connection
  private table!: lancedb.Table
  private docs: Map<string, DocumentRecord> = new Map()

  constructor(private userDataPath: string) {}

  async initialize(): Promise<void> {
    const dbPath = join(this.userDataPath, 'data')
    if (!existsSync(dbPath)) {
      mkdirSync(dbPath, { recursive: true })
    }

    this.db = await lancedb.connect(dbPath)

    try {
      this.table = await this.db.openTable('chunks')
    } catch {
      this.table = await this.db.createTable('chunks', [
        { name: 'id', type: 'utf8' },
        { name: 'docId', type: 'utf8' },
        { name: 'fileName', type: 'utf8' },
        { name: 'chunkIndex', type: 'int32' },
        { name: 'chunkText', type: 'utf8' }
      ])
      log('LanceDB table created')
    }

    log(`LanceDB initialized at: ${dbPath}`)
  }

  private chunkText(text: string): string[] {
    const chunks: string[] = []
    const paragraphs = text.split(/\n+/).filter((p) => p.trim())
    let current = ''

    for (const para of paragraphs) {
      if ((current + para).length > CHUNK_SIZE) {
        if (current) chunks.push(current.trim())
        current = para
      } else {
        current += '\n' + para
      }
    }
    if (current.trim()) chunks.push(current.trim())

    return chunks.filter((c) => c.length > 10)
  }

  async addDocument(filePath: string, text: string): Promise<string> {
    const docId = randomUUID()
    const fileName = filePath.split(/[/\\]/).pop() ?? filePath
    const chunks = this.chunkText(text)

    const records = chunks.map((chunkText, chunkIndex) => ({
      id: randomUUID(),
      docId,
      fileName,
      chunkIndex,
      chunkText
    }))

    await this.table.add(records)
    this.docs.set(docId, {
      id: docId,
      fileName,
      createdAt: Date.now(),
      textLength: text.length
    })

    log(`Document indexed: ${fileName}, ${chunks.length} chunks`)
    return docId
  }

  async search(query: string, topK = 5): Promise<SearchResult[]> {
    try {
      const results = await this.table.search(query).limit(topK).execute()
      return (Array.isArray(results) ? results : []).map(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (r: any) => ({
          docId: r.docId as string,
          fileName: r.fileName as string,
          chunkText: r.chunkText as string,
          score: 0.8
        })
      )
    } catch (error) {
      log(`Search error: ${error}`)
      return []
    }
  }

  listDocuments(): DocumentRecord[] {
    return Array.from(this.docs.values())
  }

  async deleteDocument(docId: string): Promise<void> {
    await this.table.delete(`docId = '${docId}'`)
    this.docs.delete(docId)
    log(`Document deleted: ${docId}`)
  }

  async close(): Promise<void> {
    log('IndexManager closed')
  }
}
