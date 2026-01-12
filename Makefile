# Makefile for UCAgentWeb Development Environment
.PHONY: all clone-agent setup-agent start-agent start-mcp-client start-terminal-ws start-web stop clean clean-agent dev%

# Configuration - Using relative paths for portability
UCAGENT_DIR = ../UCAgent
UCAGENT_REPO = https://github.com/XS-MLVP/UCAgent.git
UCAGENT_BRANCH = main
PYTHON_CMD = python
PNPM_CMD = /home/bdj/.nvm/versions/node/v24.12.0/bin/pnpm
CURRENT_DIR = $(dir $(abspath $(lastword $(MAKEFILE_LIST))))
OUTPUT_DIR = $(CURRENT_DIR)output

# Ensure output directory exists
$(shell mkdir -p $(OUTPUT_DIR))

# PID files
AGENT_PID_FILE = $(OUTPUT_DIR)/.agent.pid
MCP_CLIENT_PID_FILE = $(OUTPUT_DIR)/.mcp_client.pid
TERMINAL_WS_PID_FILE = $(OUTPUT_DIR)/.terminal_ws.pid
WEB_PID_FILE = $(OUTPUT_DIR)/.web.pid

all: dev

# Clone or update UCAgent repository
clone-agent:
	@if [ ! -d "$(UCAGENT_DIR)" ]; then \
		echo "Cloning UCAgent repository..."; \
		git clone $(UCAGENT_REPO) $(UCAGENT_DIR); \
	else \
		echo "Updating UCAgent repository..."; \
		cd $(UCAGENT_DIR) && git fetch origin && git pull origin $(UCAGENT_BRANCH); \
	fi

# Setup UCAgent (install dependencies, etc.)
setup-agent: clone-agent
	@echo "Setting up UCAgent..."
	@cd $(UCAGENT_DIR) && python -c "import ucagent; print('UCAgent already installed.')" 2>/dev/null || (echo "Installing UCAgent..." && cd $(UCAGENT_DIR) && pip install -e .)
	@if [ $$? -ne 0 ]; then \
		echo "ERROR: Failed to install UCAgent dependencies"; \
		exit 1; \
	fi

# Start UCAgent service with specific target (calls mcp_* directly via ua- mechanism)
start-agent%: setup-agent
	@TARGET=$(patsubst start-agent%,%,$@); \
	if [ "$$TARGET" = "" ]; then \
		TARGET=Adder; \
	fi; \
	echo "Starting UCAgent service for target: $$TARGET on port 5000..."; \
	if [ -f $(AGENT_PID_FILE) ] && kill -0 $$(cat $(AGENT_PID_FILE)) 2>/dev/null; then \
		echo "UCAgent service is already running (PID: $$(cat $(AGENT_PID_FILE))). Skipping start."; \
	else \
		if [ ! -f "$(UCAGENT_DIR)/Makefile" ]; then \
			echo "ERROR: UCAgent directory does not exist or is not properly set up"; \
			exit 1; \
		fi; \
		cd $(UCAGENT_DIR) && nohup make mcp_$${TARGET} $${ARGS} > $(OUTPUT_DIR)/agent.log 2>&1 & \
		AGENT_PID=$$!; \
		echo $$AGENT_PID > $(AGENT_PID_FILE); \
		sleep 2; \
		if kill -0 $$AGENT_PID 2>/dev/null; then \
			echo "UCAgent service started with PID: $$AGENT_PID"; \
		else \
			echo "Failed to start UCAgent service"; \
			exit 1; \
		fi; \
	fi; \
	sleep 5

# Legacy start-agent target for backward compatibility
start-agent: start-agentAdder

# Forward targets to UCAgent directory - allows running UCAgent commands from this directory
ua-%:
	@echo "Running UCAgent target: $* in $(UCAGENT_DIR)";
	@if [ ! -d "$(UCAGENT_DIR)" ]; then \
		echo "ERROR: UCAgent directory $(UCAGENT_DIR) does not exist"; \
		exit 1; \
	fi; \
	cd $(UCAGENT_DIR) && make $*

# Start MCP client service
start-mcp-client:
	@echo "Starting MCP client service on port 8000..."
	@if [ -f $(MCP_CLIENT_PID_FILE) ] && kill -0 $$(cat $(MCP_CLIENT_PID_FILE)) 2>/dev/null; then \
		echo "MCP client service is already running (PID: $$(cat $(MCP_CLIENT_PID_FILE))). Skipping start."; \
	else \
		if [ ! -f "$(CURRENT_DIR)/mcp-client.py" ]; then \
			echo "ERROR: mcp-client.py not found in current directory"; \
			exit 1; \
		fi; \
		cd $(CURRENT_DIR) && nohup python mcp-client.py > $(OUTPUT_DIR)/mcp_client.log 2>&1 & echo $$! > $(MCP_CLIENT_PID_FILE); \
		if [ $$! -gt 0 ]; then \
			echo "MCP client service started with PID: $$(cat $(MCP_CLIENT_PID_FILE))"; \
		else \
			echo "Failed to start MCP client service"; \
			exit 1; \
		fi; \
	fi
	@sleep 3

# Start terminal WebSocket service
start-terminal-ws:
	@echo "Starting terminal WebSocket service on port 8080..."
	@if [ -f $(TERMINAL_WS_PID_FILE) ] && kill -0 $$(cat $(TERMINAL_WS_PID_FILE)) 2>/dev/null; then \
		echo "Terminal WebSocket service is already running (PID: $$(cat $(TERMINAL_WS_PID_FILE))). Skipping start."; \
	else \
		if [ ! -f "$(CURRENT_DIR)/terminal_websocket_server.py" ]; then \
			echo "ERROR: terminal_websocket_server.py not found in current directory"; \
			exit 1; \
		fi; \
		cd $(CURRENT_DIR) && nohup python terminal_websocket_server.py > $(OUTPUT_DIR)/terminal_ws.log 2>&1 & echo $$! > $(TERMINAL_WS_PID_FILE); \
		if [ $$! -gt 0 ]; then \
			echo "Terminal WebSocket service started with PID: $$(cat $(TERMINAL_WS_PID_FILE))"; \
		else \
			echo "Failed to start terminal WebSocket service"; \
			exit 1; \
		fi; \
	fi
	@sleep 3

# Start web service
start-web:
	@echo "Starting web service on port 5173..."
	@if [ -f $(WEB_PID_FILE) ] && kill -0 $$(cat $(WEB_PID_FILE)) 2>/dev/null; then \
		echo "Web service is already running (PID: $$(cat $(WEB_PID_FILE))). Skipping start."; \
	else \
		if [ ! -f "$(CURRENT_DIR)/package.json" ]; then \
			echo "ERROR: package.json not found in current directory"; \
			exit 1; \
		fi; \
		if ! test -x "$(PNPM_CMD)"; then \
			echo "ERROR: $(PNPM_CMD) command not found"; \
			exit 1; \
		fi; \
		cd $(CURRENT_DIR) && nohup $(PNPM_CMD) dev > $(OUTPUT_DIR)/web.log 2>&1 & \
		MAIN_PID=$$!; \
		# Give the process time to spawn child processes \
		sleep 5; \
		# Find the actual vite process PID - traverse the process tree \
		# First get the immediate child (shell process) \
		SHELL_PID=$$(pgrep -P $$MAIN_PID | head -n1); \
		if [ -n "$$SHELL_PID" ]; then \
			# Then get the child of the shell process (actual vite process) \
			VITE_PID=$$(pgrep -P $$SHELL_PID | head -n1); \
		fi; \
		if [ -n "$$VITE_PID" ]; then \
			# If we found the actual vite process, use that PID \
			echo $$VITE_PID > $(WEB_PID_FILE); \
		else \
			# If we can't find the full process chain, use whatever we have \
			if [ -n "$$SHELL_PID" ]; then \
				echo $$SHELL_PID > $(WEB_PID_FILE); \
			else \
				echo $$MAIN_PID > $(WEB_PID_FILE); \
			fi; \
		fi; \
		if [ -f $(WEB_PID_FILE) ] && [ -s $(WEB_PID_FILE) ]; then \
			echo "Web service started with PID: $$(cat $(WEB_PID_FILE))"; \
		else \
			echo "Failed to start web service"; \
			exit 1; \
		fi; \
	fi
	@sleep 3

# Check if services are running
check-running:
	@echo "=== Service Status ==="
	@if [ -f $(AGENT_PID_FILE) ] && [ -n "$$(cat $(AGENT_PID_FILE) 2>/dev/null)" ] && kill -0 $$(cat $(AGENT_PID_FILE)) 2>/dev/null; then \
		echo "[RUNNING] UCAgent service (PID: $$(cat $(AGENT_PID_FILE)), Port: 5000)"; \
	else \
		echo "[STOPPED] UCAgent service (Port: 5000)"; \
	fi
	@if [ -f $(MCP_CLIENT_PID_FILE) ] && [ -n "$$(cat $(MCP_CLIENT_PID_FILE) 2>/dev/null)" ] && kill -0 $$(cat $(MCP_CLIENT_PID_FILE)) 2>/dev/null; then \
		echo "[RUNNING] MCP client service (PID: $$(cat $(MCP_CLIENT_PID_FILE)), Port: 8000)"; \
	else \
		echo "[STOPPED] MCP client service (Port: 8000)"; \
	fi
	@if [ -f $(TERMINAL_WS_PID_FILE) ] && [ -n "$$(cat $(TERMINAL_WS_PID_FILE) 2>/dev/null)" ] && kill -0 $$(cat $(TERMINAL_WS_PID_FILE)) 2>/dev/null; then \
		echo "[RUNNING] Terminal WebSocket service (PID: $$(cat $(TERMINAL_WS_PID_FILE)), Port: 8080)"; \
	else \
		echo "[STOPPED] Terminal WebSocket service (Port: 8080)"; \
	fi
	@if [ -f $(WEB_PID_FILE) ] && [ -n "$$(cat $(WEB_PID_FILE) 2>/dev/null)" ] && kill -0 $$(cat $(WEB_PID_FILE)) 2>/dev/null; then \
		echo "[RUNNING] Web service (PID: $$(cat $(WEB_PID_FILE)), Port: 5173)"; \
	else \
		echo "[STOPPED] Web service (Port: 5173)"; \
	fi

# Stop all services
stop:
	@echo "Stopping all services..."
	@if [ -f $(AGENT_PID_FILE) ] && [ -n "$$(cat $(AGENT_PID_FILE) 2>/dev/null)" ] && kill -0 $$(cat $(AGENT_PID_FILE)) 2>/dev/null; then \
		kill $$(cat $(AGENT_PID_FILE)); \
		rm -f $(AGENT_PID_FILE); \
		echo "[SUCCESS] UCAgent service stopped"; \
	else \
		echo "[INFO] UCAgent service was not running"; \
		rm -f $(AGENT_PID_FILE); \
	fi
	@if [ -f $(MCP_CLIENT_PID_FILE) ] && [ -n "$$(cat $(MCP_CLIENT_PID_FILE) 2>/dev/null)" ] && kill -0 $$(cat $(MCP_CLIENT_PID_FILE)) 2>/dev/null; then \
		kill $$(cat $(MCP_CLIENT_PID_FILE)); \
		rm -f $(MCP_CLIENT_PID_FILE); \
		echo "[SUCCESS] MCP client service stopped"; \
	else \
		echo "[INFO] MCP client service was not running"; \
		rm -f $(MCP_CLIENT_PID_FILE); \
	fi
	@if [ -f $(TERMINAL_WS_PID_FILE) ] && [ -n "$$(cat $(TERMINAL_WS_PID_FILE) 2>/dev/null)" ] && kill -0 $$(cat $(TERMINAL_WS_PID_FILE)) 2>/dev/null; then \
		kill $$(cat $(TERMINAL_WS_PID_FILE)); \
		rm -f $(TERMINAL_WS_PID_FILE); \
		echo "[SUCCESS] Terminal WebSocket service stopped"; \
	else \
		echo "[INFO] Terminal WebSocket service was not running"; \
		rm -f $(TERMINAL_WS_PID_FILE); \
	fi
	@if [ -f $(WEB_PID_FILE) ] && [ -n "$$(cat $(WEB_PID_FILE) 2>/dev/null)" ] && kill -0 $$(cat $(WEB_PID_FILE)) 2>/dev/null; then \
		kill $$(cat $(WEB_PID_FILE)); \
		rm -f $(WEB_PID_FILE); \
		echo "[SUCCESS] Web service stopped"; \
	else \
		echo "[INFO] Web service was not running"; \
		rm -f $(WEB_PID_FILE); \
		# As a fallback, kill any remaining vite processes if PID file approach failed \
		@pkill -f "$(PNPM_CMD).*dev" 2>/dev/null || true; \
		@pkill -f "vite" 2>/dev/null || true; \
		@pkill -f "node.*vite" 2>/dev/null || true; \
	fi
	@make clean

# Force stop all services and cleanup any remaining processes
force-stop:
	@echo "Force stopping all services and cleaning up remaining processes..."
	@-pkill -f "$(PNPM_CMD).*dev" 2>/dev/null
	@-pkill -f "vite" 2>/dev/null
	@-pkill -f "node.*vite" 2>/dev/null
	@-pkill -f "mcp-client.py" 2>/dev/null
	@-pkill -f "make mcp_Adder" 2>/dev/null
	@-pkill -f "python.*ucagent" 2>/dev/null
	@-pkill -f "terminal_websocket_server.py" 2>/dev/null
	@rm -f $(AGENT_PID_FILE) $(MCP_CLIENT_PID_FILE) $(TERMINAL_WS_PID_FILE) $(WEB_PID_FILE)
	@echo "Force cleanup completed."

# Clean up
clean:
	@rm -f $(AGENT_PID_FILE) $(MCP_CLIENT_PID_FILE) $(TERMINAL_WS_PID_FILE) $(WEB_PID_FILE)
	@rm -f $(OUTPUT_DIR)/agent.log $(OUTPUT_DIR)/mcp_client.log $(OUTPUT_DIR)/terminal_ws.log $(OUTPUT_DIR)/web.log
	@rm -rf dist
	@find . -type d -name "__pycache__" -exec rm -rf {} +
	@find . -type f -name "*.pyc" -delete
	@find . -type f -name "*.pyo" -delete
	@find . -type d -name ".pytest_cache" -exec rm -rf {} +
	@echo "Clean completed."

clean-agent:
	@echo "Removing UCAgent directory..."
	@rm -rf $(UCAGENT_DIR)

# Parameterized dev target to start services with specific agent target
dev%: stop
	@TARGET=$(patsubst dev%,%,$@); \
	if [ "$$TARGET" = "" ]; then \
		TARGET=Adder; \
	fi; \
	echo "Starting development environment with agent target: $$TARGET"; \
	make start-agent$$TARGET start-mcp-client start-terminal-ws start-web
	@echo "Waiting for services to start..."
	@sleep 5
	@echo "All services started:"
	@echo "- UCAgent (port 5000): Check $(UCAGENT_DIR) directory"
	@echo "- MCP Client (port 8000): Running in $(CURRENT_DIR)"
	@echo "- Terminal WebSocket (port 8080): Running in $(CURRENT_DIR)"
	@echo "- Web Interface (port 5173): Running in $(CURRENT_DIR)"
	@echo ""
	@echo "Access the web interface at: http://127.0.0.1:5173"
	@echo ""
	@echo "To stop all services, run: make stop"
	@make status

# Show status
status: check-running