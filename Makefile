# Makefile for UCAgentWeb Development Environment
.PHONY: all clone-agent setup-agent start-agent start-mcp-client start-ws start-ws% start-web stop clean clean-agent dev dev%

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
WS_PID_FILE = $(OUTPUT_DIR)/.ws.pid
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
		LOG_FILE="$(OUTPUT_DIR)/agent.log"; \
		\
		# Start the UCAgent process in the background \
		( \
			cd $(UCAGENT_DIR) && \
			sed '/^mcp_%: init_%/,/^$$/ s/--tui //' Makefile > Makefile.tmp && \
			stdbuf -oL -eL make -f Makefile.tmp mcp_$${TARGET} $${ARGS} > $$LOG_FILE 2>&1 & \
			sleep 5; \
			\
			AGENT_PID=$$(pgrep -f "python.*ucagent.py.*$${TARGET}" | head -n1); \
			\
			if [ -n "$$AGENT_PID" ] && kill -0 $$AGENT_PID 2>/dev/null; then \
				echo "UCAgent service started with PID: $$AGENT_PID"; \
				echo $$AGENT_PID > $(AGENT_PID_FILE); \
				(while kill -0 $$AGENT_PID 2>/dev/null; do sleep 2; done; rm -f $(AGENT_PID_FILE);) & \
			else \
				echo "Failed to start UCAgent service"; \
				exit 1; \
			fi; \
		) & \
		# Wait for background processes to start \
		sleep 5; \
		# Cleanup temporary file in main process to ensure it's removed \
		( sleep 5; cd $(UCAGENT_DIR) 2>/dev/null && rm -f Makefile.tmp ) & \
	fi

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
		cd $(CURRENT_DIR) && python mcp-client.py > $(OUTPUT_DIR)/mcp_client.log 2>&1 & echo $$! > $(MCP_CLIENT_PID_FILE); \
		if [ $$! -gt 0 ]; then \
			echo "MCP client service started with PID: $$(cat $(MCP_CLIENT_PID_FILE))"; \
		else \
			echo "Failed to start MCP client service"; \
			exit 1; \
		fi; \
	fi
	@sleep 3

# Start terminal WebSocket service
start-ws:
	@echo "Starting terminal WebSocket service on port 8080 for default target: Adder";
	@if [ -f $(WS_PID_FILE) ] && kill -0 $$(cat $(WS_PID_FILE)) 2>/dev/null; then \
		echo "WebSocket service is already running (PID: $$(cat $(WS_PID_FILE))). Skipping start."; \
	else \
		if [ ! -f "$(CURRENT_DIR)/websocket_server.py" ]; then \
			echo "ERROR: websocket_server.py not found in current directory"; \
			exit 1; \
		fi; \
		cd $(CURRENT_DIR) && nohup python websocket_server.py Adder > $(OUTPUT_DIR)/ws.log 2>&1 & echo $$! > $(WS_PID_FILE); \
		if [ $$! -gt 0 ]; then \
			echo "WebSocket service started with PID: $$(cat $(WS_PID_FILE))"; \
		else \
			echo "Failed to start terminal WebSocket service"; \
			exit 1; \
		fi; \
	fi
	@sleep 3

start-ws%:
	@TARGET=$(patsubst start-ws%,%,$@); \
	if [ "$$TARGET" = "" ]; then \
		TARGET=Adder; \
	fi; \
	if [ -f $(WS_PID_FILE) ] && kill -0 $$(cat $(WS_PID_FILE)) 2>/dev/null; then \
		echo "WebSocket service is already running (PID: $$(cat $(WS_PID_FILE))). Skipping start."; \
	else \
		if [ ! -f "$(CURRENT_DIR)/websocket_server.py" ]; then \
			echo "ERROR: websocket_server.py not found in current directory"; \
			exit 1; \
		fi; \
		echo "Starting terminal WebSocket service on port 8080 for target: $$TARGET"; \
		cd $(CURRENT_DIR) && nohup python websocket_server.py $$TARGET > $(OUTPUT_DIR)/ws.log 2>&1 & echo $$! > $(WS_PID_FILE); \
		if [ $$! -gt 0 ]; then \
			echo "WebSocket service started with PID: $$(cat $(WS_PID_FILE))"; \
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
	@if [ -f $(WS_PID_FILE) ] && [ -n "$$(cat $(WS_PID_FILE) 2>/dev/null)" ] && kill -0 $$(cat $(WS_PID_FILE)) 2>/dev/null; then \
		echo "[RUNNING] WebSocket service (PID: $$(cat $(WS_PID_FILE)), Port: 8080)"; \
	else \
		echo "[STOPPED] WebSocket service (Port: 8080)"; \
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
	@if [ -f $(WS_PID_FILE) ] && [ -n "$$(cat $(WS_PID_FILE) 2>/dev/null)" ] && kill -0 $$(cat $(WS_PID_FILE)) 2>/dev/null; then \
		kill $$(cat $(WS_PID_FILE)); \
		rm -f $(WS_PID_FILE); \
		echo "[SUCCESS] WebSocket service stopped"; \
	else \
		echo "[INFO] WebSocket service was not running"; \
		rm -f $(WS_PID_FILE); \
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
force-stop: clean
	@echo "Force stopping all services and cleaning up remaining processes..."
	@-pkill -f "$(PNPM_CMD).*dev" 2>/dev/null
	@-pkill -f "vite" 2>/dev/null
	@-pkill -f "node.*vite" 2>/dev/null
	@-pkill -f "mcp-client.py" 2>/dev/null
	@-pkill -f "make mcp_Adder" 2>/dev/null
	@-pkill -f "python.*ucagent" 2>/dev/null
	@-pkill -f "websocket_server.py" 2>/dev/null
	@-lsof -ti:8000 | xargs kill -9 2>/dev/null || true
	@-lsof -ti:8080 | xargs kill -9 2>/dev/null || true
	@-lsof -ti:5000 | xargs kill -9 2>/dev/null || true
	@-lsof -ti:5173 | xargs kill -9 2>/dev/null || true
	@-fuser -k 8000/tcp 2>/dev/null || true
	@-fuser -k 8080/tcp 2>/dev/null || true
	@-fuser -k 5000/tcp 2>/dev/null || true
	@-fuser -k 5173/tcp 2>/dev/null || true
	@echo "Force cleanup completed."

# Clean up
clean:
	@rm -f $(AGENT_PID_FILE) $(MCP_CLIENT_PID_FILE) $(WS_PID_FILE) $(WEB_PID_FILE)
	@rm -f $(OUTPUT_DIR)/agent.log $(OUTPUT_DIR)/mcp_client.log $(OUTPUT_DIR)/ws.log $(OUTPUT_DIR)/web.log
	@rm -rf $(OUTPUT_DIR)/pipes
	@rm -f $(UCAGENT_DIR)/Makefile.tmp
	@rm -rf dist
	@find . -type d -name "__pycache__" -exec rm -rf {} +
	@find . -type f -name "*.pyc" -delete
	@find . -type f -name "*.pyo" -delete
	@find . -type d -name ".pytest_cache" -exec rm -rf {} +
	@make ua-clean
	@echo "Clean completed."

clean-agent:
	@echo "Removing UCAgent directory..."
	@rm -rf $(UCAGENT_DIR)

# Function to check if a service is available on a specific port
define check_port_available
	@echo "Waiting for service on port $(1) to become available..."
	@timeout 120 sh -c 'until nc -z localhost $(1); do sleep 1; done' || { \
		echo "ERROR: Service on port $(1) did not become available within 120 seconds"; \
		exit 1; \
	}
	@echo "Service on port $(1) is available"
endef

# Parameterized dev target to start services with specific agent target
dev: stop
	@echo "Starting development environment with default agent target: Adder"; \
	make start-wsAdder
	@echo "Waiting for Agent service to start..."
	$(call check_port_available,5000)
	@make start-mcp-client start-web
	@echo "All services started:"
	@echo "- UCAgent (port 5000): Check $(UCAGENT_DIR) directory"
	@echo "- MCP Client (port 8000): Running in $(CURRENT_DIR)"
	@echo "- WebSocket (port 8080): Running in $(CURRENT_DIR)"
	@echo "- Web Interface (port 5173): Running in $(CURRENT_DIR)"
	@echo ""
	@echo "Access the web interface at: http://127.0.0.1:5173"
	@echo ""
	@echo "To stop all services, run: make stop"
	@$(MAKE) status

dev%: stop
	@TARGET=$(patsubst dev%,%,$@); \
	if [ "$$TARGET" = "" ]; then \
		TARGET=Adder; \
	fi; \
	echo "Starting development environment with agent target: $$TARGET"; \
	make start-ws$$TARGET
	@echo "Waiting for Agent service to start..."
	$(call check_port_available,5000)
	@make start-mcp-client start-web
	@echo "All services started:"
	@echo "- UCAgent (port 5000): Check $(UCAGENT_DIR) directory"
	@echo "- MCP Client (port 8000): Running in $(CURRENT_DIR)"
	@echo "- WebSocket (port 8080): Running in $(CURRENT_DIR)"
	@echo "- Web Interface (port 5173): Running in $(CURRENT_DIR)"
	@echo ""
	@echo "Access the web interface at: http://127.0.0.1:5173"
	@echo ""
	@echo "To stop all services, run: make stop"
	@$(MAKE) status

# Show status
status: check-running