/**
 * 配置存储模块
 *
 * 职责：
 * - 管理应用配置（目前主要是模型文件目录）
 * - 配置持久化到 userData/config.json
 * - 提供缓存避免重复读取文件
 *
 * 默认配置：
 * - modelsDir: {用户文档目录}/rag-models
 */

import { app } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'

/** 配置结构 */
interface Config {
  modelsDir: string  // 模型文件存储目录
  modelMode: 'local' | 'online'  // 模型模式
  onlineApiUrl: string  // 在线 API 地址
  onlineApiKey: string  // API Key
  onlineModelName: string  // 模型名称
}

// 默认模型目录：用户文档目录下的 rag-models 子目录
const defaultModelsDir = join(app.getPath('documents'), 'rag-models')

// 默认配置
const defaultConfig: Config = {
  modelsDir: defaultModelsDir,
  modelMode: 'local',
  onlineApiUrl: '',
  onlineApiKey: '',
  onlineModelName: ''
}

/** 获取配置文件路径（位于 userData 目录） */
function getConfigPath(): string {
  return join(app.getPath('userData'), 'config.json')
}

/**
 * 从文件加载配置
 * 如果配置文件不存在或解析失败，返回默认配置
 */
function loadConfig(): Config {
  const configPath = getConfigPath()
  try {
    if (existsSync(configPath)) {
      const data = readFileSync(configPath, 'utf-8')
      // 合并默认配置和文件配置（文件配置覆盖默认值）
      return { ...defaultConfig, ...JSON.parse(data) }
    }
  } catch {
    // 解析失败，使用默认配置
  }
  return defaultConfig
}

/** 保存配置到文件 */
function saveConfig(config: Config): void {
  const configPath = getConfigPath()
  writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8')
}

// 配置缓存，避免每次都读取文件
let cachedConfig: Config | null = null

/** 获取配置（带缓存） */
function getConfig(): Config {
  if (!cachedConfig) {
    cachedConfig = loadConfig()
  }
  return cachedConfig
}

/**
 * 获取模型目录路径
 * 如果目录不存在，自动创建
 */
export function getModelsDir(): string {
  const config = getConfig()
  // 确保目录存在，不存在则创建
  if (!existsSync(config.modelsDir)) {
    mkdirSync(config.modelsDir, { recursive: true })
  }
  return config.modelsDir
}

/**
 * 设置模型目录路径
 * @param dir 新的目录路径
 */
export function setModelsDir(dir: string): void {
  // 验证路径有效性
  if (!dir || typeof dir !== 'string') {
    throw new Error('无效的目录路径')
  }
  const config = getConfig()
  config.modelsDir = dir
  saveConfig(config)
}

/**
 * 获取模型模式
 */
export function getModelMode(): 'local' | 'online' {
  return getConfig().modelMode
}

/**
 * 设置模型模式
 */
export function setModelMode(mode: 'local' | 'online'): void {
  const config = getConfig()
  config.modelMode = mode
  saveConfig(config)
}

/**
 * 获取在线 API 配置
 */
export function getOnlineApiConfig(): { url: string; key: string; model: string } {
  const config = getConfig()
  return {
    url: config.onlineApiUrl,
    key: config.onlineApiKey,
    model: config.onlineModelName
  }
}

/**
 * 设置在线 API 配置
 */
export function setOnlineApiConfig(apiConfig: { url: string; key: string; model: string }): void {
  const config = getConfig()
  config.onlineApiUrl = apiConfig.url
  config.onlineApiKey = apiConfig.key
  config.onlineModelName = apiConfig.model
  saveConfig(config)
}
