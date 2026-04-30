<script setup lang="ts">
import {onMounted, onUnmounted, ref} from 'vue'
import {useDocumentStore} from '@/stores/documentStore'
import {useGlobalErrorStore} from '@/stores/globalErrorStore'

defineOptions({
  name: 'Settings'
})

const documentStore = useDocumentStore()
const globalError = useGlobalErrorStore()
documentStore.refreshDocuments()

const statusMessage = ref('')
const downloadProgress = ref({percent: 0, speed: '', phase: '', fileName: '', current: 0, total: 2})
const isDownloading = ref(false)
const modelsDir = ref('')
const modelMode = ref<'local' | 'online'>('local')
const onlineApiUrl = ref('')
const onlineApiKey = ref('')
const onlineModelName = ref('')
// let statusPollInterval: ReturnType<typeof setInterval> | null = null

let unsubsribeDownloadProgress: (() => void) | null = null

onMounted(async () => {
  await loadModelsDir()
  await loadModelMode()

  // 监听下载进度（页面切换后仍能收到）
  unsubsribeDownloadProgress = window.api.server.onDownloadProgress((progress) => {
    downloadProgress.value = progress
    if (progress.phase === 'done') {
      statusMessage.value = '所有文件已就绪'
      isDownloading.value = false
    } else if (progress.phase === 'model') {
      statusMessage.value = '正在下载模型...'
      isDownloading.value = true
    }
  })
})

onUnmounted(() => {
  unsubsribeDownloadProgress?.()
})


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

async function loadModelMode() {
  modelMode.value = await window.api.config.getModelMode()
  const apiConfig = await window.api.config.getOnlineApi()
  onlineApiUrl.value = apiConfig.url
  onlineApiKey.value = apiConfig.key
  onlineModelName.value = apiConfig.model
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

async function onModelModeChange(newMode: 'local' | 'online') {
  const result = await window.api.config.setModelMode(newMode)
  if (result.success) {
    modelMode.value = newMode
  }
}

async function saveOnlineApi() {
  await window.api.config.setOnlineApi({
    url: onlineApiUrl.value,
    key: onlineApiKey.value,
    model: onlineModelName.value
  })
  statusMessage.value = '保存成功'
}
</script>

<template>
  <div class="settings">
    <h1>设置</h1>
    <!-- 模型模式选择 -->
    <section class="settings-section">
      <h2>模型模式</h2>
      <div class="status-card">
        <div class="status-row">
          <span class="label">当前模式:</span>
          <select v-model="modelMode" @change="onModelModeChange(modelMode)" class="mode-select">
            <option value="local">本地大模型</option>
            <option value="online">在线大模型</option>
          </select>
        </div>
      </div>
    </section>

    <!-- 在线 API 配置 (仅在线模式显示) -->
    <section v-if="modelMode === 'online'" class="settings-section">
      <h2>在线 API 配置</h2>
      <div class="status-card">
        <div class="status-row">
          <span class="label">API 地址:</span>
          <input v-model="onlineApiUrl" class="api-input" placeholder="https://api.openai.com/v1" />
        </div>
        <div class="status-row">
          <span class="label">API Key:</span>
          <input v-model="onlineApiKey" class="api-input" type="password" placeholder="sk-..." />
        </div>
        <div class="status-row">
          <span class="label">模型名称:</span>
          <input v-model="onlineModelName" class="api-input" placeholder="gpt-4o" />
        </div>
        <div class="status-row">
          <button class="btn btn-primary" @click="saveOnlineApi">保存</button>
          <span v-if="statusMessage === '保存成功'" class="save-success">保存成功</span>
        </div>
      </div>
    </section>

    <!-- 模型下载 (仅本地模式显示) -->
    <section v-if="modelMode === 'local'" class="settings-section">
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
<!--            <span>阶段 {{ downloadProgress.current }}/{{ downloadProgress.total }}</span>-->
          </div>
          <div class="actions">
            <button class="btn btn-warning" @click="cancelDownload">取消下载</button>
          </div>
        </div>
        <div v-else class="download-idle">
          <div class="actions">
            <button
                class="btn btn-secondary"
                :disabled="isDownloading"
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
<!--    <section class="settings-section">-->
<!--      <h2>模型信息</h2>-->
<!--      <div class="status-card">-->
<!--        <div class="status-row">-->
<!--          <span class="label">对话模型:</span>-->
<!--          <span class="value">{{ chatModelName || '未加载' }}</span>-->
<!--        </div>-->
<!--        <div class="status-row">-->
<!--          <span class="label">Embedding:</span>-->
<!--          <span class="value">{{ embeddingModelName || '未加载' }}</span>-->
<!--        </div>-->
<!--      </div>-->
<!--    </section>-->
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

/* 模式选择下拉 */
.mode-select {
  padding: 6px 12px;
  border-radius: 6px;
  border: 1px solid #e5e7eb;
  font-size: 14px;
  background: white;
}

/* API 配置输入框 */
.api-input {
  flex: 1;
  padding: 6px 12px;
  border-radius: 6px;
  border: 1px solid #e5e7eb;
  font-size: 14px;
}
</style>
