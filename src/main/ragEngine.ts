/**
 * RAG 引擎 - 检索增强生成核心逻辑
 *
 * 职责：
 * 1. 检索相关文档块（向量搜索）
 * 2. 构建包含上下文的 prompt
 * 3. 调用 llama-server 生成答案
 * 4. 返回答案和引用来源
 *
 * RAG（Retrieval-Augmented Generation）流程：
 * 用户问题 → 检索相似文档 → 构建 prompt → LLM 生成答案 → 返回答案+引用
 */

// import {ServerManager} from './serverManager'
import {IndexManager} from './indexManager'

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
    private queryTemplate: string = `参考文档：
{context}

问题：{question}`

    public systemTemplate: { role: string, content: string } = {
        role: "system",
        content: `
        # 任务描述
        你是一个文档助手。请根据提供的 [参考文档] 回答问题。
        
        # 约束规则
        1. 如果 [参考文档] 中没有包含问题的答案，请直接回复：“抱歉，在现有文件中未找到相关内容。”，然后根据你的知识库尝试回答用户的关联问题。
        2. 如果 [参考文档] 包含答案，请严格根据文档进行总结，不要胡言乱语。
        3. 如果 [参考文档] 包含答案，请在回答的最后引用相关文件。`
    }

    constructor(
        // private serverManager: ServerManager,
        private indexManager: IndexManager
    ) {
    }

    /**
     * 执行 RAG 查询（非流式）
     *
     * @param question 用户问题
     * @returns 查询结果（成功/失败、答案、引用）
     */
    // async query(question: string): Promise<{
    //     success: boolean
    //     answer?: string
    //     citations?: RagChunk['citations']
    //     error?: string
    // }> {
    //     // ===== 1. 检索相关文档块 =====
    //     const searchResults = await this.indexManager.search(question, 5)
    //
    //     // 没有相关文档
    //     if (searchResults.length === 0) {
    //         return {
    //             success: true,
    //             answer: '未找到相关文件。请先导入文件。',
    //             citations: []
    //         }
    //     }
    //
    //     // ===== 2. 构建上下文 =====
    //     const context = searchResults
    //         .map((r, i) => `[Document ${i + 1}] ${r.fileName}\n${r.chunkText}`)
    //         .join('\n\n')
    //
    //     // ===== 3. 构建 prompt =====
    //     const prompt = this.queryTemplate
    //         .replace('{context}', context)
    //         .replace('{question}', question)
    //
    //     // ===== 4. 生成答案 =====
    //     const answer = await this.serverManager.generate(prompt)
    //
    //     // ===== 5. 构建引用来源 =====
    //     const citations = searchResults.map((r) => ({
    //         docId: r.docId,
    //         fileName: r.fileName,
    //         score: r.score,
    //         excerpt: r.chunkText.substring(0, 100) + '...'
    //     }))
    //
    //     return {success: true, answer, citations}
    // }

    /**
     * 构建 RAG prompt（用于流式查询）
     * @param question 用户问题
     * @returns 包含上下文的 prompt
     */
    async buildPrompt(question: string): Promise<{ prompt: string; citations: RagChunk['citations'] }> {
        const searchResults = await this.indexManager.search(question, 5)

        if (searchResults.length === 0) {
            return {prompt: question, citations: []}
        }

        const context = searchResults
            .map((r, i) => `[Document ${i + 1}] ${r.fileName}\n${r.chunkText}`)
            .join('\n\n')

        const prompt = this.queryTemplate
            .replace('{context}', context)
            .replace('{question}', question)
        // 以下是 llama-server 的 prompt 原始格式，/completions 接口使用
        // const prompt = `<|im_start|>system\n你是一个中文助手。请直接、简洁地回答，不要进行自我思考<|im_end|>\n<|im_start|>user\n${question}<|im_end|>\n`

        const citations = searchResults.map((r) => ({
            docId: r.docId,
            fileName: r.fileName,
            score: r.score,
            excerpt: r.chunkText.substring(0, 100) + '...'
        }))
        return {prompt, citations}
    }
}
