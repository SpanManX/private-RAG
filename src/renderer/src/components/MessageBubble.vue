<script setup lang="ts">
import {computed} from 'vue'
import MarkdownIt from 'markdown-it'
import type {Message} from '@/stores/chatStore'

// 创建 markdown-it 实例
const md = new MarkdownIt({
  breaks: true,  // 转换换行符为 <br>
  html: false,    // 禁用 HTML 标签
  linkify: true, // 自动转换链接
  typographer: true
})

const props = defineProps<{
  message: Message
}>()

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit'
  })
}

// 将 Markdown 转换为 HTML
const renderedContent = computed(() => {
  if (!props.message.content) return ''
  return md.render(props.message.content)
})
</script>

<template>
  <div class="bubble-wrap" :class="message.role">
    <div class="bubble">
      <!-- 角色头像 -->
      <div class="avatar">
        {{ message.role === 'user' ? '👤' : '🤖' }}
      </div>

      <div class="content">
        <!-- 消息正文（Markdown 渲染） -->
        <!-- AI 思考中加载动画 -->
        <div v-if="!renderedContent || renderedContent === ''" class="typing-indicator">
          <div class="typing-bubble">
            <span class="typing-dot"></span>
            <span class="typing-dot"></span>
            <span class="typing-dot"></span>
          </div>
        </div>
        <div v-else :class="{text:message.role === 'user'}" v-html="renderedContent || '思考中...'"></div>

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

<style lang="scss" scoped>
//.bubble-wrap.user {
//  display: flex;
//  justify-content: flex-end;
//}

.bubble {
  display: flex;
  gap: 10px;
  //max-width: 75%;
}

.user .bubble {
  flex-direction: row-reverse;
}

.avatar {
  font-size: 20px;
  flex-shrink: 0;
  padding-top: 6px;
  //margin-top: 2px;
}

.content {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.text {
  padding: 0 14px;
  border-radius: 12px;
  //font-size: 14px;
  //line-height: 1.6;
  //white-space: pre-wrap;
  word-break: break-word;
}

.user .text {
  background: #3b82f6;
  color: white;
  border-top-right-radius: 4px;
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

/* AI 思考中加载动画 */
.typing-indicator {
  display: flex;
  gap: 10px;
  animation: fadeIn 0.2s ease-out;
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.typing-bubble {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 16px 3px;
  //background: white;
  border-radius: 12px;
  //box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
}

.typing-dot {
  width: 8px;
  height: 8px;
  background: #9ca3af;
  border-radius: 50%;
  animation: bounce 1.4s ease-in-out infinite;
}

.typing-dot:nth-child(1) {
  animation-delay: 0s;
}

.typing-dot:nth-child(2) {
  animation-delay: 0.2s;
}

.typing-dot:nth-child(3) {
  animation-delay: 0.4s;
}

@keyframes bounce {
  0%, 60%, 100% {
    transform: translateY(0);
  }
  30% {
    transform: translateY(-6px);
  }
}
</style>
