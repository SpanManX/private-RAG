# LlamaServer 重构设计：提取公共基类

## 背景

`ServerManager.ts`（对话服务 8080）和 `embeddingServerManager.ts`（向量服务 8081）存在大量重复代码：
- GPU 检测逻辑
- 模型文件查找
- 路径刷新和目录管理
- 进程启动/停止模式

两者都是对 llama-server 进程的管理，共享公共逻辑。

## 架构

```
LlamaServerBase（抽象基类）
├── process: ChildProcess | null
├── modelsDir: string
├── gpuAvailable: boolean
├── llamaServerPath: string
│
├── detectGpu(): boolean                    // GPU 检测
├── findModelFile(prefix, ext): string|null // 查找模型文件
├── refreshPaths(): Promise<void>           // 刷新路径
├── updateModelsDir(dir: string): void       // 更新目录
├── getModelsDir(): string                  // 获取目录
│
├── abstract start(): Promise<void>
├── abstract stop(): Promise<void>
├── abstract getStatus(): ServerStatus
│
└── ServerManager（对话服务，8080）
    ├── modelPath: string
    ├── MODEL_FILE: string
    ├── downloadModel(): Promise<void>
    └── start()/stop()/getStatus()

└── EmbeddingServerManager（向量服务，8081）
    ├── embeddingPath: string
    ├── EMBEDDING_FILE: string
    └── start()/stop()/getStatus()
```

## 文件变更

| 操作 | 文件 | 说明 |
|------|------|------|
| 新建 | `src/main/units/llamaServerManager.ts` | 抽象基类 LlamaServerBase |
| 修改 | `src/main/serverManager.ts` | 继承 LlamaServerBase，保留独有逻辑 |
| 修改 | `src/main/units/embeddingServerManager.ts` | 继承 LlamaServerBase，保留独有逻辑 |
| 保留 | `src/main/units/serverUtils.ts` | 公共工具（waitForServer 等） |
| 保留 | `src/main/units/llamaServerUtils.ts` | llama-server 路径查找 |

## LlamaServerBase 公共接口

```typescript
export abstract class LlamaServerBase {
    protected process: ChildProcess | null = null
    protected modelsDir!: string
    protected gpuAvailable!: boolean
    protected llamaServerPath!: string

    // 公共方法
    protected detectGpu(): boolean
    protected findModelFile(prefix: string, ext: string): string | null
    protected async refreshPaths(): Promise<void>
    protected updateModelsDir(dir: string): void
    protected getModelsDir(): string

    // 抽象方法（子类实现）
    abstract start(): Promise<void>
    abstract stop(): Promise<void>
    abstract getStatus(): ServerStatus
}
```

## ServerManager 变更

保留：
- `modelPath`、`MODEL_FILE`、`downloadModel()`

移除：
- `detectGpu()`、`findModelFile()`、`refreshPaths()`、`updateModelsDir()`、`getModelsDir()`

继承：
- 继承 `LlamaServerBase`，实现抽象方法

## EmbeddingServerManager 变更

保留：
- `embeddingPath`、`EMBEDDING_FILE`

移除：
- `detectGpu()`、`findModelFile()`、`refreshPaths()`、`updateModelsDir()`、`getModelsDir()`

继承：
- 继承 `LlamaServerBase`，实现抽象方法

## 依赖关系

两者共享同一个 llama-server 可执行文件（打包进安装包），路径检测逻辑完全相同，由基类统一处理。

## 进度

- [x] 设计完成
- [ ] 实现 LlamaServerBase 基类
- [ ] 修改 ServerManager 继承基类
- [ ] 修改 EmbeddingServerManager 继承基类
- [ ] 验证构建和运行
