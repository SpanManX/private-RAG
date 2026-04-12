<script setup lang="ts">
import { ref, computed } from 'vue'
import { useDocumentStore } from '@/stores/documentStore'
import FileUploader from './FileUploader.vue'

const documentStore = useDocumentStore()
const activeDocId = ref<string | null>(null)

function selectDoc(id: string): void {
  activeDocId.value = activeDocId.value === id ? null : id
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  })
}
</script>

<template>
  <div class="doc-list">
    <div class="doc-list-header">
      <span class="title">文档列表</span>
      <span class="count">{{ documentStore.documents.length }}</span>
    </div>

    <div class="doc-items">
      <div
        v-for="doc in documentStore.documents"
        :key="doc.id"
        class="doc-item"
        :class="{ active: activeDocId === doc.id }"
        @click="selectDoc(doc.id)"
      >
        <div class="doc-icon">{{ doc.fileName.endsWith('.pdf') ? '📄' : '📝' }}</div>
        <div class="doc-info">
          <div class="doc-name">{{ doc.fileName }}</div>
          <div class="doc-date">{{ formatDate(doc.createdAt) }}</div>
        </div>
        <button
          class="delete-btn"
          @click.stop="documentStore.deleteDocument(doc.id)"
          title="删除文档"
        >
          ✕
        </button>
      </div>

      <div v-if="documentStore.documents.length === 0" class="empty-tip">
        暂无文档，请导入
      </div>
    </div>
  </div>
</template>

<style scoped>
.doc-list {
  padding: 8px 0;
}

.doc-list-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 12px 8px;
  font-size: 11px;
  color: #9ca3af;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.doc-items {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.doc-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  cursor: pointer;
  border-radius: 6px;
  transition: background 0.15s;
  position: relative;
}

.doc-item:hover {
  background: #f3f4f6;
}

.doc-item.active {
  background: #eff6ff;
}

.doc-icon {
  font-size: 18px;
  flex-shrink: 0;
}

.doc-info {
  flex: 1;
  min-width: 0;
}

.doc-name {
  font-size: 13px;
  color: #374151;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.doc-date {
  font-size: 11px;
  color: #9ca3af;
  margin-top: 2px;
}

.delete-btn {
  opacity: 0;
  background: none;
  border: none;
  cursor: pointer;
  color: #9ca3af;
  font-size: 10px;
  padding: 4px;
  border-radius: 4px;
  transition: all 0.15s;
}

.doc-item:hover .delete-btn {
  opacity: 1;
}

.delete-btn:hover {
  background: #fee2e2;
  color: #dc2626;
}

.empty-tip {
  padding: 20px 12px;
  text-align: center;
  font-size: 13px;
  color: #9ca3af;
}
</style>
