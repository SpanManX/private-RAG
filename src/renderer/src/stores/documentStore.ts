/**
 * 文档状态管理 (Pinia Store)
 *
 * 职责：
 * - 管理已导入文档的列表
 * - 提供文档导入/删除操作
 * - 追踪导入状态（是否正在导入）
 *
 * 与主进程通信：
 * - 通过 window.api.document.* 调用 IPC
 */

import {defineStore} from 'pinia'
import {ref} from 'vue'

/** 文档记录结构（与主进程 IndexManager 的 DocumentRecord 对应） */
export interface DocumentRecord {
    id: string          // 文档唯一 ID
    fileName: string    // 文件名
    createdAt: number   // 创建时间戳
}

/**
 * 文档状态管理
 * 使用 Pinia Composition API 风格定义
 */
export const useDocumentStore = defineStore('document', () => {
    // ===== 状态 =====
    /** 已导入文档列表 */
    const documents = ref<DocumentRecord[]>([])
    /** 是否正在导入文档 */
    const isImporting = ref(false)

    // ===== 操作 =====

    /**
     * 刷新文档列表
     * 从主进程获取最新的文档列表
     */
    async function refreshDocuments(): Promise<void> {
        documents.value = await window.api.document.list()
    }

    /**
     * 导入单个文档
     * - 调用主进程解析文档
     * - 主进程会：解析 → 分块 → 存储到 LanceDB
     * - 导入成功后刷新文档列表
     *
     * @param filePath 文件路径
     */
    async function importFile(filePath: string): Promise<void> {
        isImporting.value = true
        try {
            const result = await window.api.document.import(filePath)
            if (result.success) {
                await refreshDocuments()
            } else {
                throw new Error(result.error ?? '导入失败')
            }
        } finally {
            isImporting.value = false
        }
    }

    /**
     * 批量导入文档
     * 支持同时导入多个文件
     *
     * @param filePaths 文件路径数组
     */
    async function importBatch(filePaths: string[]): Promise<void> {
        isImporting.value = true
        try {
            const fileData: {
                filePath: string;
                success: boolean;
                docId?: string;
                error?: string
            }[] = await window.api.document.importBatch(filePaths)
            console.log(fileData,'importBatch')
            await refreshDocuments()
        } finally {
            isImporting.value = false
        }
    }

    /**
     * 删除文档
     * 从 LanceDB 中删除文档及其所有块
     *
     * @param docId 文档 ID
     */
    async function deleteDocument(docId: string): Promise<void> {
        await window.api.document.delete(docId)
        // 从本地列表中移除
        documents.value = documents.value.filter((d) => d.id !== docId)
    }

    // ===== 暴露给组件使用 =====
    return {
        documents,
        isImporting,
        refreshDocuments,
        importFile,
        importBatch,
        deleteDocument
    }
})
