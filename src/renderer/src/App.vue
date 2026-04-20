<script setup lang="ts">
import { onMounted } from 'vue'
import Sidebar from '@/components/Sidebar.vue'
import GlobalError from '@/components/GlobalError.vue'
import { useDocumentStore } from '@/stores/documentStore'

const documentStore = useDocumentStore()
onMounted(() => {
  documentStore.refreshDocuments()
})
</script>

<template>
  <div class="app-layout">
    <GlobalError />
    <Sidebar />
    <main class="app-main">
      <RouterView />
    </main>
  </div>
</template>

<style scoped>
.app-layout {
  display: flex;
  height: 100vh;
  overflow: hidden;
}

.app-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: #f9fafb;
}
</style>
