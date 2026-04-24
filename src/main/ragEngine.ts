/**
 * RAG 引擎 - 检索增强生成核心逻辑
 *
 * 使用 LangChain 简化：
 * - Document 类型统一文档格式
 * - ChatPromptTemplate 管理提示词模板
 */

import {Document} from '@langchain/core/documents'
import {IndexManager} from './indexManager'

/** 检索结果（文档引用） */
export interface RagCitation {
    docId: string
    fileName: string
    score: number
    excerpt: string
}

export class RagEngine {
    /** 系统提示模板（LangChain Message 格式） */
    public systemTemplate = {
        role: 'system',
        content: `# 任务描述
你是一个文档助手。请根据提供的 [参考文档] 回答问题。

# 约束规则
1. 不要输出思考过程。
2. 如果 [参考文档] 中没有包含问题的答案，请先回复："抱歉，在现有文件中未找到相关内容。"，然后必须根据你的通用知识库，对用户提到的关键词进行科普或回答。
3. 如果 [参考文档] 包含答案，请严格根据文档进行总结，不要胡言乱语。
4. 如果 [参考文档] 包含答案，引用时请使用文档的实际文件名。`
    }

    constructor(private indexManager: IndexManager) {}

    /**
     * 构建 RAG prompt（用于流式查询）
     * @param question 用户问题
     * @returns 包含上下文的 prompt 和引用来源
     */
    async buildPrompt(question: string): Promise<{prompt: string; citations: RagCitation[]}> {
        const searchResults = await this.indexManager.search(question, 5)
        console.log('[RAG] 搜索结果:', searchResults.length, '条')

        if (searchResults.length === 0) {
            return {
                prompt: `请根据你的知识回答以下问题：
                question：${question}`,
                citations: []
            }
        }

        // 使用 LangChain Document 封装搜索结果（统一文档格式）
        const docs = searchResults.map((r) =>
            new Document({
                pageContent: r.chunkText,
                metadata: {docId: r.docId, fileName: r.fileName, score: r.score}
            })
        )

        // 合成上下文字符串
        const context = docs
            .map((d) => `文件：${d.metadata.fileName}\n${d.pageContent}`)
            .join('\n\n')

        // 构建最终 prompt
        const prompt = `[参考文档]：
${context}

question：${question}`

        // 构建引用来源（按文档去重，每个文档只保留最高分的分块）
        const citationMap = new Map<string, RagCitation>()
        for (const r of searchResults) {
            const existing = citationMap.get(r.docId)
            if (!existing || r.score > existing.score) {
                citationMap.set(r.docId, {
                    docId: r.docId,
                    fileName: r.fileName,
                    score: r.score,
                    excerpt: r.chunkText.substring(0, 100) + '...'
                })
            }
        }
        const citations = Array.from(citationMap.values())

        return {prompt, citations}
    }
}
