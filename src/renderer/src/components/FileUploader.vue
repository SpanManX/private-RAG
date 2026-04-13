<script setup lang="ts">
/**
 * 文件上传组件
 *
 * 功能：
 * - 支持点击选择文件（打开系统文件对话框）
 * - 支持拖拽文件到组件上
 * - 自动过滤支持的文档格式（PDF、DOCX、MD、TXT）
 * - 批量导入到文档库
 *
 * 支持的文件格式：
 * - .pdf - PDF 文档
 * - .docx / .doc - Word 文档
 * - .md / .markdown - Markdown 文档
 * - .txt - 纯文本文件
 */

import { ref } from 'vue'
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

/**
 * 处理点击选择文件
 * 打开系统文件对话框，选择后批量导入
 */
async function handleFileDialog(): Promise<void> {
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
  const files = event.dataTransfer?.files
  if (!files) return

  // 提取文件路径，并过滤支持的文件格式
  const paths = Array.from(files)
    .filter((f) => /\.(pdf|docx?|md|txt)$/i.test(f.name))  // 只保留支持的格式
    .map((f) => f.path)  // 获取文件完整路径

  if (paths.length > 0) {
    documentStore.importBatch(paths)
    emit('imported')
  }
}
</script>

<template>
  <!--
    文件上传区域
    - 点击：打开文件对话框
    - dragover：拖拽进入时触发
    - dragleave：拖拽离开时触发
    - drop：拖拽放下时触发
  -->
  <div
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
/* 文件上传区域基础样式 */
.file-uploader {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 10px;
  border: 1.5px dashed #d1d5db;  /* 虚线边框 */
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;           /* 过渡动画 */
  margin: 8px 12px;
}

/* 悬停状态：边框变蓝，背景变浅蓝 */
.file-uploader:hover {
  border-color: #3b82f6;
  background: #eff6ff;
}

/* 拖拽状态：边框变蓝，背景更深的蓝 */
.file-uploader.dragging {
  border-color: #3b82f6;
  background: #dbeafe;
}

/* 上传内容：图标 + 文字水平排列 */
.upload-content {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: #6b7280;
}

/* 上传图标 */
.upload-icon {
  font-size: 16px;
  font-weight: 600;
  color: #3b82f6;
}

/* 上传文字 */
.upload-text {
  color: #6b7280;
}
</style>
