import {defineStore} from 'pinia'
import {ref} from 'vue'
import {fetchEventSource, FetchEventSourceInit} from '@microsoft/fetch-event-source'

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

function createThinkFilter() {
    let inThink = false
    let buffer = ''

    return (chunk: string) => {
        buffer += chunk
        let out = ''

        while (buffer.length) {
            if (!inThink) {
                const i = buffer.indexOf('<think>')
                if (i === -1) {
                    out += buffer
                    buffer = ''
                } else {
                    out += buffer.slice(0, i)
                    buffer = buffer.slice(i + 7)
                    inThink = true
                }
            } else {
                const i = buffer.indexOf('</think>')
                if (i === -1) {
                    buffer = ''
                } else {
                    buffer = buffer.slice(i + 8)
                    inThink = false
                }
            }
        }

        return out
    }
}

/**
 * SSE 事件处理器工厂
 * 抽取在线/本地模式的公共逻辑，仅内容回调不同
 */
function createSSEHandlers(
    msg: Message | undefined,
    ctrl: AbortController,
    filterThink: boolean
): Pick<FetchEventSourceInit, 'onmessage' | 'onerror'> {
    const thinkFilter = filterThink ? createThinkFilter() : null

    return {
        onmessage(ev) {
            if (!ev.data || !msg) return

            try {
                const json = JSON.parse(ev.data)

                const content =
                    json.choices?.[0]?.delta?.content ??
                    json.choices?.[0]?.message?.content

                if (!content) return

                msg.content += thinkFilter
                    ? thinkFilter(content)
                    : content

                if (json.choices?.[0]?.finish_reason === 'stop') {
                    ctrl.abort()
                }

            } catch (e) {
                console.error('SSE parse error:', ev.data)
            }
        },

        onerror(error) {
            ctrl.abort()
            console.error('SSE 错误:', error)
            if (msg) msg.content += `错误: ${error}`
            throw error
        }
    }
}

export const useChatStore = defineStore('chat', () => {
    const messages = ref<Message[]>([])
    const isGenerating = ref(false)
    const currentCtrl = ref<AbortController | null>(null)

    async function sendMessage(question: string): Promise<void> {
        const userMessage: Message = {
            id: crypto.randomUUID(),
            role: 'user',
            content: question,
            timestamp: Date.now()
        }
        messages.value.push(userMessage)

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
            const modelMode = await window.api.config.getModelMode()

            let result
            if (modelMode === 'online') {
                result = await window.api.online.chatStream(question)
            } else {
                result = await window.api.rag.queryStream(question)
            }
            const msg = messages.value.find((m) => m.id === aiMessageId)
            if (!result.success || result.error) {
                if (msg) {
                    msg.content = `错误: ${result.error || '未知错误'}`
                }
                isGenerating.value = false
                return
            }

            if (msg) {
                msg.citations = result.citations
            }

            const ctrl = new AbortController()
            currentCtrl.value = ctrl

            if (modelMode === 'online') {
                const apiConfig = await window.api.config.getOnlineApi()
                const systemTemplate = await window.api.rag.systemTemplate()
                await fetchEventSource(`${apiConfig.url}/chat/completions`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${apiConfig.key}`
                    },
                    body: JSON.stringify({
                        model: apiConfig.model,
                        temperature: 0.1,
                        messages: [
                            systemTemplate,
                            {role: 'user', content: result.prompt}
                        ],
                        stream: true
                    }),
                    signal: ctrl.signal,
                    ...createSSEHandlers(msg, ctrl, true)  // filterThink = true
                })
            } else {
                const serverUrl = await window.api.server.getServerUrl()
                await fetchEventSource(`${serverUrl}/v1/chat/completions`, {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({
                        messages: [await window.api.rag.systemTemplate(), {role: 'user', content: result.prompt}],
                        stream: true,
                        return_progress: true,
                        timings_per_token: true,
                        temperature: 0.1,
                        max_tokens: 2048
                    }),
                    signal: ctrl.signal,
                    ...createSSEHandlers(msg, ctrl, false)  // filterThink = false
                })
            }
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
