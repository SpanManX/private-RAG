<script setup lang="ts">
import { onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import DocList from './DocList.vue'
import FileUploader from './FileUploader.vue'

const router = useRouter()
const route = useRoute()

onMounted(() => {
  // 初始化时保持默认路由
})
</script>

<template>
  <aside class="sidebar">
    <div class="sidebar-content">
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
        <DocList />
        <FileUploader @imported="() => {}" />
      </div>
    </div>
  </aside>
</template>

<style scoped>
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
