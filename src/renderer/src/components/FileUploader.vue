<script setup lang="ts">
import { ref } from 'vue'
import { useDocumentStore } from '@/stores/documentStore'

const emit = defineEmits<{
  imported: []
}>()

const documentStore = useDocumentStore()
const isDragging = ref(false)

async function handleFileDialog(): Promise<void> {
  const filePaths = await window.api.dialog.openFile()
  if (filePaths.length > 0) {
    await documentStore.importBatch(filePaths)
    emit('imported')
  }
}

function handleDrop(event: DragEvent): void {
  isDragging.value = false
  const files = event.dataTransfer?.files
  if (!files) return

  const paths = Array.from(files)
    .filter((f) => /\.(pdf|docx?|md|txt)$/i.test(f.name))
    .map((f) => f.path)

  if (paths.length > 0) {
    documentStore.importBatch(paths)
    emit('imported')
  }
}
</script>

<template>
  <div
    class="file-uploader"
    :class="{ dragging: isDragging }"
    @click="handleFileDialog"
    @dragover.prevent="isDragging = true"
    @dragleave="isDragging = false"
    @drop.prevent="handleDrop"
  >
    <slot>
      <div class="upload-content">
        <span class="upload-icon">+</span>
        <span class="upload-text">导入文档</span>
      </div>
    </slot>
  </div>
</template>

<style scoped>
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

.file-uploader:hover {
  border-color: #3b82f6;
  background: #eff6ff;
}

.file-uploader.dragging {
  border-color: #3b82f6;
  background: #dbeafe;
}

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
</style>
