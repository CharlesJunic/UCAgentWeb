import { useState, useEffect } from 'react';

interface Stage {
  index: number;
  title: string;
  reached: boolean;
  fail_count: number;
  is_skipped: boolean;
  time_cost: string;
  needs_human_check: boolean;
}

interface AgentStatus {
  mission: string;
  stage_list: Stage[];
  process: string; // Format: "current_index/total_count"
  current_task: {
    title: string;
    description: string[];
    reference_files: Record<string, string>;
    output_files: string[];
  };
  current_stage_index: number;
  current_stage_name: string;
  last_check_result: Record<string, any>;
}

const AgentStatusPage = () => {
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Function to extract text content from the result if it follows the expected structure
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

  // Function to fetch agent status
  const fetchStatus = async () => {
    try {
      setLoading(true);

      // First, get the list of available tools to verify that the Status tool exists
      const toolsResponse = await fetch('http://127.0.0.1:8000/tools', {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }
      });

      if (!toolsResponse.ok) {
        throw new Error(`Failed to fetch tools list: HTTP ${toolsResponse.status}`);
      }

      const toolsData = await toolsResponse.json();
      console.log('Available tools:', toolsData.tools);

      // Check if the Status tool is available
      const statusTool = toolsData.tools?.find((tool: any) =>
        tool.name.toLowerCase() === 'status' ||
        tool.name.toLowerCase() === 'agentstatus' ||
        tool.name.toLowerCase().includes('status')
      );

      if (!statusTool) {
        throw new Error('Status tool not found in available tools');
      }

      // Now call the Status tool
      const response = await fetch('http://127.0.0.1:8000/tools/call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tool_name: statusTool.name, // Use the actual tool name from the tools list
          arguments: {}
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${await response.text()}`);
      }

      const data = await response.json();

      // Parse the status response
      const statusText = extractTextContent(data.result);

      const parsedStatus = parseStatusResponse(statusText);
      setStatus(parsedStatus);
      setError(null);
    } catch (err) {
      console.error('Error fetching agent status:', err);
      setError(`Failed to fetch agent status: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoading(false);
    }
  };

  // Function to parse the status response text into structured data
  const parseStatusResponse = (statusText: string): AgentStatus => {
    // The status response is in YAML-like format, so we need to parse it properly
    // Example format:
    // mission: Adder chip verification task
    // stage_list:
    // - index: 0
    //   title: 1-requirement_analysis_and_planning-需求分析与验证规划
    //   reached: true
    //   fail_count: 0
    //   is_skipped: false
    //   time_cost: 25m 22s
    //   needs_human_check: false
    // ...
    // process: 0/26
    // current_task:
    //   title: 1-requirement_analysis_and_planning-需求分析与验证规划
    //   description:
    //   - "Step 1: Read Adder/README.md to understand verification requirements"
    //   ...
    // current_stage_index: 0
    // current_stage_name: requirement_analysis_and_planning

    const lines = statusText.split('\n');
    const result: Partial<AgentStatus> = {
      stage_list: [],
      current_task: {
        title: '',
        description: [],
        reference_files: {},
        output_files: []
      }
    };

    let currentSection: string | null = null;
    let currentSubsection: string | null = null;
    let currentStage: Partial<Stage> | null = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmedLine = line.trim();

      // Skip empty lines
      if (!trimmedLine) continue;

      // Detect top-level properties
      if (trimmedLine.startsWith('mission:')) {
        result.mission = trimmedLine.substring('mission:'.length).trim();
        currentSection = null;
      } else if (trimmedLine.startsWith('process:')) {
        result.process = trimmedLine.substring('process:'.length).trim();
        currentSection = null;
      } else if (trimmedLine.startsWith('current_stage_index:')) {
        result.current_stage_index = parseInt(trimmedLine.substring('current_stage_index:'.length).trim(), 10);
        currentSection = null;
      } else if (trimmedLine.startsWith('current_stage_name:')) {
        result.current_stage_name = trimmedLine.substring('current_stage_name:'.length).trim();
        currentSection = null;
      } else if (trimmedLine.startsWith('last_check_result:')) {
        result.last_check_result = {};
        currentSection = 'last_check_result';
      } else if (trimmedLine === 'stage_list:') {
        currentSection = 'stage_list';
      } else if (trimmedLine === 'current_task:') {
        currentSection = 'current_task';
      } else if (currentSection === 'stage_list') {
        // Handle stage list items
        if (line.match(/^\s*-\s+index:/)) {
          // This is a new stage definition
          if (currentStage) {
            // Add the previous stage to the list if it exists
            if (result.stage_list) {
              result.stage_list.push(currentStage as Stage);
            }
          }

          // Create a new stage object
          currentStage = { index: -1 };

          // Extract index
          const indexMatch = line.match(/index:\s*(\d+)/);
          if (indexMatch) {
            currentStage.index = parseInt(indexMatch[1], 10);
          }
        } else if (currentStage) {
          // Handle stage properties (indented)
          const propertyMatch = line.match(/^\s+(\w+):\s*(.*)/);
          if (propertyMatch) {
            const property = propertyMatch[1];
            const value = propertyMatch[2].trim();

            switch (property) {
              case 'title':
                currentStage.title = value;
                break;
              case 'reached':
                currentStage.reached = value === 'true';
                break;
              case 'fail_count':
                currentStage.fail_count = parseInt(value, 10);
                break;
              case 'is_skipped':
                currentStage.is_skipped = value === 'true';
                break;
              case 'time_cost':
                currentStage.time_cost = value;
                break;
              case 'needs_human_check':
                currentStage.needs_human_check = value === 'true';
                break;
            }
          } else if (trimmedLine.match(/^\w+:/)) {
            // If we encounter a new top-level property while in stage_list, exit this section
            currentSection = null;
            currentSubsection = null;
          }
        }
      } else if (currentSection === 'current_task') {
        if (trimmedLine.startsWith('title:')) {
          if (result.current_task) {
            result.current_task.title = trimmedLine.substring('title:'.length).trim();
          }
        } else if (trimmedLine === 'description:') {
          currentSubsection = 'description';
        } else if (currentSubsection === 'description' && line.match(/^\s*-\s+/)) {
          // Description item (starts with '- ' and is indented)
          const descItem = line.replace(/^\s*-\s+/, '').trim();
          if (result.current_task && descItem) {
            result.current_task.description?.push(descItem);
          }
        } else if (trimmedLine === 'reference_files:') {
          currentSubsection = 'reference_files';
        } else if (currentSubsection === 'reference_files' && line.match(/^\s*-\s+/)) {
          // Reference file item (starts with '- ' and is indented)
          const fileEntry = line.replace(/^\s*-\s+/, '').trim();
          // Try to parse as "filename: status" format
          const colonIndex = fileEntry.indexOf(': ');
          if (colonIndex !== -1) {
            const file = fileEntry.substring(0, colonIndex);
            const status = fileEntry.substring(colonIndex + 2);
            if (result.current_task) {
              result.current_task.reference_files![file] = status;
            }
          } else {
            // Simple filename format
            if (result.current_task) {
              result.current_task.reference_files![fileEntry] = 'Not Read';
            }
          }
        } else if (trimmedLine === 'output_files:') {
          currentSubsection = 'output_files';
        } else if (currentSubsection === 'output_files' && line.match(/^\s*-\s+/)) {
          // Output file item (starts with '- ' and is indented)
          const file = line.replace(/^\s*-\s+/, '').trim();
          if (result.current_task && file) {
            result.current_task.output_files?.push(file);
          }
        } else if (trimmedLine.match(/^\w+:/)) {
          // If we encounter a new top-level property, exit current section
          currentSection = null;
          currentSubsection = null;
        }
      }
    }

    // Don't forget to add the last stage if it exists
    if (currentStage && result.stage_list) {
      result.stage_list.push(currentStage as Stage);
    }

    return result as AgentStatus;
  };

  // Fetch status on component mount
  useEffect(() => {
    fetchStatus();

    // Refresh every 30 seconds
    const interval = setInterval(fetchStatus, 30000);
    return () => clearInterval(interval);
  }, []);

  // Calculate progress percentage
  const calculateProgress = () => {
    if (!status || !status.stage_list || status.stage_list.length === 0) return 0;

    const totalStages = status.stage_list.length;
    const completedStages = status.stage_list.filter(stage => stage.reached).length;

    return Math.round((completedStages / totalStages) * 100);
  };

  // Get current stage if available
  const getCurrentStage = () => {
    if (!status || !status.stage_list || status.current_stage_index === undefined) return null;
    return status.stage_list[status.current_stage_index];
  };

  if (loading) {
    return (
      <div className="flex flex-col h-full w-full bg-gradient-to-br from-slate-50 to-blue-50 p-6">
        <div className="max-w-6xl mx-auto w-full">
          <div className="animate-pulse">
            <div className="h-8 bg-gray-200 rounded w-1/3 mb-6"></div>
            <div className="h-4 bg-gray-200 rounded w-1/2 mb-4"></div>
            <div className="h-64 bg-gray-200 rounded"></div>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col h-full w-full bg-gradient-to-br from-slate-50 to-blue-50 p-6">
        <div className="max-w-6xl mx-auto w-full">
          <div className="bg-white rounded-2xl shadow-lg border border-slate-200 p-6">
            <h1 className="text-3xl font-bold text-slate-800 mb-6">Agent Status</h1>
            <div className="text-red-600 bg-red-50 p-4 rounded-lg">
              <p className="font-medium">Error loading status:</p>
              <p>{error}</p>
              <button
                onClick={fetchStatus}
                className="mt-4 px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 transition-colors"
              >
                Retry
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!status) {
    return (
      <div className="flex flex-col h-full w-full bg-gradient-to-br from-slate-50 to-blue-50 p-6">
        <div className="max-w-6xl mx-auto w-full">
          <div className="bg-white rounded-2xl shadow-lg border border-slate-200 p-6">
            <h1 className="text-3xl font-bold text-slate-800 mb-6">Agent Status</h1>
            <div className="text-center py-12">
              <p className="text-slate-500">No status information available</p>
              <button
                onClick={fetchStatus}
                className="mt-4 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
              >
                Refresh Status
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const progressPercentage = calculateProgress();
  const currentStage = getCurrentStage();

  return (
    <div className="flex flex-col h-full w-full bg-gradient-to-br from-slate-50 to-blue-50 p-6">
      <div className="max-w-6xl mx-auto w-full">
        <div className="flex justify-between items-start mb-6">
          <div>
            <h1 className="text-3xl font-bold text-slate-800">Agent Status</h1>
            <p className="text-slate-600 mt-2">{status.mission}</p>
          </div>
          <button
            onClick={fetchStatus}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            Refresh
          </button>
        </div>

        {/* Progress Summary Card */}
        <div className="bg-white rounded-2xl shadow-lg border border-slate-200 p-6 mb-6">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h2 className="text-xl font-bold text-slate-800">Verification Progress</h2>
              <p className="text-slate-600 mt-1">
                {status.stage_list?.length ? `${status.stage_list.filter(s => s.reached).length} of ${status.stage_list.length} stages completed` : 'No stages available'}
              </p>
            </div>
            <div className="flex items-center gap-4">
              <div className="w-48 bg-slate-200 rounded-full h-4">
                <div
                  className="bg-gradient-to-r from-blue-500 to-indigo-500 h-4 rounded-full transition-all duration-500 ease-out"
                  style={{ width: `${progressPercentage}%` }}
                ></div>
              </div>
              <span className="text-lg font-semibold text-slate-800 min-w-[60px]">{progressPercentage}%</span>
            </div>
          </div>
        </div>

        {/* Current Task Card */}
        {currentStage && (
          <div className="bg-white rounded-2xl shadow-lg border border-slate-200 p-6 mb-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-3 h-3 rounded-full bg-green-500"></div>
              <h2 className="text-xl font-bold text-slate-800">Current Stage</h2>
            </div>
            <div className="bg-blue-50 p-4 rounded-lg">
              <h3 className="font-semibold text-blue-800">{currentStage.title}</h3>
              <p className="text-blue-700 mt-2">Time spent: {currentStage.time_cost || 'Not started'}</p>
              <p className="text-blue-700">Status: {currentStage.is_skipped ? 'SKIPPED' : currentStage.reached ? 'COMPLETED' : 'IN PROGRESS'}</p>
            </div>
          </div>
        )}

        {/* Current Task Details Card */}
        {status.current_task && (
          <div className="bg-white rounded-2xl shadow-lg border border-slate-200 p-6 mb-6">
            <h2 className="text-xl font-bold text-slate-800 mb-4">Current Task</h2>
            <div className="bg-slate-50 p-4 rounded-lg">
              <h3 className="font-semibold text-slate-800">{status.current_task.title}</h3>
              <div className="mt-3">
                <h4 className="font-medium text-slate-700 mb-2">Steps:</h4>
                <ul className="list-disc pl-5 space-y-1">
                  {status.current_task.description.map((step, index) => (
                    <li key={index} className="text-slate-600">{step}</li>
                  ))}
                </ul>
              </div>

              {Object.keys(status.current_task.reference_files || {}).length > 0 && (
                <div className="mt-4">
                  <h4 className="font-medium text-slate-700 mb-2">Reference Files:</h4>
                  <ul className="list-disc pl-5 space-y-1">
                    {Object.entries(status.current_task.reference_files || {}).map(([file, status], index) => (
                      <li key={index} className="text-slate-600">
                        <span className="font-mono">{file}</span> - <span className={status === 'Not Read' ? 'text-orange-600' : 'text-green-600'}>{status}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {status.current_task.output_files && status.current_task.output_files.length > 0 && (
                <div className="mt-4">
                  <h4 className="font-medium text-slate-700 mb-2">Output Files:</h4>
                  <ul className="list-disc pl-5 space-y-1">
                    {status.current_task.output_files.map((file, index) => (
                      <li key={index} className="text-slate-600 font-mono">{file}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Stages List */}
        <div className="bg-white rounded-2xl shadow-lg border border-slate-200 p-6">
          <h2 className="text-xl font-bold text-slate-800 mb-4">Verification Stages</h2>
          <div className="space-y-3">
            {status.stage_list?.map((stage) => (
              <div
                key={stage.index}
                className={`p-4 rounded-lg border-l-4 ${
                  stage.is_skipped
                    ? 'bg-yellow-50 border-l-yellow-500'
                    : stage.reached
                      ? 'bg-green-50 border-l-green-500'
                      : stage.needs_human_check
                        ? 'bg-orange-50 border-l-orange-500'
                        : 'bg-slate-50 border-l-slate-300'
                }`}
              >
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="font-semibold text-slate-800">{stage.title}</h3>
                    <div className="flex flex-wrap gap-2 mt-2">
                      {stage.reached && (
                        <span className="px-2 py-1 bg-green-100 text-green-800 text-xs font-medium rounded-full">Completed</span>
                      )}
                      {stage.is_skipped && (
                        <span className="px-2 py-1 bg-yellow-100 text-yellow-800 text-xs font-medium rounded-full">Skipped</span>
                      )}
                      {!stage.reached && !stage.is_skipped && (
                        <span className="px-2 py-1 bg-slate-100 text-slate-800 text-xs font-medium rounded-full">Pending</span>
                      )}
                      {stage.needs_human_check && (
                        <span className="px-2 py-1 bg-orange-100 text-orange-800 text-xs font-medium rounded-full">Human Check Required</span>
                      )}
                      {stage.fail_count > 0 && (
                        <span className="px-2 py-1 bg-red-100 text-red-800 text-xs font-medium rounded-full">
                          {stage.fail_count} failure{stage.fail_count !== 1 ? 's' : ''}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="text-sm text-slate-500">
                    {stage.time_cost && stage.time_cost !== "''" ? `Time: ${stage.time_cost}` : 'Not started'}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default AgentStatusPage;