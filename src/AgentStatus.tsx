import { useState, useEffect, useRef } from 'react';

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
  } | string; // Can be a string when mission is completed
  current_stage_index: number;
  current_stage_name: string;
  last_check_result: Record<string, any>;
}

const AgentStatusPage = () => {
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastFetchTime, setLastFetchTime] = useState<number | null>(null);

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
      setLastFetchTime(Date.now()); // Record the time when we fetched the status
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
        const value = trimmedLine.substring('current_stage_index:'.length).trim();
        // Handle the case where current_stage_index might be null or not a number
        if (value && !isNaN(parseInt(value, 10))) {
          result.current_stage_index = parseInt(value, 10);
        } else {
          result.current_stage_index = -1; // Indicate no current stage
        }
        currentSection = null;
      } else if (trimmedLine.startsWith('current_stage_name:')) {
        result.current_stage_name = trimmedLine.substring('current_stage_name:'.length).trim();
        currentSection = null;
      } else if (trimmedLine.startsWith('last_check_result:')) {
        // Parse the last_check_result section which may have complex nested structure
        result.last_check_result = parseLastCheckResult(lines.slice(i));
        // Skip the lines we just processed
        // Find the next top-level property to determine how many lines to skip
        for (let j = i + 1; j < lines.length; j++) {
          if (lines[j].trim() && !lines[j].match(/^\s+/)) { // Found next top-level property
            i = j - 1; // Adjust loop counter to account for increment
            break;
          }
          if (j === lines.length - 1) {
            i = j; // Reached end of lines
          }
        }
        currentSection = null;
      } else if (trimmedLine === 'stage_list:') {
        currentSection = 'stage_list';
      } else if (trimmedLine.startsWith('current_task:')) {
        // Handle the case where current_task is a string (when mission is completed)
        const currentTaskValue = trimmedLine.substring('current_task:'.length).trim();
        if (currentTaskValue && currentTaskValue !== '') {
          // If current_task has a value after the colon, it's a string message
          if (result.current_task) {
            result.current_task = {
              title: currentTaskValue,
              description: ["Mission completed or no active task"],
              reference_files: {},
              output_files: []
            };
          }
        } else {
          // Otherwise, it's the start of an object structure
          currentSection = 'current_task';
        }
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
          if (result.current_task && typeof result.current_task === 'object') {
            result.current_task.title = trimmedLine.substring('title:'.length).trim();
          }
        } else if (trimmedLine === 'description:') {
          currentSubsection = 'description';
        } else if (currentSubsection === 'description' && line.match(/^\s*-\s+/)) {
          // Description item (starts with '- ' and is indented)
          const descItem = line.replace(/^\s*-\s+/, '').trim();
          if (result.current_task && typeof result.current_task === 'object' && descItem) {
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
            if (result.current_task && typeof result.current_task === 'object') {
              result.current_task.reference_files![file] = status;
            }
          } else {
            // Simple filename format
            if (result.current_task && typeof result.current_task === 'object') {
              result.current_task.reference_files![fileEntry] = 'Not Read';
            }
          }
        } else if (trimmedLine === 'output_files:') {
          currentSubsection = 'output_files';
        } else if (currentSubsection === 'output_files' && line.match(/^\s*-\s+/)) {
          // Output file item (starts with '- ' and is indented)
          const file = line.replace(/^\s*-\s+/, '').trim();
          if (result.current_task && typeof result.current_task === 'object' && file) {
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

  // Helper function to parse the complex last_check_result section
  const parseLastCheckResult = (lines: string[]): any => {
    // This is a simplified parser for the last_check_result section
    // which can have complex nested structures
    let result = {};
    let insideCheckInfo = false;
    let checkInfoArray: any[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmedLine = line.trim();

      if (!trimmedLine) continue;

      // Stop parsing if we reach a new top-level property
      if (line && !line.match(/^\s+/) && !trimmedLine.startsWith('- ') && trimmedLine.includes(':')) {
        break;
      }

      if (trimmedLine === 'check_info:') {
        insideCheckInfo = true;
        continue;
      }

      if (insideCheckInfo) {
        if (line.match(/^\s*-\s+name:/)) {
          // Start of a new check info object
          const nameMatch = line.match(/name:\s*(.+)/);
          if (nameMatch) {
            checkInfoArray.push({ name: nameMatch[1].trim() });
          }
        } else if (checkInfoArray.length > 0) {
          // Add properties to the last check info object
          const currentObj = checkInfoArray[checkInfoArray.length - 1];
          const propertyMatch = line.match(/^\s+(\w+):\s*(.*)/);
          if (propertyMatch) {
            const property = propertyMatch[1];
            const value = propertyMatch[2].trim();

            if (property === 'last_msg' || property === 'description') {
              // Handle array values
              currentObj[property] = [];
            } else if (property === 'count_pass' || property === 'count_fail' || property === 'count_check') {
              currentObj[property] = parseInt(value, 10);
            } else {
              currentObj[property] = value;
            }
          } else if (line.match(/^\s*-\s+/) && line.includes('last_msg:') || line.includes('description:')) {
            // Handle array items for last_msg or description
            const arrayMatch = line.match(/^\s*-\s+(.+)/);
            if (arrayMatch) {
              const currentObj = checkInfoArray[checkInfoArray.length - 1];
              if (!currentObj.last_msg) currentObj.last_msg = [];
              currentObj.last_msg.push(arrayMatch[1].trim());
            }
          }
        }
      } else if (trimmedLine.startsWith('check_pass:')) {
        result = { ...result, check_pass: trimmedLine.substring('check_pass:'.length).trim() === 'true' };
      }
    }

    if (checkInfoArray.length > 0) {
      result = { ...result, check_info: checkInfoArray };
    }

    return result;
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
    const completedStages = status.stage_list.filter(stage => isStageCompleted(stage.index)).length;

    return Math.round((completedStages / totalStages) * 100);
  };

  // Determine if a stage is completed for progress calculation purposes
  // This includes both reached stages and skipped stages
  const isStageCompleted = (stageIndex: number) => {
    if (!status || !status.stage_list) return false;

    // Check if the process indicates all stages are completed
    const processMatch = status.process?.match(/(\d+)\/(\d+)/);
    if (processMatch) {
      const completedCount = parseInt(processMatch[1], 10);
      const totalCount = parseInt(processMatch[2], 10);

      // If all stages are completed according to the process string
      if (completedCount >= totalCount && completedCount > 0) {
        // Then any stage that has reached=true or is_skipped=true is considered completed for progress
        const stage = status.stage_list[stageIndex];
        return stage?.reached === true || stage?.is_skipped === true;
      }
    }

    // If we have a valid current_stage_index, use the original logic
    // A stage is completed if it's reached and there's at least one later stage that is also reached
    if (status.current_stage_index !== undefined && status.current_stage_index !== -1) {
      return stageIndex < status.current_stage_index;
    }

    // Default case: if no current stage index is defined, check if the stage is reached or skipped
    const stage = status.stage_list[stageIndex];
    return stage?.reached === true || stage?.is_skipped === true;
  };

  // Get current stage if available
  const getCurrentStage = () => {
    if (!status || !status.stage_list || status.current_stage_index === undefined) return null;
    return status.stage_list[status.current_stage_index];
  };

  // Function to convert time string like "51m 02s" to total seconds
  const convertTimeToSeconds = (timeStr: string): number => {
    if (!timeStr || timeStr === "''" || timeStr === 'Not started') return 0;

    // Match patterns like "51m 02s", "1h 20m", "30s", etc.
    const hoursMatch = timeStr.match(/(\d+)h/);
    const minutesMatch = timeStr.match(/(\d+)m/);
    const secondsMatch = timeStr.match(/(\d+)s/);

    const hours = hoursMatch ? parseInt(hoursMatch[1]) : 0;
    const minutes = minutesMatch ? parseInt(minutesMatch[1]) : 0;
    const seconds = secondsMatch ? parseInt(secondsMatch[1]) : 0;

    return hours * 3600 + minutes * 60 + seconds;
  };

  // Function to convert seconds back to human-readable format like "Xh Ym Zs"
  const convertSecondsToTime = (totalSeconds: number): string => {
    if (totalSeconds <= 0) return '0s';

    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    let result = '';
    if (hours > 0) result += `${hours}h `;
    if (minutes > 0) result += `${minutes}m `;
    if (seconds > 0 || (hours === 0 && minutes === 0)) result += `${seconds}s`;

    return result.trim();
  };

  // Ref to trigger re-renders for real-time updates, instead of using state that's never read
  const tickRef = useRef(0);

  // Calculate real-time elapsed time for the current stage
  const getCurrentStageElapsedTime = () => {
    if (!status || !getCurrentStage()) return '0s';

    const currentStage = getCurrentStage();
    if (!currentStage) return '0s';

    // If the stage is completed or skipped, return the stored time
    if (isStageCompleted(currentStage.index) || currentStage.is_skipped) {
      return currentStage.time_cost || '0s';
    }

    // If we don't have the last fetch time, return the stored time
    if (!lastFetchTime) {
      return currentStage.time_cost || '0s';
    }

    // Calculate the time elapsed since the last fetch
    const timeSinceLastFetch = (Date.now() - lastFetchTime) / 1000; // in seconds

    // Convert the stored time to seconds and add the elapsed time
    const baseTimeInSeconds = convertTimeToSeconds(currentStage.time_cost);
    const totalTimeInSeconds = baseTimeInSeconds + timeSinceLastFetch;

    // Convert back to human-readable format
    return convertSecondsToTime(Math.floor(totalTimeInSeconds));
  };

  // Set up a timer to trigger re-renders every second when there's a current stage in progress
  useEffect(() => {
    let interval: number | null = null;

    // Check if current stage is in progress
    const currentStage = status ? status.stage_list?.[status.current_stage_index] : null;
    const inProgress = currentStage && !isStageCompleted(currentStage.index);

    if (inProgress) {
      interval = window.setInterval(() => {
        tickRef.current += 1;
        // Trigger a re-render by updating status with the same value
        setStatus(prev => prev ? {...prev} : null);
      }, 1000);
    }

    return () => {
      if (interval !== null) {
        clearInterval(interval);
      }
    };
  }, [status, isStageCompleted]); // Only depend on status and isStageCompleted

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
  const currentStage = status.stage_list?.[status.current_stage_index];

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
                {status.stage_list?.length ? `${status.stage_list.filter(s => isStageCompleted(s.index)).length} of ${status.stage_list.length} stages completed` : 'No stages available'}
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
              <p className="text-blue-700 mt-2">Time spent: {getCurrentStageElapsedTime()}</p>
              <p className="text-blue-700">Status: {currentStage.is_skipped ? 'SKIPPED' : isStageCompleted(currentStage.index) ? 'COMPLETED' : 'IN PROGRESS'}</p>
            </div>
          </div>
        )}

        {/* Current Task Details Card */}
        {status.current_task && (
          <div className="bg-white rounded-2xl shadow-lg border border-slate-200 p-6 mb-6">
            <h2 className="text-xl font-bold text-slate-800 mb-4">Current Task</h2>
            <div className="bg-slate-50 p-4 rounded-lg">
              {typeof status.current_task === 'string' ? (
                <div>
                  <h3 className="font-semibold text-slate-800">{status.current_task}</h3>
                  <p className="text-slate-600 mt-2">No active task details available.</p>
                </div>
              ) : (
                <>
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
                        {Object.entries(status.current_task.reference_files || {}).map(([file, fileStatus], index) => (
                          <li key={index} className="text-slate-600">
                            <span className="font-mono">{file}</span> - <span className={fileStatus === 'Not Read' ? 'text-orange-600' : 'text-green-600'}>{fileStatus}</span>
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
                </>
              )}
            </div>
          </div>
        )}

        {/* Stages List */}
        <div className="bg-white rounded-2xl shadow-lg border border-slate-200 p-6">
          <h2 className="text-xl font-bold text-slate-800 mb-4">Verification Stages</h2>
          <div className="space-y-3">
            {status.stage_list?.map((stage) => {
              const isCompleted = isStageCompleted(stage.index);
              const isInProgress = stage.reached && !isCompleted;

              return (
              <div
                key={stage.index}
                className={`p-4 rounded-lg border-l-4 ${
                  stage.is_skipped
                    ? 'bg-yellow-50 border-l-yellow-500'
                    : isCompleted
                      ? 'bg-green-50 border-l-green-500'
                      : isInProgress
                        ? 'bg-blue-50 border-l-blue-500'
                        : stage.needs_human_check
                          ? 'bg-orange-50 border-l-orange-500'
                          : 'bg-slate-50 border-l-slate-300'
                }`}
              >
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="font-semibold text-slate-800">{stage.title}</h3>
                    <div className="flex flex-wrap gap-2 mt-2">
                      {isCompleted && !stage.is_skipped && (
                        <span className="px-2 py-1 bg-green-100 text-green-800 text-xs font-medium rounded-full">Completed</span>
                      )}
                      {isInProgress && (
                        <span className="px-2 py-1 bg-blue-100 text-blue-800 text-xs font-medium rounded-full">In Progress</span>
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
              )
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

export default AgentStatusPage;