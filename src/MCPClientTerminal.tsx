import { useState, useEffect, useRef } from 'react';

// Base API endpoint for the MCP client (which connects to the Agent)
const API_BASE = 'http://127.0.0.1:8000';

type CommandHistory = {
  command: string;
  result: any;
  timestamp: string;
};

const TERMINAL_STORAGE_KEY = 'mcp-client-terminal-history';

const MCPClientTerminal = () => {
  const [rawOutput, setRawOutput] = useState<string>(''); // Raw server output
  const [commandOutput, setCommandOutput] = useState<string>(''); // Command execution output
  const [inputValue, setInputValue] = useState<string>('');
  const [connectionStatus, setConnectionStatus] = useState<'disconnected' | 'connecting' | 'connected'>('connecting');
  const [commandHistory, setCommandHistory] = useState<CommandHistory[]>([]);
  const [currentPrompt, setCurrentPrompt] = useState<string>('user@mcp-client:~$ ');
  const [availableTools, setAvailableTools] = useState<any[]>([]);
  const [availableResources, setAvailableResources] = useState<any[]>([]);
  const terminalRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const pollingInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  // Combined output for display
  const output = rawOutput + commandOutput;

  // Function to connect to the backend and check health
  const connectToBackend = async () => {
    setConnectionStatus('connecting');
    setCurrentPrompt('user@mcp-client:~$ '); // Reset prompt during connection

    try {
      // Check if the backend is available using the health endpoint
      const response = await fetch(`${API_BASE}/health`);
      if (response.ok) {
        const healthData = await response.json();
        setConnectionStatus('connected');
        setCurrentPrompt('user@mcp-client:~$ '); // Set connected prompt

        // Get initial output
        const initialOutputResponse = await fetch(`${API_BASE}/output`);
        if (initialOutputResponse.ok) {
          const initialOutputData = await initialOutputResponse.json();
          setRawOutput(initialOutputData.output || '');
        } else {
          setRawOutput(prev => prev + 'Connected to mcp-client.py\nStatus: ' + healthData.message + '\n');
        }

        // Fetch available tools
        const toolsResponse = await fetch(`${API_BASE}/tools`);
        if (toolsResponse.ok) {
          const toolsData = await toolsResponse.json();
          setAvailableTools(toolsData.tools || []);
        }

        // Fetch available resources
        const resourcesResponse = await fetch(`${API_BASE}/resources`);
        if (resourcesResponse.ok) {
          const resourcesData = await resourcesResponse.json();
          setAvailableResources(resourcesData.resources || []);
        }

        // Start polling for output updates (from MCPClientTerminal functionality)
        if (pollingInterval.current) {
          clearInterval(pollingInterval.current);
        }

        pollingInterval.current = setInterval(async () => {
          try {
            const outputResponse = await fetch(`${API_BASE}/output`);
            if (outputResponse.ok) {
              const outputData = await outputResponse.json();
              setRawOutput(outputData.output || '');
            }
          } catch (error) {
            console.error('Error polling output:', error);
          }
        }, 1000); // Poll every 1 second for fresh output
      } else {
        throw new Error('Backend server responded with error');
      }
    } catch (error) {
      console.error('Connection failed:', error);
      setRawOutput(prev => prev + `Connection failed: ${(error as Error).message}\n`);
      setConnectionStatus('disconnected');
      setCurrentPrompt('user@mcp-client:~$ '); // Still show the prompt even when disconnected
    }
  };

  // Function to disconnect from the backend (from MCPClientTerminal functionality)
  const disconnectFromBackend = () => {
    if (pollingInterval.current) {
      clearInterval(pollingInterval.current);
      pollingInterval.current = null;
    }
    setConnectionStatus('disconnected');
    setRawOutput(prev => prev + 'Disconnected from mcp-client.py\n');
  };

  // Load command history from localStorage on component mount
  useEffect(() => {
    const savedHistory = localStorage.getItem(TERMINAL_STORAGE_KEY);
    if (savedHistory) {
      try {
        setCommandHistory(JSON.parse(savedHistory));
      } catch (error) {
        console.error('Failed to parse saved command history:', error);
        setCommandHistory([]);
      }
    }
  }, []);

  // Save command history to localStorage whenever it changes
  useEffect(() => {
    localStorage.setItem(TERMINAL_STORAGE_KEY, JSON.stringify(commandHistory));
  }, [commandHistory]);

  // Function to execute a command
  const executeCommand = async (command: string) => {
    if (!command.trim()) return;

    // Add command to command output
    const commandLine = `${currentPrompt}${command}\n`;
    setCommandOutput(prev => prev + commandLine);

    try {
      // Parse command - check if it's a special command or a tool call
      if (command.trim() === 'help') {
        // Show available tools
        if (availableTools.length > 0) {
          let helpText = 'Available tools:\n';
          availableTools.forEach(tool => {
            helpText += `  ${tool.name}: ${tool.description || 'No description'}\n`;
          });
          setCommandOutput(prev => prev + helpText + '\n');
        } else {
          setCommandOutput(prev => prev + 'No tools available\n\n');
        }
      } else if (command.trim() === 'ls' || command.trim() === 'tools') {
        // List available tools
        if (availableTools.length > 0) {
          let toolsList = 'Available tools:\n';
          availableTools.forEach(tool => {
            toolsList += `  - ${tool.name}\n`;
          });
          setCommandOutput(prev => prev + toolsList + '\n');
        } else {
          setCommandOutput(prev => prev + 'No tools available\n\n');
        }
      } else if (command.trim() === 'resources') {
        // List available resources
        if (availableResources.length > 0) {
          let resourcesList = 'Available resources:\n';
          availableResources.forEach(resource => {
            resourcesList += `  - ${resource.name} (${resource.uri})\n`;
          });
          setCommandOutput(prev => prev + resourcesList + '\n');
        } else {
          setCommandOutput(prev => prev + 'No resources available\n\n');
        }
      } else if (command.trim() === 'clear') {
        // Clear the terminal
        setRawOutput('');
        setCommandOutput('');
        setCommandHistory([]);
      } else if (command.startsWith('get_resource ')) {
        // Get a specific resource
        const uri = command.substring('get_resource '.length).trim();
        if (uri) {
          const resourceResponse = await fetch(`${API_BASE}/resources/${encodeURIComponent(uri)}`);
          if (resourceResponse.ok) {
            const resourceData = await resourceResponse.json();
            setCommandOutput(prev => prev + `Resource status: ${resourceData.content}\n\n`);
          } else {
            const errorText = await resourceResponse.text();
            throw new Error(`Failed to get resource: ${errorText}`);
          }
        } else {
          setCommandOutput(prev => prev + 'Usage: get_resource <uri>\n\n');
        }
      } else if (command.startsWith('notify ')) {
        // Send a notification
        const message = command.substring('notify '.length).trim();
        if (message) {
          const notifyResponse = await fetch(`${API_BASE}/notifications/send`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message, level: 'info' })
          });
          if (notifyResponse.ok) {
            const notifyData = await notifyResponse.json();
            setCommandOutput(prev => prev + `Notification sent: ${notifyData.status}\n\n`);
          } else {
            const errorText = await notifyResponse.text();
            throw new Error(`Failed to send notification: ${errorText}`);
          }
        } else {
          setCommandOutput(prev => prev + 'Usage: notify <message>\n\n');
        }
      } else {
        // Parse command as tool call - expecting format: "tool_name {json_args}" or "tool_name"
        const parts = command.trim().split(/\s+(.*)/s); // Split on first whitespace
        const toolName = parts[0];
        let argsStr = parts[1] || '{}';

        // If argsStr doesn't start with '{', treat the whole thing as a single string argument
        let args = {};
        if (argsStr.trim().startsWith('{')) {
          try {
            args = JSON.parse(argsStr);
          } catch (e) {
            // If JSON parsing fails, show error
            setCommandOutput(prev => prev + `Error parsing arguments as JSON: ${(e as Error).message}\n\n`);
            return;
          }
        } else {
          // Treat the rest as a single string argument
          args = { input: argsStr };
        }

        // Call the tool via the MCP client
        const response = await fetch(`${API_BASE}/tools/call`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tool_name: toolName,
            arguments: args
          })
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`HTTP ${response.status}: ${errorText}`);
        }

        const data = await response.json();

        // Format and add result to output
        let resultStr = '';
        if (typeof data.result === 'string') {
          resultStr = data.result;
        } else if (typeof data.result === 'object') {
          // Check if it's a structured response with content array
          if (data.result && Array.isArray(data.result.content)) {
            // Extract text content from structured response
            const textItem = data.result.content.find((item: any) => item && item.type === 'text');
            if (textItem && textItem.text) {
              resultStr = textItem.text;
            } else {
              resultStr = JSON.stringify(data.result, null, 2);
            }
          } else {
            resultStr = JSON.stringify(data.result, null, 2);
          }
        } else {
          resultStr = String(data.result);
        }

        setCommandOutput(prev => prev + resultStr + '\n\n');

        // Update the last command in history with the result
        setCommandHistory(prev => {
          const updatedHistory = [...prev];
          if (updatedHistory.length > 0) {
            updatedHistory[updatedHistory.length - 1] = {
              ...updatedHistory[updatedHistory.length - 1],
              result: data.result
            };
          }
          return updatedHistory;
        });
      }
    } catch (error) {
      const errorMsg = `Error: ${(error as Error).message}`;
      setCommandOutput(prev => prev + errorMsg + '\n\n');

      // Update the last command in history with the error
      setCommandHistory(prev => {
        const updatedHistory = [...prev];
        if (updatedHistory.length > 0) {
          updatedHistory[updatedHistory.length - 1] = {
            ...updatedHistory[updatedHistory.length - 1],
            result: { error: (error as Error).message }
          };
        }
        return updatedHistory;
      });
    }

    // Scroll to bottom
    scrollToBottom();
  };

  // Handle form submission
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputValue.trim()) {
      executeCommand(inputValue.trim());
      setInputValue('');
    }
  };

  // Handle key press in input
  const [historyIndex, setHistoryIndex] = useState<number>(-1);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      // Add current command to history
      if (inputValue.trim()) {
        const newCommand: CommandHistory = {
          command: inputValue.trim(),
          result: null, // We'll update this when the command executes
          timestamp: new Date().toLocaleTimeString()
        };
        setCommandHistory(prev => [...prev, newCommand]);
        setHistoryIndex(-1); // Reset history index after executing a new command
      }
      handleSubmit(e as any);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      // Navigate up in command history
      if (commandHistory.length > 0) {
        let newIndex = historyIndex;
        if (newIndex === -1) {
          // If we're not in history yet, start from the last command
          newIndex = commandHistory.length - 1;
        } else if (newIndex > 0) {
          // Move to the previous command
          newIndex--;
        }
        setInputValue(commandHistory[newIndex].command);
        setHistoryIndex(newIndex);
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      // Navigate down in command history
      if (historyIndex !== -1) {
        if (historyIndex < commandHistory.length - 1) {
          // Move to the next command
          const newIndex = historyIndex + 1;
          setInputValue(commandHistory[newIndex].command);
          setHistoryIndex(newIndex);
        } else {
          // If we're at the latest command, clear the input
          setInputValue('');
          setHistoryIndex(-1);
        }
      }
    }
  };

  // Scroll to bottom of terminal
  const scrollToBottom = () => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  };

  // Clear terminal output
  const clearTerminal = async () => {
    try {
      await fetch(`${API_BASE}/output/clear`, { method: 'POST' });
      setRawOutput('');
      setCommandOutput('');
      setCommandHistory([]);
    } catch (error) {
      console.error('Error clearing output:', error);
      setCommandOutput(prev => prev + `Error clearing output: ${(error as Error).message}\n`);
    }
  };

  // Initialize connection
  useEffect(() => {
    connectToBackend();

    // Cleanup function to clear interval when component unmounts
    return () => {
      if (pollingInterval.current) {
        clearInterval(pollingInterval.current);
      }
    };
  }, []);

  // Focus input when component mounts
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus();
    }
  }, []);

  // Scroll to bottom when output changes
  useEffect(() => {
    scrollToBottom();
  }, [output]);

  return (
    <div className="flex flex-col h-full w-full bg-gray-900 text-green-400 font-mono text-sm p-4 rounded-lg border border-gray-700">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-4 gap-2">
        <h2 className="text-lg font-bold text-white">MCP Client Terminal</h2>
        <div className="flex flex-wrap gap-2">
          <div className="flex items-center">
            <div className={`w-3 h-3 rounded-full mr-2 ${
              connectionStatus === 'connected' ? 'bg-green-500' :
              connectionStatus === 'connecting' ? 'bg-yellow-500' : 'bg-red-500'
            }`}></div>
            <span className="text-xs">
              {connectionStatus === 'connected' ? 'Connected' :
               connectionStatus === 'connecting' ? 'Connecting...' : 'Disconnected'}
            </span>
          </div>
          <button
            onClick={connectionStatus === 'connected' ? disconnectFromBackend : connectToBackend}
            className={`px-4 py-2 rounded ${
              connectionStatus === 'connected'
                ? 'bg-red-600 hover:bg-red-700'
                : 'bg-blue-600 hover:bg-blue-700'
            } text-white text-sm`}
          >
            {connectionStatus === 'connected' ? 'Disconnect' : 'Reconnect'}
          </button>
          <button
            onClick={clearTerminal}
            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded text-white text-sm"
          >
            Clear
          </button>
        </div>
      </div>

      <div
        ref={terminalRef}
        className="flex-grow overflow-y-auto bg-black p-4 rounded mb-2 min-h-0 w-full cursor-text"
        onClick={() => inputRef?.current?.focus()}
      >
        <pre className="whitespace-pre-wrap break-all w-full font-mono">
          {output}
          <div className="flex items-center">
            <span className="text-green-400">{currentPrompt}</span>
            <input
              ref={inputRef}
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              className="flex-grow bg-transparent text-green-400 font-mono outline-none caret-white"
              autoComplete="off"
              spellCheck="false"
              placeholder="Type a command..."
            />
          </div>
        </pre>
      </div>

      <div className="text-xs text-gray-500 mt-2">
        Note: This terminal connects to the Agent via the MCP client running on port 8000.
        Enter commands to interact with available tools. Try 'help', 'ls', 'resources', 'get_resource', 'notify', or 'clear'.
      </div>
    </div>
  );
};

export default MCPClientTerminal;