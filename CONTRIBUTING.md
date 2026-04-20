# 贡献指南

感谢你关注 PriVec！

## 如何贡献

### 报告问题
- 使用 [GitHub Issues](https://github.com/your-repo/privec/issues) 报告 Bug
- 描述问题现象、环境配置、复现步骤
- 贴上相关日志（错误信息、控制台输出）

### 功能建议
- 在 [GitHub Discussions](https://github.com/your-repo/privec/discussions) 提出想法
- 说明使用场景和预期效果
- 欢迎原型设计、UI 提案

### 代码贡献
1. Fork 本仓库
2. 创建特性分支：`git checkout -b feature/xxx`
3. 编写代码，遵守现有风格
4. 提交：`git commit -m 'feat: add xxx'`
5. 推送：`git push origin feature/xxx`
6. 创建 Pull Request

## 开发环境

```bash
# 克隆后安装依赖
npm install

# 开发模式
npm run dev

# 类型检查
npm run typecheck

# 构建 Windows 安装包
npm run build:win
```

## 代码规范

- TypeScript 启用 strict mode
- Vue 组件使用 `<script setup lang="ts">` 组合式 API
- 变量/函数命名清晰，中文注释
- ESLint + Prettier 自动格式化

## 项目结构

```
src/
├── main/           # Electron 主进程
├── preload/        # 上下文桥接
└── renderer/      # Vue 3 前端
    └── src/
        ├── components/   # UI 组件
        ├── views/        # 页面
        └── stores/       # 状态管理
```

## 问题交流

- **Bug 反馈**：GitHub Issues
- **功能讨论**：GitHub Discussions
- **QQ 群**：[群号待定]

---

*让本地知识库触手可及*
