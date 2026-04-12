import { defineStore } from 'pinia'
import { ref } from 'vue'

export interface DocumentRecord {
  id: string
  fileName: string
  createdAt: number
}

export const useDocumentStore = defineStore('document', () => {
  const documents = ref<DocumentRecord[]>([])
  const isImporting = ref(false)

  async function refreshDocuments(): Promise<void> {
    documents.value = await window.api.document.list()
  }

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

  async function importBatch(filePaths: string[]): Promise<void> {
    isImporting.value = true
    try {
      await window.api.document.importBatch(filePaths)
      await refreshDocuments()
    } finally {
      isImporting.value = false
    }
  }

  async function deleteDocument(docId: string): Promise<void> {
    await window.api.document.delete(docId)
    documents.value = documents.value.filter((d) => d.id !== docId)
  }

  return {
    documents,
    isImporting,
    refreshDocuments,
    importFile,
    importBatch,
    deleteDocument
  }
})
