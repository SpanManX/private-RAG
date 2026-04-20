/**
 * 全局错误提示 Store
 * 用于在应用任何位置显示错误提示
 */

import {defineStore} from 'pinia'
import {ref} from 'vue'

export const useGlobalErrorStore = defineStore('globalError', () => {
    const errorMessage = ref('')
    const showError = ref(false)
    let hideTimer: ReturnType<typeof setTimeout> | null = null

    function showErrorMsg(msg: string, duration = 5000): void {
        // 清除之前的定时器
        if (hideTimer) {
            clearTimeout(hideTimer)
            hideTimer = null
        }

        errorMessage.value = msg
        showError.value = true

        // 自动隐藏
        if (duration > 0) {
            hideTimer = setTimeout(() => {
                clearError()
            }, duration)
        }
    }

    function clearError(): void {
        errorMessage.value = ''
        showError.value = false
        if (hideTimer) {
            clearTimeout(hideTimer)
            hideTimer = null
        }
    }

    // 监听主进程发送的全局错误
    if (typeof window !== 'undefined' && (window as any).api) {
        ;(window as any).api.onGlobalError((error: string) => {
            showErrorMsg(error, 8000)
        })
    }

    return {
        errorMessage,
        showError,
        showErrorMsg,
        clearError
    }
})
