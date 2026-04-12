import { Readable } from 'stream'

export interface RagChunk {
  content: string
  citations?: {
    docId: string
    fileName: string
    score: number
    excerpt: string
  }[]
}

export class RagEngine {
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

  async query(question: string): Promise<{
    success: boolean
    answer?: string
    citations?: RagChunk['citations']
    error?: string
  }> {
    // 1. Search relevant chunks
    const searchResults = await this.indexManager.search(question, 5)

    if (searchResults.length === 0) {
      return {
        success: true,
        answer: 'No relevant documents found. Please import documents first.',
        citations: []
      }
    }

    // 2. Build context
    const context = searchResults
      .map((r, i) => `[Document ${i + 1}] ${r.fileName}\n${r.chunkText}`)
      .join('\n\n')

    // 3. Build prompt
    const prompt = this.queryTemplate
      .replace('{context}', context)
      .replace('{question}', question)

    // 4. Generate response
    const answer = await this.serverManager.generate(prompt)

    // 5. Build citations
    const citations = searchResults.map((r) => ({
      docId: r.docId,
      fileName: r.fileName,
      score: r.score,
      excerpt: r.chunkText.substring(0, 100) + '...'
    }))

    return { success: true, answer, citations }
  }

  async queryStream(question: string): Promise<Readable> {
    const searchResults = await this.indexManager.search(question, 5)

    const context =
      searchResults.length === 0
        ? '(No relevant documents found)'
        : searchResults
            .map((r, i) => `[Document ${i + 1}] ${r.fileName}\n${r.chunkText}`)
            .join('\n\n')

    const prompt = this.queryTemplate
      .replace('{context}', context)
      .replace('{question}', question)

    return this.serverManager.generateStream(prompt)
  }
}
