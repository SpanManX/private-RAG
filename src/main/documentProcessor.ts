/**
 * 文档解析器
 *
 * 职责：
 * - 解析多种格式的文档（PDF、DOCX、Markdown、TXT）
 * - 提取纯文本内容，供后续分块和向量化
 *
 * 支持的格式：
 * - PDF：使用 pdf-parse 库提取文本
 * - DOCX：使用 mammoth 库提取纯文本
 * - Markdown：读取文件并清理 Markdown 语法标记
 * - TXT：直接读取文本内容
 */

import { readFile } from 'fs/promises'
import { extname } from 'path'
import { log } from './logger'

export class DocumentProcessor {
  /**
   * 解析文档，根据文件扩展名选择解析方法
   * @param filePath 文件路径
   * @returns 提取的纯文本内容
   */
  async parse(filePath: string): Promise<string> {
    const ext = extname(filePath).toLowerCase()
    log(`正在解析文档: ${filePath}`)

    switch (ext) {
      case '.pdf':
        return this.parsePdf(filePath)
      case '.docx':
        return this.parseDocx(filePath)
      case '.md':
      case '.markdown':
        return this.parseMarkdown(filePath)
      case '.txt':
        return this.parseTxt(filePath)
      default:
        throw new Error(`不支持的文件格式: ${ext}`)
    }
  }

  /**
   * 解析 PDF 文件
   * 使用 pdf-parse 库提取文本内容
   */
  private async parsePdf(filePath: string): Promise<string> {
    try {
      const pdfParse = (await import('pdf-parse')).default
      const data = await readFile(filePath)
      const result = await pdfParse(data)
      log(`PDF 解析完成: ${result.text.length} 字符`)
      return result.text
    } catch (error) {
      log(`PDF 解析错误: ${error}`)
      throw new Error(`PDF 解析失败: ${error}`)
    }
  }

  /**
   * 解析 Word DOCX 文件
   * 使用 mammoth 库提取纯文本（忽略格式）
   */
  private async parseDocx(filePath: string): Promise<string> {
    try {
      const mammoth = await import('mammoth')
      const result = await mammoth.extractRawText({ path: filePath })
      log(`DOCX 解析完成: ${result.value.length} 字符`)
      return result.value
    } catch (error) {
      log(`DOCX 解析错误: ${error}`)
      throw new Error(`Word 文档解析失败: ${error}`)
    }
  }

  /**
   * 解析 Markdown 文件
   * 清理 Markdown 语法标记，保留纯文本内容
   *
   * 处理：
   * - 代码块（```...```）→ 删除
   * - 链接 [text](url) → text
   * - 标题/强调等标记 [#*_~`] → 删除
   * - 多个连续换行 → 两个换行
   */
  private async parseMarkdown(filePath: string): Promise<string> {
    try {
      const content = await readFile(filePath, 'utf-8')
      const text = content
        // 删除代码块
        .replace(/```[\s\S]*?```/g, '')
        // 链接 [text](url) → text
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        // 删除 Markdown 标记
        .replace(/[#*_~`]/g, '')
        // 压缩多余换行
        .replace(/\n{3,}/g, '\n\n')
        .trim()
      log(`Markdown 解析完成: ${text.length} 字符`)
      return text
    } catch (error) {
      log(`Markdown 解析错误: ${error}`)
      throw new Error(`Markdown 解析失败: ${error}`)
    }
  }

  /**
   * 解析纯文本文件
   * 直接读取文件内容
   */
  private async parseTxt(filePath: string): Promise<string> {
    try {
      const content = await readFile(filePath, 'utf-8')
      log(`TXT 解析完成: ${content.length} 字符`)
      return content
    } catch (error) {
      log(`TXT 读取错误: ${error}`)
      throw new Error(`TXT 文件读取失败: ${error}`)
    }
  }
}
