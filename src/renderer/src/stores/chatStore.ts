import {defineStore} from 'pinia'
import {ref} from 'vue'
import {fetchEventSource} from '@microsoft/fetch-event-source'

export interface Message {
    id: string
    role: 'user' | 'assistant'
    content: string
    citations?: Citation[]
    timestamp: number
}

export interface Citation {
    docId: string
    fileName: string
    score: number
    excerpt: string
}

export const useChatStore = defineStore('chat', () => {
    const messages = ref<Message[]>([])
    const isGenerating = ref(false)

    async function sendMessage(question: string): Promise<void> {
        // 添加用户消息
        const userMessage: Message = {
            id: crypto.randomUUID(),
            role: 'user',
            content: question,
            timestamp: Date.now()
        }
        messages.value.push(userMessage)

        // 添加占位 AI 消息
        const aiMessageId = crypto.randomUUID()
        const aiMessage: Message = {
            id: aiMessageId,
            role: 'assistant',
            content: '',
            timestamp: Date.now()
        }
        messages.value.push(aiMessage)
        isGenerating.value = true

        try {
            // 获取 prompt 和引用
            const result = await window.api.rag.queryStream(question)

            if (!result.success || result.error) {
                const msg = messages.value.find((m) => m.id === aiMessageId)
                if (msg) {
                    msg.content = `错误: ${result.error || '未知错误'}`
                }
                isGenerating.value = false
                return
            }

            // 保存引用
            const msg = messages.value.find((m) => m.id === aiMessageId)
            if (msg) {
                msg.citations = result.citations
            }

            // 使用 fetch-event-source 接收 SSE 流
            const ctrl = new AbortController()
            await fetchEventSource('http://localhost:8080/v1/chat/completions', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                    messages: [await window.api.rag.systemTemplate(), {role: 'user', content: result.prompt}],
                    stream: true,
                    temperature: 0.1,
                    max_tokens: 1024
                }),
                signal: ctrl.signal,
                onmessage(ev) {
                    if (ev.data) {
                        try {
                            const json = JSON.parse(ev.data)
                            if (json.choices?.[0]?.delta?.content) {
                                const content = json.choices[0].delta.content
                                const msg = messages.value.find((m) => m.id === aiMessageId)
                                if (msg) {
                                    msg.content += content
                                }
                            }
                            if (json.choices?.[0]?.finish_reason === 'stop') {
                                ctrl.abort()
                            }
                        } catch {
                        }
                    }
                },
                onerror(error) {
                    console.error('SSE 错误:', error)
                    const msg = messages.value.find((m) => m.id === aiMessageId)
                    if (msg) {
                        msg.content += `\n\n错误: ${error}`
                    }
                }
            })
        } catch (error) {
            const msg = messages.value.find((m) => m.id === aiMessageId)
            if (msg) {
                msg.content = `错误: ${error}`
            }
        }

        isGenerating.value = false
    }

    function clearHistory(): void {
        messages.value = []
    }

    return {
        messages,
        isGenerating,
        sendMessage,
        clearHistory
    }
})
