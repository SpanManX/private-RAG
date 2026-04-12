<script setup lang="ts">
import type { Message } from '@/stores/chatStore'

defineProps<{
  message: Message
}>()

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit'
  })
}
</script>

<template>
  <div class="bubble-wrap" :class="message.role">
    <div class="bubble">
      <!-- 角色头像 -->
      <div class="avatar">
        {{ message.role === 'user' ? '👤' : '🤖' }}
      </div>

      <div class="content">
        <!-- 消息正文 -->
        <div class="text">{{ message.content || '思考中...' }}</div>

        <!-- 引用来源 -->
        <div v-if="message.citations && message.citations.length > 0" class="citations">
          <div class="citations-title">📄 参考来源</div>
          <div
            v-for="cite in message.citations"
            :key="cite.docId"
            class="citation-item"
          >
            <span class="cite-file">{{ cite.fileName }}</span>
            <span class="cite-score">{{ (cite.score * 100).toFixed(0) }}% 匹配</span>
          </div>
        </div>

        <!-- 时间戳 -->
        <div class="time">{{ formatTime(message.timestamp) }}</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.bubble-wrap {
  display: flex;
}

.bubble-wrap.user {
  justify-content: flex-end;
}

.bubble-wrap.assistant {
  justify-content: flex-start;
}

.bubble {
  display: flex;
  gap: 10px;
  max-width: 75%;
}

.user .bubble {
  flex-direction: row-reverse;
}

.avatar {
  font-size: 20px;
  flex-shrink: 0;
  margin-top: 2px;
}

.content {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.text {
  padding: 10px 14px;
  border-radius: 12px;
  font-size: 14px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}

.user .text {
  background: #3b82f6;
  color: white;
  border-bottom-right-radius: 4px;
}

.assistant .text {
  background: white;
  color: #374151;
  border-bottom-left-radius: 4px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
}

.citations {
  background: #f3f4f6;
  border-radius: 8px;
  padding: 8px 12px;
  margin-top: 4px;
}

.citations-title {
  font-size: 11px;
  font-weight: 600;
  color: #6b7280;
  margin-bottom: 6px;
}

.citation-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12px;
  color: #4b5563;
  padding: 3px 0;
}

.cite-file {
  font-weight: 500;
}

.cite-score {
  color: #9ca3af;
  font-size: 11px;
}

.time {
  font-size: 11px;
  color: #9ca3af;
  margin-top: 2px;
  padding: 0 4px;
}

.user .time {
  text-align: right;
}
</style>
