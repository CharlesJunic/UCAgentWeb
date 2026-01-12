# UCAgentWeb - Web Interface for UCAgent

<div align="center">

English | **[中文](README.zh.md)**

A modern web interface component customized for UCAgent, providing an intuitive graphical interface to manage and monitor hardware verification tasks.

[![License](https://img.shields.io/github/license/XS-MLVP/UCAgentWeb)](LICENSE)
[![Made with React](https://img.shields.io/badge/Made%20with-React-blue.svg)](https://reactjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-4.9%2B-blue.svg)](https://www.typescriptlang.org/)

</div>

## Introduction

UCAgentWeb is the official web interface component for UCAgent (UnityChip Verification AI-Agent). UCAgent is an AI-powered automated hardware verification agent based on large language models, focusing on unit test verification for chip design. UCAgentWeb provides an intuitive web interface that enables users to more conveniently manage, monitor, and analyze hardware verification tasks.

## Features

- **Visual Dashboard**: Real-time display of verification task status, coverage statistics, and progress
- **Task Management**: Create, start, stop, and monitor verification tasks
- **Configuration Management**: Easily configure verification parameters through the web interface
- **Report Generation**: Automatically generate detailed verification reports and analysis charts
- **Multi-mode Support**: Supports standard, enhanced, and advanced intelligent interaction modes
- **Real-time Monitoring**: View logs and status updates during the verification process in real-time
- **Team Collaboration**: Supports multi-user access and permission management

## System Requirements

- **Browser**: Chrome 90+, Firefox 88+, Safari 14+, Edge 90+
- **Node.js**: 18.x or higher
- **Memory**: 4GB+ recommended
- **Network**: Connection to UCAgent backend services required

## Installation and Deployment

### Development Environment Setup

1. Clone the repository:
   ```bash
   git clone https://github.com/XS-MLVP/UCAgentWeb.git
   cd UCAgentWeb
   ```

2. Install dependencies:
   ```bash
   pnpm install
   ```

3. Start the development server:
   ```bash
   pnpm dev
   ```

4. Visit `http://localhost:5173` to view the application

### Production Build

1. Build for production:
   ```bash
   pnpm build
   ```

2. Start production server:
   ```bash
   pnpm preview
   ```

### Using Make Commands

The project provides convenient Make commands to manage the entire development workflow:

```bash
# Start the complete development environment (including UCAgent and MCP client) with default Adder target
make dev

# Start the complete development environment with a specific agent target (corresponding to directories in ../UCAgent/examples/*)
make devAdder
make devALU754
make devBatchRun
# ... and other targets based on directories in ../UCAgent/examples/*

# Execute UCAgent commands directly from this directory (forwards to ../UCAgent directory)
make ua-mcp_Adder
make ua-test_Adder
make ua-init_Adder
# ... and other UCAgent commands prefixed with 'ua-'

# Stop all services
make stop

# Clean build artifacts and temporary files
make clean

# Force stop all processes
make force-stop
```

## Usage

### 1. Connect to UCAgent Service

Ensure the UCAgent backend service is running (default port 5000), then start UCAgentWeb.

### 2. Interface Components

UCAgentWeb provides multiple interfaces for interacting with the Agent:

#### Agent MCP Console
- Visual tool interface for calling Agent tools
- Displays available tools with descriptions and input schemas
- Allows parameter input and execution with result visualization

#### MCP Client Terminal
- Command-line interface for direct interaction with the Agent
- Supports the following commands:
  - `help` - Display available tools and their descriptions
  - `ls` or `tools` - List all available tools
  - `resources` - List all available resources
  - `get_resource <uri>` - Access a specific resource by URI
  - `notify <message>` - Send a notification to the Agent
  - Direct tool calls in the format `tool_name {"param": "value"}` - Execute specific tools with parameters
  - `clear` - Clear the terminal output
- Provides real-time output monitoring from the Agent
- Supports command history navigation with arrow keys

### 3. Create a New Verification Task

1. Click "New Task" on the dashboard
2. Select the hardware design file to verify
3. Configure verification parameters and options
4. Start the verification process

### 4. Monitor Verification Progress

View verification progress, coverage statistics, and log output in the real-time monitoring panel.

### 5. Analyze Results

After verification completes, review the generated detailed reports and analysis charts.

## Tech Stack

- **Frontend Framework**: React 18 + TypeScript
- **Styling**: Tailwind CSS
- **Build Tool**: Vite
- **Package Manager**: pnpm
- **State Management**: React Hooks + Context API
- **HTTP Client**: Axios
- **Chart Library**: Chart.js or D3.js

## Contributing

We welcome community contributions! Please follow these steps:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## License

This project is licensed under the Apache License 2.0. See the [LICENSE](LICENSE) file for details.