<script setup lang="ts">
import {ref, nextTick, onMounted} from 'vue'
import {useChatStore} from '@/stores/chatStore'
import {useDocumentStore} from '@/stores/documentStore'
import MessageBubble from './MessageBubble.vue'

const chatStore = useChatStore()
const documentStore = useDocumentStore()
const inputText = ref('')
const chatContainer = ref<HTMLElement | null>(null)
const showOfflineTip = ref(false)

onMounted(async () => {
  await documentStore.fetchServerStatus()
  scrollToBottom()
})

async function handleSend(): Promise<void> {
  const text = inputText.value.trim()
  if (!text || chatStore.isGenerating) return

  if (!documentStore.isServerRunning) {
    showOfflineTip.value = true
    setTimeout(() => {
      showOfflineTip.value = false
    }, 3000)
    return
  }

  inputText.value = ''
  await chatStore.sendMessage(text)
  await nextTick()
  scrollToBottom()
}

function scrollToBottom(): void {
  if (chatContainer.value) {
    chatContainer.value.scrollTop = chatContainer.value.scrollHeight
  }
}

function handleKeydown(e: KeyboardEvent): void {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    handleSend()
  }
}
</script>

<template>
  <main class="chat-area">
    <!-- 欢迎页 -->
    <div v-if="chatStore.messages.length === 0" class="welcome">
      <div class="welcome-icon">🔒</div>
      <h2 class="welcome-title">个人私密知识库</h2>
      <p class="welcome-desc">
        导入您的文档，随时通过自然语言提问。<br/>所有数据仅在本地处理，隐私安全。
      </p>
    </div>

    <!-- 消息列表 -->
    <div ref="chatContainer" class="messages">
      <MessageBubble
          v-for="(msg, i) in chatStore.messages"
          :is-last-msg="i === chatStore.messages.length - 1"
          :message="msg"
      />
    </div>

    <!-- 服务未启动提示条 -->
    <div v-if="showOfflineTip" class="offline-tip-bar">
      服务未启动，无法发送消息
    </div>

    <!-- 输入区 -->
    <div class="input-area">
      <textarea
          v-model="inputText"
          class="input-box"
          placeholder="输入问题，按 Enter 发送..."
          rows="1"
          :disabled="chatStore.isGenerating"
          @keydown="handleKeydown"
      />
      <!-- 停止按钮 -->
      <button
          v-if="chatStore.isGenerating"
          class="stop-btn"
          @click="chatStore.stopGenerating()"
      >
        ⏹ 停止
      </button>
      <!-- 发送按钮 -->
      <button
          v-else
          class="send-btn"
          :disabled="!inputText.trim() || chatStore.isGenerating"
          @click="handleSend"
      >
        发送
      </button>
    </div>
  </main>
</template>

<style scoped>
.chat-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  background: #f9fafb;
  overflow: hidden;
}

.welcome {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  flex: 1;
  gap: 12px;
  color: #6b7280;
}

.welcome-icon {
  font-size: 48px;
}

.welcome-title {
  font-size: 20px;
  font-weight: 600;
  color: #1f2937;
}

.welcome-desc {
  font-size: 14px;
  text-align: center;
  line-height: 1.6;
  max-width: 360px;
}

.messages {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
}

.offline-tip-bar {
  padding: 8px 20px;
  background: #f3f4f6;
  color: #6b7280;
  font-size: 13px;
  text-align: center;
  border-bottom: 1px solid #e5e7eb;
}

.input-area {
  padding: 12px 20px 16px;
  background: #f9fafb;
  display: flex;
  gap: 10px;
  align-items: flex-end;
}

.input-box {
  flex: 1;
  padding: 10px 14px;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  font-size: 14px;
  font-family: inherit;
  resize: none;
  outline: none;
  background: white;
  transition: border-color 0.15s;
  max-height: 120px;
}

.input-box:focus {
  border-color: #3b82f6;
}

.send-btn {
  padding: 10px 20px;
  background: #3b82f6;
  color: white;
  border: none;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s;
  height: 42px;
  flex-shrink: 0;
}

.send-btn:hover:not(:disabled) {
  background: #2563eb;
}

.send-btn:disabled {
  background: #93c5fd;
  cursor: not-allowed;
}

.stop-btn {
  padding: 10px 20px;
  background: #ef4444;
  color: white;
  border: none;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s;
  height: 42px;
  flex-shrink: 0;
}

.stop-btn:hover {
  background: #dc2626;
}
</style>
