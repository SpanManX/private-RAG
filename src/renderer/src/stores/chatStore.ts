import { defineStore } from 'pinia'
import { ref } from 'vue'

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

    // 监听流式响应
    window.api.rag.onChunk((chunk: string) => {
      const msg = messages.value.find((m) => m.id === aiMessageId)
      if (msg) {
        msg.content += chunk
      }
    })

    window.api.rag.onEnd(async () => {
      isGenerating.value = false
      // 保存引用
      const msg = messages.value.find((m) => m.id === aiMessageId)
      if (msg) {
        msg.citations = []
      }
    })

    window.api.rag.onError((error: string) => {
      const msg = messages.value.find((m) => m.id === aiMessageId)
      if (msg) {
        msg.content = `错误: ${error}`
      }
      isGenerating.value = false
    })

    // 发起请求（非流式，作为降级方案）
    const result = await window.api.rag.query(question)
    if (result.success && result.answer) {
      const msg = messages.value.find((m) => m.id === aiMessageId)
      if (msg) {
        msg.content = result.answer
        msg.citations = result.citations ?? []
      }
    } else if (result.error) {
      const msg = messages.value.find((m) => m.id === aiMessageId)
      if (msg) {
        msg.content = `错误: ${result.error}`
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
