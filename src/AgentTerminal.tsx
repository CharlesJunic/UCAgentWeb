import { useState, useEffect, useRef } from 'react';

type CommandHistory = {
  command: string;
  result: any;
  timestamp: string;
};

const TERMINAL_STORAGE_KEY = 'ucagent-agent-terminal-history';

const AgentTerminal = () => {
  const [output, setOutput] = useState<string>('');
  const [inputValue, setInputValue] = useState<string>('');
  const [connectionStatus, setConnectionStatus] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected');
  const [commandHistory, setCommandHistory] = useState<CommandHistory[]>([]);
  const [currentPrompt, setCurrentPrompt] = useState<string>('user@ucagent:~$ ');
  const terminalRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const wsRef = useRef<WebSocket | null>(null);

  // Function to connect to WebSocket
  const connectWebSocket = () => {
    setConnectionStatus('connecting');

    try {
      // Connect to WebSocket server
      const ws = new WebSocket('ws://127.0.0.1:8080');

      ws.onopen = () => {
        setConnectionStatus('connected');
        setCurrentPrompt('user@ucagent:~$ ');
        setOutput(prev => prev + 'Connected to Agent terminal.\nType commands to interact with the Agent.\n\n');
      };

      ws.onmessage = (event) => {
        try {
          // Try to parse the message as JSON to handle different message types
          const data = JSON.parse(event.data);

          if (typeof data === 'object' && data.type) {
            switch (data.type) {
              case 'output':
                setOutput(prev => prev + data.data);
                break;
              case 'echo':
                setOutput(prev => prev + data.data);
                break;
              case 'error':
                setOutput(prev => prev + `[ERROR] ${data.data}\n`);
                break;
              case 'pong':
                // Ping/pong response - no action needed
                break;
              default:
                // Unknown message type, treat as raw output
                setOutput(prev => prev + event.data);
            }
          } else {
            // Raw string message
            setOutput(prev => prev + event.data);
          }
        } catch (e) {
          // If parsing fails, treat as raw string
          setOutput(prev => prev + event.data);
        }
      };

      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        setConnectionStatus('disconnected');
      };

      ws.onclose = () => {
        setConnectionStatus('disconnected');
        setOutput(prev => prev + 'Disconnected from Agent terminal.\n');
      };

      wsRef.current = ws;
    } catch (error) {
      console.error('Failed to connect to WebSocket:', error);
      setConnectionStatus('disconnected');
      setOutput(prev => prev + `Connection failed: ${(error as Error).message}\n`);
    }
  };

  // Function to disconnect from WebSocket
  const disconnectWebSocket = () => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
      setConnectionStatus('disconnected');
      setOutput(prev => prev + 'Disconnected from Agent terminal.\n');
    }
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

    // Add command to output
    const commandLine = `${currentPrompt}${command}\n`;
    setOutput(prev => prev + commandLine);

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      // Send command to the Agent terminal via WebSocket
      const message = JSON.stringify({ type: 'input', data: command });
      wsRef.current.send(message);
    } else {
      setOutput(prev => prev + 'Not connected to Agent terminal.\n');
    }

    // Add command to history
    const newCommand: CommandHistory = {
      command: command,
      result: null,
      timestamp: new Date().toLocaleTimeString()
    };
    setCommandHistory(prev => [...prev, newCommand]);
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
    setOutput('');
    setCommandHistory([]);
  };

  // Initialize connection
  useEffect(() => {
    connectWebSocket();

    // Cleanup function to close WebSocket connection when component unmounts
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
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
        <h2 className="text-lg font-bold text-white">Agent Terminal</h2>
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
            onClick={connectionStatus === 'connected' ? disconnectWebSocket : connectWebSocket}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded text-white text-sm"
          >
            {connectionStatus === 'connected' ? 'Disconnect' : 'Connect'}
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
        Note: This terminal connects directly to the Agent terminal via WebSocket.
        Enter commands to interact with the Agent. Try 'help', 'ls', or 'clear'.
      </div>
    </div>
  );
};

export default AgentTerminal;