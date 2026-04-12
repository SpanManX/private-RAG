import { readFile } from 'fs/promises'
import { extname } from 'path'
import { log } from './logger'

export class DocumentProcessor {
  async parse(filePath: string): Promise<string> {
    const ext = extname(filePath).toLowerCase()
    log(`Parsing document: ${filePath}`)

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
        throw new Error(`Unsupported file format: ${ext}`)
    }
  }

  private async parsePdf(filePath: string): Promise<string> {
    try {
      const pdfParse = (await import('pdf-parse')).default
      const data = await readFile(filePath)
      const result = await pdfParse(data)
      log(`PDF parsed: ${result.text.length} chars`)
      return result.text
    } catch (error) {
      log(`PDF parse error: ${error}`)
      throw new Error(`PDF parse failed: ${error}`)
    }
  }

  private async parseDocx(filePath: string): Promise<string> {
    try {
      const mammoth = await import('mammoth')
      const result = await mammoth.extractRawText({ path: filePath })
      log(`DOCX parsed: ${result.value.length} chars`)
      return result.value
    } catch (error) {
      log(`DOCX parse error: ${error}`)
      throw new Error(`Word document parse failed: ${error}`)
    }
  }

  private async parseMarkdown(filePath: string): Promise<string> {
    try {
      const content = await readFile(filePath, 'utf-8')
      const text = content
        .replace(/```[\s\S]*?```/g, '')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .replace(/[#*_~`]/g, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
      log(`Markdown parsed: ${text.length} chars`)
      return text
    } catch (error) {
      log(`Markdown parse error: ${error}`)
      throw new Error(`Markdown parse failed: ${error}`)
    }
  }

  private async parseTxt(filePath: string): Promise<string> {
    try {
      const content = await readFile(filePath, 'utf-8')
      log(`TXT parsed: ${content.length} chars`)
      return content
    } catch (error) {
      log(`TXT read error: ${error}`)
      throw new Error(`TXT file read failed: ${error}`)
    }
  }
}
