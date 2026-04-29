<script setup lang="ts">
import {ref, onMounted} from 'vue'
import {useRoute} from 'vue-router'
import DocList from './DocList.vue'
import FileUploader from './FileUploader.vue'

const route = useRoute()

const serverStatus = ref<'idle' | 'starting' | 'running' | 'error'>('idle')
const gpuAvailable = ref(false)
const modelMode = ref<'local' | 'online'>('local')

onMounted(async () => {
  // 初始状态
  modelMode.value = await window.api.config.getModelMode()
  const status = await window.api.server.status()
  const embeddingStatus = await window.api.embedding.status()
  updateStatus(status.state, embeddingStatus.state, status.gpuAvailable ?? false)

  // 监听服务状态变化
  window.api.server.onStatusChange(({chatRunning, embeddingRunning, gpuAvailable: gpu, modelMode, error}) => {
    gpuAvailable.value = gpu
    if (error) {
      serverStatus.value = 'error'
      return
    }
    const isRunning = modelMode === 'online'
      ? embeddingRunning
      : (chatRunning && embeddingRunning)
    serverStatus.value = isRunning ? 'running' : 'idle'
  })
})

function updateStatus(chatState: string, embedState: string, gpu: boolean) {
  const bothRunning = chatState === 'running' && embedState === 'running'
  const anyError = chatState === 'error' || embedState === 'error'
  serverStatus.value = bothRunning ? 'running' : (anyError ? 'error' : 'idle')
  gpuAvailable.value = gpu
}

async function toggleServer() {
  if (serverStatus.value === 'running') {
    await window.api.server.stop()
  } else {
    serverStatus.value = 'starting'
    try {
      await window.api.server.start()
    } catch {
      // 错误由 GlobalError 弹窗显示，状态由 server:status-changed 事件更新
    }
  }
}

function getStatusLabel(): string {
  switch (serverStatus.value) {
    case 'running':
      return '运行中'
    case 'starting':
      return '启动中...'
    case 'error':
      return '异常'
    default:
      return '未启动'
  }
}
</script>

<template>
  <aside class="sidebar">
    <div class="sidebar-content">
      <!-- 服务状态卡片 -->
      <div class="server-card" :class="serverStatus">
        <div class="server-header">
          <!--          <div class="server-indicator">-->
          <div class="indicator-dot">
            <!--            <span class="indicator-dot"></span>-->
            <span class="indicator-pulse" v-if="serverStatus === 'running'"></span>
          </div>
          <div class="server-info">
            <span class="server-label">模型服务</span>
            <span class="server-status-text">{{ getStatusLabel() }}</span>
          </div>
          <div class="gpu-chip">
            <div :class="gpuAvailable ? 'gpu-ok' : 'gpu-none'">
              <span class="gpu-dot"></span>
              <template v-if="gpuAvailable">
                GPU Mode
              </template>
              <template v-else>
                CPU Mode
              </template>
            </div>
          </div>
        </div>
        <div class="server-actions">
          <button
              class="server-btn"
              :class="serverStatus === 'running' ? 'btn-stop' : 'btn-start'"
              :disabled="serverStatus === 'starting'"
              @click="toggleServer"
          >
            <span v-if="serverStatus === 'starting'" class="btn-loading">●</span>
            <span v-else>{{ serverStatus === 'running' ? '停止' : '启动' }}</span>
          </button>
        </div>
      </div>

      <!-- 导航 -->
      <nav class="nav-list">
        <router-link to="/" class="nav-item" :class="{ active: route.path === '/' }">
          <span class="nav-icon">💬</span>
          <span>对话</span>
        </router-link>
        <router-link
            to="/settings"
            class="nav-item"
            :class="{ active: route.path === '/settings' }"
        >
          <span class="nav-icon">⚙️</span>
          <span>设置</span>
        </router-link>
      </nav>

      <!-- 文档列表 -->
      <div class="doc-section">
        <div class="section-title">📚 知识库</div>
        <DocList/>
        <FileUploader @imported="() => {}"/>
      </div>
    </div>
  </aside>
</template>

<style lang="scss" scoped>
.sidebar {
  width: 240px;
  min-width: 200px;
  max-width: 320px;
  background: white;
  border-right: 1px solid #e5e7eb;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.sidebar-content {
  display: flex;
  flex-direction: column;
  height: 100%;
}

/* 服务状态卡片 */
.server-card {
  margin: 12px;
  padding: 14px;
  border-radius: 10px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  transition: all 0.2s;
}

.server-card.running {
  background: linear-gradient(135deg, #f0fdf4 0%, #ecfdf5 100%);
  border-color: #86efac;
}

.server-card.error {
  background: linear-gradient(135deg, #fef2f2 0%, #fef2f2 100%);
  border-color: #fca5a5;
}

.server-card.starting {
  background: linear-gradient(135deg, #fffbeb 0%, #fef3c7 100%);
  border-color: #fcd34d;
}

.server-header {
  display: flex;
  //align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}

.server-indicator {
  position: relative;
  width: 10px;
  height: 10px;
}

.indicator-dot {
  margin-top: 3px;
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  position: relative;
}

.server-card.idle .indicator-dot {
  background: #9ca3af;
}

.server-card.starting .indicator-dot {
  background: #f59e0b;
}

.server-card.running .indicator-dot {
  background: #22c55e;
  box-shadow: 0 0 6px #22c55e80;
}

.server-card.error .indicator-dot {
  background: #ef4444;
}

.indicator-pulse {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #22c55e40;
  animation: pulse 2s ease-out infinite;
}

@keyframes pulse {
  0% {
    transform: translate(-50%, -50%) scale(1);
    opacity: 1;
  }
  100% {
    transform: translate(-50%, -50%) scale(4);
    opacity: 0;
  }
}

.server-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.server-label {
  font-size: 11px;
  color: #64748b;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.server-status-text {
  font-size: 13px;
  font-weight: 600;
  color: #1e293b;
}

.server-card.running .server-status-text {
  color: #15803d;
}

.server-card.error .server-status-text {
  color: #dc2626;
}

.server-card.starting .server-status-text {
  color: #d97706;
}

.server-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.server-btn {
  flex: 1;
  padding: 6px 12px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 500;
  border: none;
  cursor: pointer;
  transition: all 0.15s;
}

.btn-start {
  background: #3b82f6;
  color: white;
}

.btn-start:hover:not(:disabled) {
  background: #2563eb;
}

.btn-stop {
  background: #ef4444;
  color: white;
}

.btn-stop:hover:not(:disabled) {
  background: #dc2626;
}

.server-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.btn-loading {
  animation: blink 0.8s infinite;
}

@keyframes blink {
  0%, 100% {
    opacity: 1;
  }
  50% {
    opacity: 0.3;
  }
}

.gpu-chip {
  font-size: 11px;
  font-weight: 500;
  flex: 1;
  text-align: right;

  & > div {
    display: inline-block;
    border-radius: 4px;
    padding: 4px 8px;
  }

  .gpu-ok {
    background: #d1fae5;
    color: #059669;
  }

  .gpu-none {
    background: #f3f4f6;
    color: #6b7280;
  }

  .gpu-dot {
    display: inline-block;
    vertical-align: middle;
    margin-right: 4px;
    margin-bottom: 3px;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: currentColor;
  }
}

/* 导航 */
.nav-list {
  display: flex;
  flex-direction: column;
  padding: 8px;
  gap: 2px;
  border-bottom: 1px solid #f3f4f6;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 13px;
  color: #6b7280;
  text-decoration: none;
  transition: all 0.15s;
}

.nav-item:hover {
  background: #f3f4f6;
  color: #374151;
}

.nav-item.active {
  background: #eff6ff;
  color: #3b82f6;
}

.nav-icon {
  font-size: 16px;
}

.doc-section {
  flex: 1;
  overflow-y: auto;
}

.section-title {
  padding: 16px 12px 8px;
  font-size: 12px;
  color: #9ca3af;
  font-weight: 500;
}
</style>
