/**
 * Excel 文档解析器
 *
 * 职责：
 * - 解析 .xlsx / .xls 格式的 Excel 文件
 * - 提取表格数据并保持「表头-行」的关联关系
 *
 * 处理策略：
 * - 以「表头 + 数据行」为最小语义单元，保持上下文关联
 * - 每个 Sheet 单独处理
 * - 第一行作为表头
 * - 每个数据行拼接完整表头生成文本块
 *
 * 输出格式示例：
 * [Sheet: 销售数据]
 * [表头: 地区 | 一月 | 二月 | 三月]
 * [数据行: 北京 | 100万 | 150万 | 180万]
 * [数据行: 上海 | 120万 | 160万 | 200万]
 */

import XLSX from 'xlsx'
import {log} from './logger'

export class ExcelProcessor {
    /**
     * 解析 Excel 文件
     * @param filePath 文件路径（.xlsx 或 .xls）
     * @returns 提取的纯文本内容
     */
    async parse(filePath: string): Promise<string> {
        try {
            const workbook = XLSX.readFile(filePath)
            const parts: string[] = []

            for (const sheetName of workbook.SheetNames) {
                const sheetText = this.parseSheet(workbook, sheetName)
                if (sheetText) {
                    parts.push(sheetText)
                }
            }

            const result = parts.join('\n')
            log(`Excel 解析完成: ${result.length} 字符, ${workbook.SheetNames.length} 个 Sheet`)
            return result
        } catch (error) {
            log(`Excel 解析错误: ${error}`)
            throw new Error(`Excel 解析失败: ${error}`)
        }
    }

    /**
     * 解析单个 Sheet
     */
    private parseSheet(workbook: XLSX.WorkBook, sheetName: string): string {
        const worksheet = workbook.Sheets[sheetName]
        const jsonData = XLSX.utils.sheet_to_json(worksheet, {header: 1}) as (string | number | null)[][]

        if (jsonData.length === 0) return ''

        const parts: string[] = []
        parts.push(`[Sheet: ${sheetName}]`)

        // 第一行作为表头
        const headerRow = jsonData[0]
        if (!headerRow || headerRow.length === 0) return parts.join('\n')

        // 清理表头
        const headers = headerRow.map((cell) => this.cleanCellText(cell))

        // 从第二行开始是数据行
        for (let rowIndex = 1; rowIndex < jsonData.length; rowIndex++) {
            const row = jsonData[rowIndex]

            // 跳过空行（所有单元格都为空）
            if (this.isEmptyRow(row)) continue

            // 构建「表头: 值」对列表
            const pairs = this.buildRowPairs(headers, row)
            if (pairs.length > 0) {
                parts.push(`[数据行: ${pairs.join(', ')}]`)
            }
        }

        return parts.join('\n')
    }

    /**
     * 检查行是否为空（所有单元格都为空）
     */
    private isEmptyRow(row: (string | number | null)[]): boolean {
        return row.every((cell) => cell === null || cell === undefined || cell === '')
    }

    /**
     * 构建行数据文本
     * @param headers 表头数组
     * @param row 数据行数组
     * @returns 「表头: 值」格式的字符串数组
     */
    private buildRowPairs(headers: string[], row: (string | number | null)[]): string[] {
        const pairs: string[] = []
        for (let colIndex = 0; colIndex < headers.length; colIndex++) {
            const header = headers[colIndex]
            const cellValue = this.cleanCellText(row[colIndex])

            // 只保留有表头且有值的列
            if (header && cellValue) {
                pairs.push(`${header}: ${cellValue}`)
            }
        }
        return pairs
    }

    /**
     * 清理单元格文本
     * - null/undefined → 空字符串
     * - 去除首尾空格
     */
    private cleanCellText(cell: string | number | null | undefined): string {
        if (cell === null || cell === undefined) return ''
        return String(cell).trim()
    }
}
