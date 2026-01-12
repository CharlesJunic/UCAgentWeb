import { useState } from 'react';
import './App.css';
import AgentConsole from './AgentMCPConsole';
import MCPClientTerminal from './MCPClientTerminal';
import AgentTerminal from './AgentTerminal';

function App() {
  const [currentPage, setCurrentPage] = useState<'console' | 'terminal' | 'agentTerminal'>('console');

  return (
    <div className="App min-h-screen w-screen bg-gradient-to-br from-slate-50 to-blue-50 flex flex-col">
      <div className="flex flex-1 w-full h-full">
        {/* Navigation sidebar - hidden on mobile by default, can be toggled */}
        <div className="md:w-64 bg-white shadow-lg border-b md:border-b-0 md:border-r border-slate-200 md:flex md:flex-col flex-shrink-0">
          <div className="p-4 md:p-6">
            <h1 className="text-xl font-bold text-slate-800">UCAgent</h1>
            <p className="text-sm text-slate-500 mt-1">AI-powered automated UT verification agent based on large language models</p>
          </div>

          <nav className="flex-1 p-4">
            <ul className="space-y-2">
              <li>
                <button
                  onClick={() => setCurrentPage('console')}
                  className={`w-full text-left px-4 py-3 rounded-lg transition-colors ${
                    currentPage === 'console'
                      ? 'bg-indigo-100 text-indigo-700 font-medium'
                      : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  <div className="flex items-center">
                    <span>Agent MCP Console</span>
                  </div>
                </button>
              </li>
              <li>
                <button
                  onClick={() => setCurrentPage('terminal')}
                  className={`w-full text-left px-4 py-3 rounded-lg transition-colors ${
                    currentPage === 'terminal'
                      ? 'bg-indigo-100 text-indigo-700 font-medium'
                      : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  <div className="flex items-center">
                    <span>MCP Client Terminal</span>
                  </div>
                </button>
              </li>
              <li>
                <button
                  onClick={() => setCurrentPage('agentTerminal')}
                  className={`w-full text-left px-4 py-3 rounded-lg transition-colors ${
                    currentPage === 'agentTerminal'
                      ? 'bg-indigo-100 text-indigo-700 font-medium'
                      : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  <div className="flex items-center">
                    <span>Agent Terminal</span>
                  </div>
                </button>
              </li>
            </ul>
          </nav>

          <div className="p-4 border-t border-slate-200 text-xs text-slate-500 hidden md:block flex flex-col items-center">
            <img
              src="/logo.png"
              alt="Logo"
              className="w-32 h-8 mb-2"
            />
            <div className="block">万众一芯开放验证</div>
            <div className="block">(UnityChip Verification)</div>
          </div>
        </div>

        {/* Main content area */}
        <div className="flex-1 overflow-auto w-full">
          {currentPage === 'console'
            ? <AgentConsole />
            : currentPage === 'terminal'
              ? <MCPClientTerminal />
              : <AgentTerminal />}
        </div>
      </div>
    </div>
  );
}

export default App;