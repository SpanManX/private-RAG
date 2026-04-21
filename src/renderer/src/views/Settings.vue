<script setup lang="ts">
import {onMounted, ref, onUnmounted} from 'vue'
import {useDocumentStore} from '@/stores/documentStore'
import {useGlobalErrorStore} from '@/stores/globalErrorStore'

const documentStore = useDocumentStore()
const globalError = useGlobalErrorStore()
documentStore.refreshDocuments()

const serverStatus = ref<'idle' | 'starting' | 'running' | 'error'>('idle')
const statusMessage = ref('')
// const gpuAvailable = ref(false)
const downloadProgress = ref({percent: 0, speed: '', phase: '', fileName: '', current: 0, total: 2})
const isDownloading = ref(false)
const modelsDir = ref('')
const chatModelName = ref('')
const embeddingModelName = ref('')
let statusPollInterval: ReturnType<typeof setInterval> | null = null

onMounted(async () => {
  await loadModelsDir()
  await checkServerStatus()
  startStatusPoll()
})

onUnmounted(() => {
  stopStatusPoll()
})

function startStatusPoll() {
  statusPollInterval = setInterval(checkServerStatus, 3000)
}

function stopStatusPoll() {
  if (statusPollInterval) {
    clearInterval(statusPollInterval)
    statusPollInterval = null
  }
}

async function checkServerStatus() {
  const status = await window.api.server.status()
  serverStatus.value = status.state === 'running' ? 'running' : (status.state === 'error' ? 'error' : 'idle')
  statusMessage.value = status.message
  chatModelName.value = status.modelName || '未加载'

  // 获取 embedding 状态
  const embeddingStatus = await window.api.embedding.status()
  embeddingModelName.value = embeddingStatus.modelName || '未加载'
}

async function startServer() {
  serverStatus.value = 'starting'
  statusMessage.value = '正在启动模型服务...'
  try {
    const result = await window.api.server.start()
    if (!result.success) {
      serverStatus.value = 'error'
      statusMessage.value = result.error || '启动服务失败'
      return
    }
    await checkServerStatus()
  } catch (e) {
    serverStatus.value = 'error'
  }
}

async function stopServer() {
  await window.api.server.stop()
  await checkServerStatus()
}

async function downloadModel() {
  isDownloading.value = true
  downloadProgress.value = {
    percent: 0,
    speed: '',
    phase: 'model',
    fileName: 'Qwen3-4B-Q5_K_M.gguf',
    current: 1,
    total: 2
  }
  statusMessage.value = '正在下载模型...'

  window.api.server.onDownloadProgress((progress) => {
    downloadProgress.value = progress
    if (progress.phase === 'done') {
      statusMessage.value = '所有文件已就绪'
      isDownloading.value = false
    } else {
      // statusMessage.value = `下载中: ${progress.fileName} - ${progress.percent}%`
      statusMessage.value = `下载中...`
    }
  })

  try {
    await window.api.server.downloadModel()
  } catch (e) {
    if (String(e).includes('cancelled')) {
      statusMessage.value = '下载已取消'
    } else {
      globalError.showErrorMsg(String(e))
    }
    isDownloading.value = false
  }
}

async function cancelDownload() {
  await window.api.server.cancelDownload()
  isDownloading.value = false
  statusMessage.value = '下载已取消'
}

async function loadModelsDir() {
  modelsDir.value = await window.api.config.getModelsDir()
}

async function selectModelsDir() {
  const dir = await window.api.dialog.selectDirectory()
  if (dir) {
    try {
      await window.api.config.setModelsDir(dir)
      modelsDir.value = dir
    } catch (e) {
      globalError.showErrorMsg(String(e))
    }
  }
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
          <span class="status-badge" :class="serverStatus">{{ getStatusLabel() }}</span>
          <!--          <span class="gpu-badge" :class="gpuAvailable ? 'gpu-ok' : 'gpu-none'">-->
          <!--            GPU: {{ gpuAvailable ? '可用' : '不可用' }}-->
          <!--          </span>-->
        </div>
        <div class="status-row">
          <span class="label">信息:</span>
          <span class="value">{{ statusMessage }}</span>
        </div>
        <div class="actions">
          <button
              v-if="serverStatus === 'running'"
              class="btn btn-danger"
              @click="stopServer"
          >
            停止服务
          </button>
          <button
              v-else
              class="btn btn-primary"
              :disabled="serverStatus === 'starting'"
              @click="startServer"
          >
            启动服务
          </button>
        </div>
      </div>
    </section>

    <!-- 模型下载 -->
    <section class="settings-section">
      <h2>模型下载</h2>
      <div class="status-card">
        <div class="status-row">
          <span class="label">下载目录:</span>
          <span class="value models-dir-path">{{ modelsDir }}</span>
          <button
              class="btn btn-small"
              :disabled="isDownloading"
              @click="selectModelsDir"
          >
            更改
          </button>
        </div>
        <div v-if="isDownloading" class="download-active">
          <div class="download-file">
            正在下载: <strong>{{ downloadProgress.fileName }}</strong>
          </div>
          <div class="progress-bar">
            <div class="progress-fill" :style="{ width: downloadProgress.percent + '%' }"></div>
          </div>
          <div class="download-meta">
            <span>{{ downloadProgress.percent }}%</span>
            <span>{{ downloadProgress.speed }}</span>
            <span>阶段 {{ downloadProgress.current }}/{{ downloadProgress.total }}</span>
          </div>
          <div class="actions">
            <button class="btn btn-warning" @click="cancelDownload">取消下载</button>
          </div>
        </div>
        <div v-else class="download-idle">
          <div class="actions">
            <button
                class="btn btn-secondary"
                :disabled="serverStatus === 'starting'"
                @click="downloadModel"
            >
              下载模型
            </button>
          </div>
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
          <span class="value">{{ chatModelName || '未加载' }}</span>
        </div>
        <div class="status-row">
          <span class="label">Embedding:</span>
          <span class="value">{{ embeddingModelName || '未加载' }}</span>
        </div>
      </div>
    </section>
  </div>
</template>

<style lang="scss" scoped>
.settings {
  flex: 1;
  overflow-y: auto;
  padding: 24px;
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

/* 新增 GPU 徽章 */
//.gpu-badge {
//  font-size: 12px;
//  padding: 2px 8px;
//  border-radius: 4px;
//  margin-left: auto;
//}
//.gpu-badge.gpu-ok {
//  background: #d1fae5;
//  color: #059669;
//}
//.gpu-badge.gpu-none {
//  background: #f3f4f6;
//  color: #6b7280;
//}

/* 新增下载样式 */
.download-file {
  font-size: 14px;
  color: #374151;
  margin-bottom: 8px;
}

.download-meta {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: #6b7280;
  margin-top: 4px;
}

/* 按钮变体 */
.btn-danger {
  background: #dc2626;
  color: white;
}

.btn-danger:hover:not(:disabled) {
  background: #b91c1c;
}

.btn-warning {
  background: #f59e0b;
  color: white;
}

.btn-warning:hover:not(:disabled) {
  background: #d97706;
}

/* 小按钮 */
.btn-small {
  padding: 4px 12px;
  font-size: 12px;
  background: #e5e7eb;
  color: #374151;
}

.btn-small:hover:not(:disabled) {
  background: #d1d5db;
}

/* 目录路径 */
.models-dir-path {
  flex: 1;
  word-break: break-all;
  font-size: 13px;
  color: #6b7280;
}
</style>
