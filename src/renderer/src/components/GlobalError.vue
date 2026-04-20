<script setup lang="ts">
import {useGlobalErrorStore} from '@/stores/globalErrorStore'

const globalError = useGlobalErrorStore()
</script>

<template>
  <Transition name="slide-down">
    <div v-if="globalError.showError" class="global-error">
      <div class="error-content">
        <span class="error-icon">⚠️</span>
        <span class="error-text">{{ globalError.errorMessage }}</span>
      </div>
      <button class="error-close" @click="globalError.clearError">&times;</button>
    </div>
  </Transition>
</template>

<style scoped>
.global-error {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 20px;
  background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
  color: white;
  box-shadow: 0 4px 12px rgba(239, 68, 68, 0.4);
  font-size: 14px;
}

.error-content {
  display: flex;
  align-items: center;
  gap: 10px;
}

.error-icon {
  font-size: 18px;
}

.error-text {
  font-weight: 500;
}

.error-close {
  background: rgba(255, 255, 255, 0.2);
  border: none;
  color: white;
  font-size: 20px;
  width: 28px;
  height: 28px;
  border-radius: 4px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s;
}

.error-close:hover {
  background: rgba(255, 255, 255, 0.3);
}

/* 动画 */
.slide-down-enter-active,
.slide-down-leave-active {
  transition: all 0.3s ease;
}

.slide-down-enter-from,
.slide-down-leave-to {
  transform: translateY(-100%);
  opacity: 0;
}
</style>
