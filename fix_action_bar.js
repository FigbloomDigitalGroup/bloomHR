const fs = require('fs');

let content = fs.readFileSync('src/components/Settings/SalaryAdmin.tsx', 'utf8');

const newActionBar = `        {/* ── Action Bar (Enterprise Toolbar Style) ────────────────────────────────── */}
        <div className="bg-white rounded-[10px] border border-[#d4e4ff] shadow-sm mb-6 overflow-hidden">
          {/* Main Toolbar */}
          <div className="bg-[#f2f7ff] border-b border-[#d4e4ff] px-2 py-2 flex flex-wrap justify-between items-center gap-3">
            
            {/* Left: Tab Group */}
            <div className="flex bg-white rounded-[6px] border border-[#d4e4ff] p-0.5 shadow-sm overflow-x-auto hide-scrollbar">
                <button
                  onClick={() => setActiveTab('applications')}
                  className={\`inline-flex items-center gap-2 px-3 py-1.5 rounded-[4px] text-xs font-semibold whitespace-nowrap transition-all \${activeTab === 'applications'
                      ? 'bg-[#d4e4ff] text-blue-900 shadow-sm'
                      : 'text-gray-600 hover:bg-gray-50'
                    }\`}
                >
                  <Activity className="w-3.5 h-3.5" /> Applications
                </button>
                <RoleButtonWrapper allowedRoles={['ADMIN', 'CHECKER']}>
                  <div className="w-[1px] bg-[#d4e4ff] mx-0.5 my-1"></div>
                  <button
                    onClick={() => setActiveTab('callbacks')}
                    className={\`inline-flex items-center gap-2 px-3 py-1.5 rounded-[4px] text-xs font-semibold whitespace-nowrap transition-all \${activeTab === 'callbacks'
                        ? 'bg-[#d4e4ff] text-blue-900 shadow-sm'
                        : 'text-gray-600 hover:bg-gray-50'
                      }\`}
                  >
                    <Smartphone className="w-3.5 h-3.5" /> M-Pesa Logs
                  </button>
                  <div className="w-[1px] bg-[#d4e4ff] mx-0.5 my-1"></div>
                  <button
                    onClick={() => setActiveTab('transaction_status')}
                    className={\`inline-flex items-center gap-2 px-3 py-1.5 rounded-[4px] text-xs font-semibold whitespace-nowrap transition-all \${activeTab === 'transaction_status'
                        ? 'bg-[#d4e4ff] text-blue-900 shadow-sm'
                        : 'text-gray-600 hover:bg-gray-50'
                      }\`}
                  >
                    <RefreshCw className="w-3.5 h-3.5" /> Check API
                  </button>
                </RoleButtonWrapper>
                <RoleButtonWrapper allowedRoles={['ADMIN']}>
                  <div className="w-[1px] bg-[#d4e4ff] mx-0.5 my-1"></div>
                  <button
                    onClick={() => setActiveTab('settings')}
                    className={\`inline-flex items-center gap-2 px-3 py-1.5 rounded-[4px] text-xs font-semibold whitespace-nowrap transition-all \${activeTab === 'settings'
                        ? 'bg-[#d4e4ff] text-blue-900 shadow-sm'
                        : 'text-gray-600 hover:bg-gray-50'
                      }\`}
                  >
                    <Settings className="w-3.5 h-3.5" /> Settings
                  </button>
                </RoleButtonWrapper>
            </div>

            {/* Right: Action Buttons Group */}
            <div className="flex items-center flex-wrap gap-2 pr-1">
                <div className="text-xs text-gray-500 font-medium px-2 py-1 bg-white border border-[#d4e4ff] rounded-[6px] shadow-sm whitespace-nowrap">
                  Total: <strong className="text-blue-900">{filteredApplications.length}</strong>
                </div>

                <div className="w-[1px] h-5 bg-[#d4e4ff] mx-1 hidden sm:block"></div>

                {(isChecker || isAdmin) && pendingCount > 0 && (
                  <button
                    onClick={() => setShowApprovalQueue(true)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#d4e4ff] text-blue-900 border border-[#b8d1ff] hover:bg-[#b8d1ff] rounded-[6px] text-xs font-semibold shadow-sm transition-colors whitespace-nowrap"
                  >
                    <AlertTriangle className="w-3.5 h-3.5 text-orange-600" /> {pendingCount} Approvals
                  </button>
                )}

                {fullyApprovedApplications.length > 0 && (
                  <button
                    onClick={() => setShowBulkPaymentModal(true)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#d4e4ff] text-blue-900 border border-[#b8d1ff] hover:bg-[#b8d1ff] rounded-[6px] text-xs font-semibold shadow-sm transition-colors whitespace-nowrap"
                  >
                    <Zap className="w-3.5 h-3.5 text-emerald-600" /> 
                    {isMaker ? 'Create Payment Request' : \`Process Payments (\${getSelectedStaffCount()})\`}
                  </button>
                )}

                <div className="flex bg-white rounded-[6px] border border-[#d4e4ff] p-0.5 shadow-sm">
                  <button
                    onClick={() => setShowExportModal(true)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#d4e4ff] text-blue-900 hover:bg-[#b8d1ff] rounded-[4px] text-xs font-semibold transition-colors"
                  >
                    <Download className="w-3.5 h-3.5" /> Export
                  </button>
                  <button
                    onClick={() => setShowImportModal(true)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-transparent hover:bg-gray-50 text-gray-700 rounded-[4px] text-xs font-semibold transition-colors"
                  >
                    <Upload className="w-3.5 h-3.5" /> Import
                  </button>
                </div>

                {/* Admin Bypass Toggle */}
                {isAdmin && (
                  <>
                    <div className="w-[1px] h-5 bg-[#d4e4ff] mx-1 hidden sm:block"></div>
                    <div className={\`flex items-center gap-2 px-2.5 py-1.5 rounded-[6px] border text-xs font-semibold shadow-sm transition-colors whitespace-nowrap \${adminBypassMode
                        ? 'bg-red-50 border-red-200 text-red-700'
                        : 'bg-white border-[#d4e4ff] text-gray-600'
                      }\`}>
                      Bypass
                      <button
                        onClick={() => setAdminBypassMode(!adminBypassMode)}
                        className={\`text-xs relative w-7 h-3.5 rounded-full transition-colors duration-300 focus:outline-none \${adminBypassMode ? 'bg-red-500' : 'bg-gray-300'
                          }\`}
                      >
                        <span className={\`absolute top-[2px] left-[2px] w-2.5 h-2.5 bg-white rounded-full shadow transition-transform duration-300 \${adminBypassMode ? 'translate-x-[14px]' : 'translate-x-0'
                          }\`} />
                      </button>
                    </div>
                  </>
                )}
            </div>
          </div>

          {/* Row 2: Search + filter — only for applications tab */}
          {activeTab === 'applications' && (
            <div className="p-4 bg-white border-b border-[#d4e4ff] last:border-b-0">`;

// Using regex to replace the old Action Bar with the new one
const oldBarRegex = /\{\/\* ── Action Bar ────────────────────────────────── \*\/\}\s*\<div className="bg-\[\#f2f7ff\].*?\{\/\* Row 2: Search \+ filter — only for applications tab \*\/\}\s*\{activeTab === 'applications' && \(\s*\<div className="p-4 bg-white rounded-\[10px\] border border-\[\#d4e4ff\]"\>/s;

if (oldBarRegex.test(content)) {
  content = content.replace(oldBarRegex, newActionBar);
} else {
  console.log("Could not find the target block to replace.");
}

// Reset filter button is now in a white section, let's make it the active color too
content = content.replace(
  /className="w-full px-3 py-2 text-xs font-medium text-gray-600 hover:text-gray-800 border border-\[\#d4e4ff\] rounded bg-white hover:bg-\[\#f2f7ff\] transition-colors"/g,
  'className="w-full px-3 py-2 text-xs font-semibold text-blue-900 border border-[#b8d1ff] rounded-[6px] bg-[#d4e4ff] hover:bg-[#b8d1ff] shadow-sm transition-colors"'
);

fs.writeFileSync('src/components/Settings/SalaryAdmin.tsx', content);
console.log('Action bar replaced with enterprise toolbar.');
