<script setup lang="ts">
/**
 * 文件上传组件
 *
 * 功能：
 * - 支持点击选择文件（打开系统文件对话框）
 * - 支持拖拽文件到组件上
 * - 自动过滤支持的文档格式（PDF、DOCX、MD、TXT、XLSX/XLS）
 * - 批量导入到文档库
 * - 显示导入进度（解析 → 向量化）
 * - 大模型未启动时给出提示
 *
 * 支持的文件格式：
 * - .pdf - PDF 文档
 * - .docx / .doc - Word 文档
 * - .xlsx / .xls - Excel 表格
 * - .md / .markdown - Markdown 文档
 * - .txt - 纯文本文件
 */

import { ref, onMounted } from 'vue'
import { useDocumentStore } from '@/stores/documentStore'

// 定义组件发出的事件
const emit = defineEmits<{
  /** 导入完成事件 */
  imported: []
}>()

// 使用文档状态管理
const documentStore = useDocumentStore()

/** 是否正在拖拽文件（用于样式切换） */
const isDragging = ref(false)

/** 服务未启动提示 */
const serverOfflineTip = ref(false)

onMounted(async () => {
  await documentStore.fetchServerStatus()
})

/**
 * 处理点击选择文件
 * 打开系统文件对话框，选择后批量导入
 */
async function handleFileDialog(): Promise<void> {
  if (!documentStore.isServerRunning) {
    serverOfflineTip.value = true
    setTimeout(() => { serverOfflineTip.value = false }, 3000)
    return
  }
  const filePaths = await window.api.dialog.openFile()
  if (filePaths.length > 0) {
    await documentStore.importBatch(filePaths)
    emit('imported')
  }
}

/**
 * 处理文件拖拽放下
 * 从拖拽事件中提取文件路径，过滤支持格式后批量导入
 *
 * @param event 拖拽事件
 */
function handleDrop(event: DragEvent): void {
  isDragging.value = false
  if (!documentStore.isServerRunning) {
    serverOfflineTip.value = true
    setTimeout(() => { serverOfflineTip.value = false }, 3000)
    return
  }
  const files = event.dataTransfer?.files
  if (!files) return

  // 提取文件路径，并过滤支持的文件格式
  const paths = Array.from(files)
    .filter((f) => /\.(pdf|docx?|xlsx?|md|txt)$/i.test(f.name))  // 只保留支持的格式
    .map((f) => (f as any).path)  // 获取文件完整路径

  if (paths.length > 0) {
    documentStore.importBatch(paths)
    emit('imported')
  }
}
</script>

<template>
  <!-- 进度显示状态 -->
  <div v-if="documentStore.importProgress.phase !== 'idle'" class="file-uploader progress-panel">
    <div class="progress-header">
      <span class="phase-label" v-if="documentStore.importProgress.phase === 'parsing'">正在解析文档...</span>
      <span class="phase-label" v-else-if="documentStore.importProgress.phase === 'vectorizing'">正在生成向量...</span>
      <span class="phase-label" v-else>导入完成</span>
      <span class="phase-percent">{{ documentStore.importProgress.percent }}%</span>
    </div>
    <div class="progress-bar">
      <div class="progress-fill" :style="{ width: documentStore.importProgress.percent + '%' }"></div>
    </div>
    <div class="progress-file">
      {{ documentStore.importProgress.fileName }} ({{ documentStore.importProgress.fileIndex }}/{{ documentStore.importProgress.fileTotal }})
    </div>
  </div>

  <!-- 服务未启动提示 -->
  <div v-else-if="serverOfflineTip" class="file-uploader offline-tip" @click="serverOfflineTip = false">
    <span>请先启动模型服务</span>
  </div>

  <!-- 默认上传区域 -->
  <div
    v-else
    class="file-uploader"
    :class="{ dragging: isDragging }"
    @click="handleFileDialog"
    @dragover.prevent="isDragging = true"
    @dragleave="isDragging = false"
    @drop.prevent="handleDrop"
  >
    <!-- 默认插槽：可自定义上传区域内容 -->
    <slot>
      <div class="upload-content">
        <span class="upload-icon">+</span>
        <span class="upload-text">导入文档</span>
      </div>
    </slot>
  </div>
</template>

<style scoped>
/* 基础上传区域样式 */
.file-uploader {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 10px;
  border: 1.5px dashed #d1d5db;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
  margin: 8px 12px;
}

/* 悬停状态 */
.file-uploader:hover {
  border-color: #3b82f6;
  background: #eff6ff;
}

/* 拖拽状态 */
.file-uploader.dragging {
  border-color: #3b82f6;
  background: #dbeafe;
}

/* 上传内容 */
.upload-content {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: #6b7280;
}

.upload-icon {
  font-size: 16px;
  font-weight: 600;
  color: #3b82f6;
}

.upload-text {
  color: #6b7280;
}

/* 进度面板 */
.progress-panel {
  flex-direction: column;
  align-items: stretch;
  gap: 8px;
  padding: 16px;
}

.progress-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.phase-label {
  font-size: 12px;
  color: #6b7280;
}

.progress-bar {
  flex: 1;
  height: 6px;
  background: #e5e7eb;
  border-radius: 3px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: #3b82f6;
  transition: width 0.3s ease;
  border-radius: 3px;
}

.phase-percent {
  font-size: 12px;
  color: #374151;
  min-width: 32px;
  text-align: right;
}

.progress-file {
  font-size: 12px;
  color: #9ca3af;
  text-align: center;
}

/* 服务未启动提示 */
.offline-tip {
  border-color: #fca5a5;
  background: #fef2f2;
  color: #dc2626;
  font-size: 13px;
  cursor: pointer;
}
</style>
