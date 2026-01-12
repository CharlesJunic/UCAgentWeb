# UCAgentWeb - Web Interface for UCAgent

<div align="center">

**[English](README.en.md)** | 中文

一个为 UCAgent 定制的现代化网页端交互组件，提供直观的图形界面来管理和监控硬件验证任务。

[![License](https://img.shields.io/github/license/XS-MLVP/UCAgentWeb)](LICENSE)
[![Made with React](https://img.shields.io/badge/Made%20with-React-blue.svg)](https://reactjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-4.9%2B-blue.svg)](https://www.typescriptlang.org/)

</div>

## 简介

UCAgentWeb 是 UCAgent（UnityChip 验证 AI 智能体）的官方网页端交互组件。UCAgent 是一个基于大语言模型的 AI 驱动的自动化硬件验证智能体，专注于芯片设计单元测试验证。UCAgentWeb 提供了一个直观的 Web 界面，使用户能够更方便地管理、监控和分析硬件验证任务。

## 功能特性

- **可视化仪表板**：实时显示验证任务状态、覆盖率统计和进度
- **任务管理**：创建、启动、停止和监控验证任务
- **配置管理**：通过 Web 界面轻松配置验证参数
- **报告生成**：自动生成详细的验证报告和分析图表
- **多模式支持**：支持标准、增强和高级三种智能交互模式
- **实时监控**：实时查看验证过程中的日志和状态更新
- **团队协作**：支持多用户访问和权限管理

## 系统要求

- **浏览器**：Chrome 90+, Firefox 88+, Safari 14+, Edge 90+
- **Node.js**：18.x 或更高版本
- **内存**：建议 4GB 可用内存
- **网络**：需要连接到 UCAgent 后端服务

## 安装与部署

### 开发环境设置

1. 克隆仓库：
   ```bash
   git clone https://github.com/XS-MLVP/UCAgentWeb.git
   cd UCAgentWeb
   ```

2. 安装依赖：
   ```bash
   pnpm install
   ```

3. 启动开发服务器：
   ```bash
   pnpm dev
   ```

4. 访问 `http://localhost:5173` 查看应用

### 生产环境构建

1. 构建生产版本：
   ```bash
   pnpm build
   ```

2. 启动生产服务器：
   ```bash
   pnpm preview
   ```

### 使用 Make 命令

项目提供了便捷的 Make 命令来管理整个开发流程：

```bash
# 启动完整的开发环境（包括 UCAgent 和 MCP 客户端）并使用默认的 Adder 目标
make dev

# 启动完整的开发环境并使用特定的 Agent 目标（对应于 ../UCAgent/examples/* 中的目录）
make devAdder
make devALU754
make devBatchRun
# ... 以及其他基于 ../UCAgent/examples/* 中目录的其他目标

# 从此目录直接执行 UCAgent 命令（转发到 ../UCAgent 目录）
make ua-mcp_Adder
make ua-test_Adder
make ua-init_Adder
# ... 以及其他以 'ua-' 为前缀的 UCAgent 命令

# 停止所有服务
make stop

# 清理构建产物和临时文件
make clean

# 强制停止所有进程
make force-stop
```

## 使用方法

### 1. 连接到 UCAgent 服务

确保 UCAgent 后端服务正在运行（默认端口 5000），然后启动 UCAgentWeb。

### 2. 界面组件

UCAgentWeb 提供多个界面用于与代理交互：

#### Agent MCP Console
- 用于调用代理工具的可视化界面
- 显示带有描述和输入模式的可用工具
- 允许参数输入和执行，并可视化结果

#### MCP Client Terminal
- 用于直接与代理交互的命令行界面
- 支持以下命令：
  - `help` - 显示可用工具及其描述
  - `ls` 或 `tools` - 列出所有可用工具
  - `resources` - 列出所有可用资源
  - `get_resource <uri>` - 通过 URI 访问特定资源
  - `notify <message>` - 向代理发送通知
  - 直接工具调用，格式为 `tool_name {"param": "value"}` - 使用参数执行特定工具
  - `clear` - 清空终端输出
- 提供来自代理的实时输出监控
- 支持使用箭头键进行命令历史记录导航

### 3. 创建新的验证任务

1. 在仪表板上点击 "新建任务"
2. 选择要验证的硬件设计文件
3. 配置验证参数和选项
4. 启动验证过程

### 4. 监控验证进度

在实时监控面板中查看验证进度、覆盖率统计和日志输出。

### 5. 分析结果

验证完成后，查看生成的详细报告和分析图表。

## 技术栈

- **前端框架**：React 18 + TypeScript
- **样式**：Tailwind CSS
- **构建工具**：Vite
- **包管理器**：pnpm
- **状态管理**：React Hooks + Context API
- **HTTP 客户端**：Axios
- **图表库**：Chart.js 或 D3.js

## 贡献指南

我们欢迎社区贡献！请遵循以下步骤：

1. Fork 仓库
2. 创建功能分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 开启 Pull Request

## 许可证

本项目采用 Apache License 2.0 许可证。详情请参见 [LICENSE](LICENSE) 文件。