import { useState, useEffect } from 'react';
import './components/AgentConsole.css'; // Import animation CSS
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * Type definitions for the application
 */
type Tool = {
  name: string;
  description?: string;
  inputSchema?: object;
};

type Status = {
  text: string;
  type: 'loading' | 'success' | 'warning' | 'error';
};

type CallResult = {
  success: boolean;
  hasErrorContent?: boolean; // Indicates if the call was successful but returned an error message
  data?: any;
  error?: string;
  timestamp: string;
};

// Base API endpoint for the MCP server
const API_BASE = 'http://127.0.0.1:8000';

function AgentConsole() {
  // State variables for the application
  const [tools, setTools] = useState<Tool[]>([]); // List of available tools from the server
  const [status, setStatus] = useState<Status>({ text: 'Connecting to server...', type: 'loading' }); // Connection status
  const [selectedTool, setSelectedTool] = useState<Tool | null>(null); // Currently selected tool
  const [toolArgs, setToolArgs] = useState<string>('{}'); // Arguments for the selected tool (as JSON string)
  const [callResult, setCallResult] = useState<CallResult | null>(null); // Result of the last tool call
  const [isCalling, setIsCalling] = useState<boolean>(false); // Flag indicating if a tool call is in progress
  const [jsonError, setJsonError] = useState<string>(''); // Error message for invalid JSON
  const [expandedSchema, setExpandedSchema] = useState<{[key: string]: boolean}>({}); // Track expanded/collapsed state for each tool schema
  const [expandedResult, setExpandedResult] = useState<boolean>(false); // Track if full result is expanded
  const [isMarkdown, setIsMarkdown] = useState<boolean>(false); // Track if content should be rendered as markdown
  const [copySuccess, setCopySuccess] = useState<boolean>(false); // Track copy success state

  // Fetch available tools from the MCP server on component mount
  useEffect(() => {
    const fetchTools = async () => {
      try {
        const response = await fetch(`${API_BASE}/tools`);

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        setTools(data.tools || []);

        const toolCount = data.tools?.length || 0;
        setStatus({
          text: toolCount > 0 ? `Ready · Found ${toolCount} available tools` : 'Ready · No tools available',
          type: toolCount > 0 ? 'success' : 'warning'
        });
      } catch (error) {
        console.error('Failed to fetch tools:', error);
        setStatus({
          text: 'Connection failed · Please ensure API server is running on localhost:8000',
          type: 'error'
        });
      }
    };

    fetchTools();
  }, []);

  /**
   * Validates JSON string format
   * @param jsonString - The JSON string to validate
   * @returns Parsed JSON object if valid, null otherwise
   */
  const validateJson = (jsonString: string): any | null => {
    try {
      if (jsonString.trim() === '') {
        setJsonError('Please enter JSON arguments');
        return null;
      }
      const parsed = JSON.parse(jsonString);
      setJsonError('');
      return parsed;
    } catch (error) {
      setJsonError('Invalid JSON format: ' + (error as Error).message);
      return null;
    }
  };

  /**
   * Calls the selected tool with provided arguments
   */
  const handleCallTool = async () => {
    if (!selectedTool) return;

    const args = validateJson(toolArgs);
    if (args === null && jsonError) return;

    setIsCalling(true);
    setCallResult(null);

    try {
      const response = await fetch(`${API_BASE}/tools/call`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tool_name: selectedTool.name,
          arguments: args || {}
        })
      });

      const data = await response.json();

      // Check if the response contains an error despite the call being successful
      let hasErrorContent = false;
      if (data.result) {
        // Check if the result contains error information
        if (typeof data.result === 'object' && data.result.error) {
          hasErrorContent = true;
        } else if (typeof data.result === 'object' && data.result.is_error) {
          // Check for is_error flag in the result
          hasErrorContent = Boolean(data.result.is_error);
        } else if (typeof data.result === 'string' &&
                   (data.result.toLowerCase().includes('error:') ||
                    data.result.toLowerCase().startsWith('error ') ||
                    data.result.toLowerCase().match(/\berror\b.*:/) ||
                    data.result.includes('[ERROR]') ||
                    data.result.includes('[error]'))) {
          // More specific check for error strings - looks for patterns like "error:", "error ", or "word error:"
          hasErrorContent = true;
        } else if (Array.isArray(data.result) && data.result.some((item: any) =>
          typeof item === 'object' && (item.error || (item.is_error && item.is_error === true))
        )) {
          hasErrorContent = true;
        } else if (typeof data.result === 'object' && Array.isArray(data.result.content)) {
          // Check if content array has error information
          const textItem = data.result.content.find((item: any) =>
            item && item.type === 'text' && typeof item.text === 'string'
          );
          if (textItem && textItem.text &&
              (textItem.text.toLowerCase().includes('error:') ||
               textItem.text.toLowerCase().startsWith('error ') ||
               textItem.text.toLowerCase().match(/\berror\b.*:/) ||
               textItem.text.includes('[ERROR]') ||
               textItem.text.includes('[error]'))) {
            hasErrorContent = true;
          }
        }
      }

      setCallResult({
        success: true,
        hasErrorContent: hasErrorContent,
        data: data.result,
        timestamp: new Date().toLocaleTimeString()
      });
    } catch (error) {
      setCallResult({
        success: false,
        error: (error as Error).message,
        timestamp: new Date().toLocaleTimeString()
      });
    } finally {
      setIsCalling(false);
    }
  };

  /**
   * Loads example arguments for the selected tool
   */
  const loadExampleArgs = () => {
    if (!selectedTool) return;

    // Define example arguments for different tool types
    const examples: Record<string, string> = {
      'search_web': '{"query": "latest AI developments", "limit": 5}',
      'calculate': '{"expression": "(15 * 3) + (42 / 7)"}',
      'get_weather': '{"city": "Beijing", "days": 3}',
      'ReadTextFile': '{"path": "example.txt", "start": 1, "count": 10}',
      'RoleInfo': '{}',
      'CurrentTips': '{}',
      'Detail': '{}',
      'Status': '{}',
      'RunTestCases': '{}',
      'Check': '{}',
      'KillCheck': '{}',
      'StdCheck': '{}',
      'Complete': '{}',
      'GoToStage': '{}',
      'Exit': '{}'
    };

    const example = examples[selectedTool.name] || '{"example": "value"}';
    setToolArgs(example);
    setJsonError('');
  };

  /**
   * Toggles the expanded/collapsed state for a tool's input schema
   * @param toolName - Name of the tool to toggle
   */
  const toggleSchema = (toolName: string) => {
    setExpandedSchema(prev => ({
      ...prev,
      [toolName]: !prev[toolName]
    }));
  };

  /**
   * Toggles the expanded/collapsed state for the full result
   */
  const toggleResult = () => {
    setExpandedResult(!expandedResult);
  };

  /**
   * Toggles the markdown rendering mode
   */
  const toggleMarkdown = () => {
    setIsMarkdown(!isMarkdown);
  };

  /**
   * Copies the result to clipboard and shows success message
   */
  const copyResultToClipboard = () => {
    if (callResult?.data) {
      navigator.clipboard.writeText(JSON.stringify(callResult.data, null, 2))
        .then(() => {
          setCopySuccess(true);
          // Reset the success message after 2 seconds
          setTimeout(() => {
            setCopySuccess(false);
          }, 2000);
        })
        .catch(err => {
          console.error('Failed to copy: ', err);
        });
    }
  };

  /**
   * Extracts text content from the result if it follows the expected structure
   * @param data - The result data from the tool call
   * @returns The extracted text content or the original data as JSON string
   */
  const extractTextContent = (data: any): string => {
    try {
      // Check if data has the expected structure with content array
      if (data && typeof data === 'object' && Array.isArray(data.content)) {
        // Find the first item with type 'text'
        const textItem = data.content.find((item: any) => item && item.type === 'text');
        if (textItem && textItem.text) {
          // Check if the text contains an error message
          if (typeof textItem.text === 'string' && textItem.text.includes('"error"')) {
            try {
              const parsed = JSON.parse(textItem.text);
              if (parsed.error) {
                return `error: ${parsed.error}`;
              }
            } catch (e) {
              // If parsing fails, return the original text
              return textItem.text;
            }
          }
          return textItem.text;
        }
      }
      // If the expected structure isn't found, return the original data as JSON string
      return JSON.stringify(data, null, 2);
    } catch (error) {
      console.error('Error extracting text content:', error);
      return JSON.stringify(data, null, 2);
    }
  };

  /**
   * Status indicator component showing connection status
   */
  const StatusIndicator = ({ type }: { type: Status['type'] }) => {
    const colors = {
      loading: 'bg-blue-500',
      success: 'bg-green-500',
      warning: 'bg-yellow-500',
      error: 'bg-red-500'
    };

    return (
      <div className={`inline-block w-3 h-3 rounded-full mr-2 ${colors[type] || colors.loading}`}></div>
    );
  };

  // Helper function to determine if a tool has parameters
  const toolHasParameters = (tool: Tool): boolean => {
    if (!tool.inputSchema) return false;

    // Type assertion to treat inputSchema as an object with properties
    const schema = tool.inputSchema as any;
    if (!schema.properties) return false;

    // Check if properties object has any keys
    return Object.keys(schema.properties).length > 0;
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 p-4 md:p-8">
      <div className="w-full">
        {/* Top header section */}
        <header className="mb-8">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <h1 className="text-3xl md:text-4xl font-bold leading-none bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent pb-1">
                UCAgent MCP Console
              </h1>
              <p className="text-slate-600 mt-3">
                Connect, discover and call remote tool services
              </p>
            </div>
            <div className="flex items-center justify-end">
              <div className="flex items-center bg-white px-4 py-2 rounded-lg shadow-sm border border-slate-200">
                <StatusIndicator type={status.type} />
                <span className={`text-sm font-medium ${
                  status.type === 'error' ? 'text-red-600' :
                  status.type === 'success' ? 'text-green-600' :
                  status.type === 'warning' ? 'text-yellow-600' :
                  'text-blue-600'
                }`}>
                  {status.text}
                </span>
              </div>
            </div>
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left panel: Tool list */}
          <div className="lg:col-span-1">
            <div className="bg-white rounded-2xl shadow-lg border border-slate-200 p-6 h-full">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-bold text-slate-800 flex items-center">
                  Available Tools
                </h2>
                <span className="bg-gradient-to-r from-blue-500 to-indigo-500 text-white text-sm font-medium px-3 py-1 rounded-full">
                  {tools.length} tools
                </span>
              </div>

              <div className="space-y-4 max-h-[calc(100vh-300px)] overflow-y-auto pr-2 relative">
                {tools.length === 0 ? (
                  <div className="text-center py-12">
                    <div className="text-slate-400 mb-4 text-5xl">🔍</div>
                    <p className="text-slate-500 text-lg">No tools available</p>
                    <p className="text-sm text-slate-400 mt-2">Please check server connection</p>
                  </div>
                ) : (
                  tools.map(tool => (
                    <div
                      key={tool.name}
                      className={`p-4 rounded-xl border-2 cursor-pointer transition-all duration-200 hover:shadow-lg ${
                        selectedTool?.name === tool.name
                          ? 'border-indigo-500 bg-indigo-50 shadow-md'
                          : 'border-slate-200 hover:border-indigo-300 hover:bg-indigo-5'
                      }`}
                      onClick={() => {
                        setSelectedTool(tool);
                        setToolArgs('{}');
                        setJsonError('');
                      }}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center">
                            <h3 className="font-semibold text-slate-800">{tool.name}</h3>
                            {toolHasParameters(tool) && (
                              <span className="ml-2 bg-blue-100 text-blue-800 text-xs px-2 py-0.5 rounded-full">
                                Requires params
                              </span>
                            )}
                          </div>
                          <p className="text-sm text-slate-600 mt-2 text-left break-words">
                            {tool.description || 'No description'}
                          </p>
                        </div>
                        {selectedTool?.name === tool.name && (
                          <div className="bg-gradient-to-r from-indigo-500 to-purple-500 text-white text-xs px-2 py-1 rounded-full ml-2">
                            Selected
                          </div>
                        )}
                      </div>
                      {toolHasParameters(tool) && (
                        <div className="mt-3 pt-3 border-t border-slate-100">
                          <div className="flex items-center justify-between">
                            <p className="text-xs text-slate-500 font-medium">Input Schema:</p>
                            <button
                              onClick={(e) => {
                                e.stopPropagation(); // Prevent triggering tool selection
                                toggleSchema(tool.name);
                              }}
                              className="text-xs text-indigo-600 hover:text-indigo-800 font-medium"
                            >
                              {expandedSchema[tool.name] ? 'Collapse' : 'Expand'}
                            </button>
                          </div>
                          {expandedSchema[tool.name] && (
                            <pre className="text-xs text-slate-600 mt-1 overflow-x-auto bg-slate-50 p-2 rounded text-left">
                              {JSON.stringify(tool.inputSchema, null, 2)}
                            </pre>
                          )}
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* Right panel: Tool invocation panel */}
          <div className="lg:col-span-2">
            <div className="bg-white rounded-2xl shadow-lg border border-slate-200 p-6 h-full">
              {!selectedTool ? (
                <div className="text-center py-16">
                  <h3 className="text-2xl font-semibold text-slate-700 mb-4">
                    Please select a tool to use
                  </h3>
                  <p className="text-slate-500 max-w-md mx-auto">
                    Select a tool from the left list to configure parameters and execute
                  </p>
                </div>
              ) : (
                <>
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-6 gap-4">
                    <div>
                      <h2 className="text-2xl font-bold text-slate-800 flex items-center">
                        <span className="mr-2">⚙️</span>
                        {selectedTool.name}
                      </h2>
                      <p className="text-slate-600 mt-1">
                        {selectedTool.description || 'Tool invocation panel'}
                      </p>
                    </div>
                    <button
                      onClick={() => {
                        setSelectedTool(null);
                        setCallResult(null);
                      }}
                      className="self-start sm:self-auto px-4 py-2 text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
                    >
                      ✕ Deselect
                    </button>
                  </div>

                  {/* Parameters input area */}
                  <div className="mb-8">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-4 gap-2">
                      <label className="block text-sm font-semibold text-slate-700 flex items-center">
                        <span className="mr-2">📋</span>
                        Call Parameters (JSON Format)
                      </label>
                      <button
                        onClick={loadExampleArgs}
                        className="self-start sm:self-auto text-sm text-indigo-600 hover:text-indigo-800 font-medium flex items-center"
                      >
                        <span className="mr-1">💡</span>
                        Load Example Parameters
                      </button>
                    </div>

                    <div className={`rounded-xl border-2 ${
                      jsonError ? 'border-red-300 bg-red-50' : 'border-slate-200'
                    } overflow-hidden transition-colors duration-200`}>
                      <textarea
                        value={toolArgs}
                        onChange={(e) => {
                          setToolArgs(e.target.value);
                          if (e.target.value.trim() !== '') {
                            validateJson(e.target.value);
                          }
                        }}
                        placeholder={`{
  "param_name": "param_value",
  "number_param": 42,
  "boolean_param": true
}`}
                        rows={8}
                        className="w-full p-4 font-mono text-sm resize-none focus:outline-none bg-white"
                        spellCheck="false"
                      />
                    </div>

                    {jsonError && (
                      <div className="mt-2 flex items-center text-red-600 text-sm bg-red-50 p-2 rounded-lg">
                        <span className="mr-2">⚠️</span>
                        {jsonError}
                      </div>
                    )}

                    <div className="mt-4 flex justify-end">
                      <button
                        onClick={handleCallTool}
                        disabled={isCalling || !!jsonError}
                        className={`px-6 py-3 rounded-xl font-semibold transition-all duration-200 flex items-center ${
                          isCalling || jsonError
                            ? 'bg-slate-300 cursor-not-allowed text-slate-500'
                            : 'bg-gradient-to-r from-indigo-500 to-purple-500 hover:from-indigo-600 hover:to-purple-600 text-white shadow-lg hover:shadow-xl transform hover:-translate-y-0.5'
                        }`}
                      >
                        {isCalling ? (
                          <>
                            <span className="inline-block animate-spin mr-2">⏳</span>
                            Calling...
                          </>
                        ) : (
                          <>
                            Execute Tool Call
                          </>
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Execution result area */}
                  {callResult && (
                    <div className="mt-8 pt-8 border-t border-slate-200">
                      <div className="flex flex-col md:flex-row md:items-center md:justify-between mb-4 gap-2">
                        <h3 className="text-xl font-bold text-slate-800 flex items-center text-left">
                          <span className="mr-2">📊</span>
                          Execution Result
                        </h3>
                        <div className="flex flex-wrap items-center gap-3 text-sm text-slate-500">
                          <span className="flex items-center">
                            <span className="mr-1">⏰</span>
                            {callResult.timestamp}
                          </span>
                          <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                            callResult.success && !callResult.hasErrorContent
                              ? 'bg-green-100 text-green-800'
                              : 'bg-red-100 text-red-800'
                          }`}>
                            {callResult.success && !callResult.hasErrorContent ? '✅ Success' :
                             callResult.success && callResult.hasErrorContent ? '❌ Error Content' :
                             '❌ Failed'}
                          </span>
                        </div>
                      </div>

                      <div className={`rounded-xl p-4 ${
                        callResult.success && !callResult.hasErrorContent
                          ? 'bg-green-50 border border-green-200'
                          : callResult.hasErrorContent
                            ? 'bg-yellow-50 border border-yellow-200'
                            : 'bg-red-50 border border-red-200'
                      }`}>
                        {(callResult.success && callResult.data) || (callResult.success && callResult.hasErrorContent) ? (
                          <>
                            {isMarkdown ? (
                              <div className="prose prose-slate max-w-none text-left">
                                <ReactMarkdown
                                  remarkPlugins={[remarkGfm]}
                                  children={extractTextContent(callResult.data)}
                                />
                              </div>
                            ) : (
                              <pre className="text-sm overflow-x-auto whitespace-pre-wrap break-words font-mono text-left">
                                {extractTextContent(callResult.data)}
                              </pre>
                            )}
                            <div className="mt-2 text-right">
                              <button
                                onClick={toggleMarkdown}
                                className="text-xs text-indigo-600 hover:text-indigo-800 font-medium mr-2"
                              >
                                {isMarkdown ? 'Show Raw' : 'Render Markdown'}
                              </button>
                              <button
                                onClick={toggleResult}
                                className="text-xs text-indigo-600 hover:text-indigo-800 font-medium"
                              >
                                {expandedResult ? 'Show Less' : 'Show Full Result'}
                              </button>
                            </div>
                            {expandedResult && (
                              <div className="mt-3 pt-3 border-t border-slate-200">
                                <h4 className="text-sm font-semibold text-slate-700 mb-2">Full Result:</h4>
                                <pre className="text-xs overflow-x-auto whitespace-pre-wrap break-words font-mono text-left bg-slate-100 p-2 rounded">
                                  {JSON.stringify(callResult.data, null, 2)}
                                </pre>
                              </div>
                            )}
                          </>
                        ) : (
                          <pre className="text-sm overflow-x-auto whitespace-pre-wrap break-words font-mono text-left">
                            {JSON.stringify(callResult.error, null, 2)}
                          </pre>
                        )}
                      </div>

                      {(callResult.success && !callResult.hasErrorContent) && (
                        <div className="mt-4 flex justify-end">
                          <button
                            onClick={copyResultToClipboard}
                            className="text-sm text-slate-600 hover:text-slate-800 font-medium flex items-center mr-2"
                          >
                            <span className="mr-1">📋</span>
                            {copySuccess ? 'Copied!' : 'Copy Result'}
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>

        {/* Footer information bar */}
        <footer className="mt-8 text-center text-slate-500 text-sm">
          <p>UCAgent Console · API Endpoint: {API_BASE} · Ensure backend service is running</p>
        </footer>
      </div>
    </div>
  );
}

export default AgentConsole;