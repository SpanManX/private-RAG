<script setup lang="ts">
import { ref } from 'vue'
import { useDocumentStore } from '@/stores/documentStore'

const documentStore = useDocumentStore()
const activeDocId = ref<string | null>(null)
const pendingDeleteId = ref<string | null>(null)

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

function confirmDelete(id: string): void {
  pendingDeleteId.value = id
}

function cancelDelete(): void {
  pendingDeleteId.value = null
}

function executeDelete(): void {
  if (pendingDeleteId.value) {
    documentStore.deleteDocument(pendingDeleteId.value)
    pendingDeleteId.value = null
  }
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
          @click.stop="confirmDelete(doc.id)"
          title="删除文档"
        >
          🗑️
        </button>
      </div>

      <div v-if="documentStore.documents.length === 0" class="empty-tip">
        暂无文档，请导入
      </div>
    </div>

    <!-- 删除确认弹窗 -->
    <Teleport to="body">
      <Transition name="fade">
        <div v-if="pendingDeleteId" class="confirm-overlay" @click.self="cancelDelete">
          <div class="confirm-dialog">
            <div class="confirm-icon">⚠️</div>
            <div class="confirm-title">确认删除</div>
            <div class="confirm-message">
              确定要删除文档「{{ documentStore.documents.find(d => d.id === pendingDeleteId)?.fileName }}」吗？<br>
              此操作不可恢复。
            </div>
            <div class="confirm-actions">
              <button class="btn-cancel" @click="cancelDelete">取消</button>
              <button class="btn-confirm" @click="executeDelete">删除</button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
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

/* 删除确认弹窗 */
.confirm-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.confirm-dialog {
  background: white;
  border-radius: 12px;
  padding: 24px;
  width: 320px;
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.2);
  text-align: center;
}

.confirm-icon {
  font-size: 40px;
  margin-bottom: 12px;
}

.confirm-title {
  font-size: 16px;
  font-weight: 600;
  color: #1f2937;
  margin-bottom: 8px;
}

.confirm-message {
  font-size: 13px;
  color: #6b7280;
  line-height: 1.5;
  margin-bottom: 20px;
}

.confirm-actions {
  display: flex;
  gap: 12px;
}

.btn-cancel,
.btn-confirm {
  flex: 1;
  padding: 10px 16px;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s;
}

.btn-cancel {
  background: #f3f4f6;
  border: none;
  color: #374151;
}

.btn-cancel:hover {
  background: #e5e7eb;
}

.btn-confirm {
  background: #ef4444;
  border: none;
  color: white;
}

.btn-confirm:hover {
  background: #dc2626;
}

/* 过渡动画 */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.fade-enter-active .confirm-dialog,
.fade-leave-active .confirm-dialog {
  transition: transform 0.2s ease;
}

.fade-enter-from .confirm-dialog,
.fade-leave-to .confirm-dialog {
  transform: scale(0.95);
}
</style>
