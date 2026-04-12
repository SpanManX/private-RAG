<script setup lang="ts">
import { onMounted, ref, onUnmounted } from 'vue'
import { useDocumentStore } from '@/stores/documentStore'

const documentStore = useDocumentStore()
documentStore.refreshDocuments()
const serverStatus = ref<'idle' | 'starting' | 'running' | 'error'>('idle')
const downloadProgress = ref(0)
const statusMessage = ref('')

onMounted(async () => {
  await checkServerStatus()
})

async function checkServerStatus(): Promise<void> {
  const status = await window.api.server.status()
  serverStatus.value = status.state === 'running' ? 'running' : 'idle'
  statusMessage.value = status.message
}

async function startServer(): Promise<void> {
  serverStatus.value = 'starting'
  statusMessage.value = '正在启动模型服务...'
  await window.api.server.start()
  await checkServerStatus()
}

async function downloadModel(): Promise<void> {
  serverStatus.value = 'starting'
  statusMessage.value = '正在下载模型（约 1.5GB）...'

  window.api.server.onDownloadProgress((progress) => {
    downloadProgress.value = progress.percent
    statusMessage.value = `下载中: ${Math.round(progress.percent)}% - ${progress.speed}`
  })

  await window.api.server.downloadModel()
  await checkServerStatus()
}

function getStatusLabel(): string {
  switch (serverStatus.value) {
    case 'running':
      return '服务运行中'
    case 'starting':
      return '启动中...'
    case 'error':
      return '服务异常'
    default:
      return '服务未启动'
  }
}
</script>

<template>
  <div class="settings">
    <h1>设置</h1>

    <!-- 模型服务状态 -->
    <section class="settings-section">
      <h2>模型服务</h2>
      <div class="status-card">
        <div class="status-row">
          <span class="label">状态:</span>
          <span class="status-badge" :class="serverStatus">
            {{ getStatusLabel() }}
          </span>
        </div>
        <div class="status-row">
          <span class="label">信息:</span>
          <span class="value">{{ statusMessage }}</span>
        </div>
        <div v-if="downloadProgress > 0 && downloadProgress < 100" class="progress-bar">
          <div class="progress-fill" :style="{ width: downloadProgress + '%' }"></div>
        </div>
        <div class="actions">
          <button
            class="btn btn-primary"
            :disabled="serverStatus === 'running' || serverStatus === 'starting'"
            @click="startServer"
          >
            启动服务
          </button>
          <button
            class="btn btn-secondary"
            :disabled="serverStatus === 'starting'"
            @click="downloadModel"
          >
            下载模型
          </button>
        </div>
      </div>
    </section>

    <!-- 文档统计 -->
    <section class="settings-section">
      <h2>文档统计</h2>
      <div class="status-card">
        <div class="status-row">
          <span class="label">已导入文档:</span>
          <span class="value">{{ documentStore.documents.length }} 个</span>
        </div>
      </div>
    </section>

    <!-- 模型信息 -->
    <section class="settings-section">
      <h2>模型信息</h2>
      <div class="status-card">
        <div class="status-row">
          <span class="label">对话模型:</span>
          <span class="value">Qwen3-1.5B-GGUF (Q4 量化)</span>
        </div>
        <div class="status-row">
          <span class="label">Embedding:</span>
          <span class="value">bge-small-zh-v1.5</span>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.settings {
  flex: 1;
  overflow-y: auto;
  padding: 24px;
  max-width: 600px;
}

.settings-section {
  margin-bottom: 32px;
}

.settings-section h2 {
  font-size: 16px;
  font-weight: 600;
  color: #1f2937;
  margin-bottom: 16px;
  padding-bottom: 8px;
  border-bottom: 1px solid #e5e7eb;
}

.status-card {
  background: #f9fafb;
  border-radius: 8px;
  padding: 16px;
}

.status-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}

.status-row:last-child {
  margin-bottom: 0;
}

.label {
  font-size: 14px;
  color: #6b7280;
  min-width: 80px;
}

.value {
  font-size: 14px;
  color: #1f2937;
}

.status-badge {
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 500;
}

.status-badge.running {
  background: #d1fae5;
  color: #059669;
}

.status-badge.starting {
  background: #fef3c7;
  color: #d97706;
}

.status-badge.idle,
.status-badge.error {
  background: #fee2e2;
  color: #dc2626;
}

.progress-bar {
  height: 4px;
  background: #e5e7eb;
  border-radius: 2px;
  margin-bottom: 16px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: #3b82f6;
  transition: width 0.3s ease;
}

.actions {
  display: flex;
  gap: 12px;
  margin-top: 16px;
}

.btn {
  padding: 8px 16px;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 500;
  border: none;
  cursor: pointer;
  transition: all 0.2s;
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-primary {
  background: #3b82f6;
  color: white;
}

.btn-primary:hover:not(:disabled) {
  background: #2563eb;
}

.btn-secondary {
  background: #f3f4f6;
  color: #374151;
}

.btn-secondary:hover:not(:disabled) {
  background: #e5e7eb;
}
</style>
