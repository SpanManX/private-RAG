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
    const currentCtrl = ref<AbortController | null>(null)  // 当前请求的 AbortController

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
            currentCtrl.value = ctrl  // 保存引用供 stopGenerating 使用
            // 获取当前对话服务的 URL（动态端口）
            const serverUrl = await window.api.server.getServerUrl()
            await fetchEventSource(`${serverUrl}/v1/chat/completions`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                    messages: [await window.api.rag.systemTemplate(), {role: 'user', content: result.prompt}],
                    stream: true,
                    return_progress : true,   // 返回进度信息
                    timings_per_token : true, // 逐词耗时统计
                    temperature: 0.1,
                    max_tokens: 2048
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
                    ctrl.abort()
                    console.error('SSE 错误:', error)
                    const msg = messages.value.find((m) => m.id === aiMessageId)
                    if (msg) {
                        msg.content += `错误: ${error}`
                    }
                    throw error; // 抛出错误以停止自动重试
                }
            })
        } catch (error) {
            const msg = messages.value.find((m) => m.id === aiMessageId)
            if (msg) {
                msg.content = `错误: ${error}`
            }
        }

        isGenerating.value = false
        currentCtrl.value = null
    }

    function clearHistory(): void {
        messages.value = []
    }

    /** 停止当前正在生成的响应 */
    function stopGenerating(): void {
        if (currentCtrl.value) {
            currentCtrl.value.abort()
            currentCtrl.value = null
            isGenerating.value = false
        }
    }

    return {
        messages,
        isGenerating,
        sendMessage,
        clearHistory,
        stopGenerating
    }
})
