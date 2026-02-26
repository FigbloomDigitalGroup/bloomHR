const fs = require('fs');

let content = fs.readFileSync('src/components/Settings/SalaryAdmin.tsx', 'utf8');

const newActionBar = `        {/* ── Action Bar (Premium Beautiful Style) ────────────────────────────────── */}
        <div className="bg-white rounded-[24px] border border-gray-100 shadow-[0_8px_30px_rgb(0,0,0,0.04)] mb-6 p-5">
          <div className="flex flex-col xl:flex-row justify-between items-center gap-5">
            
            {/* Left: Tab Group */}
            <div className="flex bg-gray-50/80 p-1.5 rounded-[16px] w-full xl:w-auto overflow-x-auto hide-scrollbar border border-gray-100/50">
              <button
                onClick={() => setActiveTab('applications')}
                className={\`inline-flex items-center justify-center gap-2.5 px-5 py-3 rounded-[12px] text-xs font-bold whitespace-nowrap transition-all duration-300 \${activeTab === 'applications'
                  ? 'bg-white text-blue-600 shadow-sm border border-gray-200/60'
                  : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100/50'
                  }\`}
              >
                <Activity className="w-4 h-4" /> Applications
              </button>
              
              <RoleButtonWrapper allowedRoles={['ADMIN', 'CHECKER']}>
                <button
                  onClick={() => setActiveTab('callbacks')}
                  className={\`inline-flex items-center justify-center gap-2.5 px-5 py-3 rounded-[12px] text-xs font-bold whitespace-nowrap transition-all duration-300 \${activeTab === 'callbacks'
                    ? 'bg-white text-blue-600 shadow-sm border border-gray-200/60'
                    : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100/50'
                    }\`}
                >
                  <Smartphone className="w-4 h-4" /> M-Pesa Logs
                </button>
                <button
                  onClick={() => setActiveTab('transaction_status')}
                  className={\`inline-flex items-center justify-center gap-2.5 px-5 py-3 rounded-[12px] text-xs font-bold whitespace-nowrap transition-all duration-300 \${activeTab === 'transaction_status'
                    ? 'bg-white text-blue-600 shadow-sm border border-gray-200/60'
                    : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100/50'
                    }\`}
                >
                  <RefreshCw className="w-4 h-4" /> Check API
                </button>
              </RoleButtonWrapper>

              <RoleButtonWrapper allowedRoles={['ADMIN']}>
                <button
                  onClick={() => setActiveTab('settings')}
                  className={\`inline-flex items-center justify-center gap-2.5 px-5 py-3 rounded-[12px] text-xs font-bold whitespace-nowrap transition-all duration-300 \${activeTab === 'settings'
                    ? 'bg-white text-blue-600 shadow-sm border border-gray-200/60'
                    : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100/50'
                    }\`}
                >
                  <Settings className="w-4 h-4" /> Settings
                </button>
              </RoleButtonWrapper>
            </div>

            {/* Right: Action Buttons Group */}
            <div className="flex items-center justify-end flex-wrap xl:flex-nowrap gap-3 w-full xl:w-auto">
              
              {/* Approvals */}
              {(isChecker || isAdmin) && pendingCount > 0 && (
                <button
                  onClick={() => setShowApprovalQueue(true)}
                  className="flex-1 xl:flex-none inline-flex items-center justify-center gap-2.5 px-5 py-3.5 bg-orange-50 text-orange-600 hover:text-orange-700 hover:bg-orange-100 border border-orange-200 rounded-[14px] text-xs font-bold transition-all shadow-sm group"
                >
                  <AlertTriangle className="w-4 h-4 group-hover:scale-110 transition-transform" /> 
                  <span className="hidden sm:inline">Approvals</span>
                  <span className="bg-orange-500 text-white px-2 py-0.5 rounded-full shadow-inner">{pendingCount}</span>
                </button>
              )}

               {/* Process Payments - Restored M-Pesa Icon & Made Beautiful */}
              {fullyApprovedApplications.length > 0 && (
                <button
                  onClick={() => setShowBulkPaymentModal(true)}
                  className="flex-1 xl:flex-none inline-flex items-center justify-center gap-4 px-6 py-3 bg-[#13325b] hover:bg-[#0a2342] text-white rounded-[14px] text-xs shadow-[0_4px_16px_rgba(19,50,91,0.25)] hover:shadow-[0_8px_24px_rgba(10,35,66,0.35)] transition-all whitespace-nowrap relative overflow-hidden group border border-[#1a4478]"
                >
                  <div className="absolute inset-0 bg-white/10 opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                  
                  {/* Subtle sweep animation on hover */}
                  <div className="absolute -inset-full h-full w-1/2 z-5 block transform -skew-x-12 bg-gradient-to-r from-transparent via-white/10 to-transparent opacity-0 group-hover:opacity-100 group-hover:animate-shimmer"></div>
                  
                  <img src="M-PESA_LOGO-01.svg.png" className="w-[50px] h-auto object-contain z-10 drop-shadow-md" alt="M-Pesa" />
                  
                  <div className="flex flex-col items-start justify-center gap-0.5 z-10 pl-1 border-l border-white/20">
                     <span className="text-[9px] font-black tracking-[0.15em] text-white/70 uppercase">{isMaker ? 'Action Required' : 'Disburse Funds'}</span>
                     <span className="text-[14px] font-black tracking-tight">{isMaker ? 'CREATE REQUEST' : \`PROCESS (\${getSelectedStaffCount()})\`}</span>
                  </div>
                </button>
              )}

              {/* Tools Group */}
              <div className="flex bg-gray-50 rounded-[14px] border border-gray-200/80 p-1.5 shadow-sm">
                <button
                  onClick={() => setShowExportModal(true)}
                  className="inline-flex items-center justify-center gap-2 px-4 py-2 hover:bg-white text-gray-600 hover:text-blue-600 hover:shadow-sm rounded-[10px] text-xs font-bold transition-all"
                  title="Export Data"
                >
                  <Download className="w-4 h-4" /> 
                  <span className="hidden sm:inline">Export</span>
                </button>
                <div className="w-[1px] bg-gray-200 my-2 mx-1.5"></div>
                <button
                  onClick={() => setShowImportModal(true)}
                  className="inline-flex items-center justify-center gap-2 px-4 py-2 hover:bg-white text-gray-600 hover:text-purple-600 hover:shadow-sm rounded-[10px] text-xs font-bold transition-all"
                  title="Import Data"
                >
                  <Upload className="w-4 h-4" /> 
                  <span className="hidden sm:inline">Import</span>
                </button>
              </div>

              {/* Admin Bypass Toggle */}
              {isAdmin && (
                <div className={\`p-1.5 flex items-center rounded-[14px] border transition-colors shadow-sm \${adminBypassMode ? 'bg-red-50 border-red-200' : 'bg-gray-50 border-gray-200/80'}\`}>
                  <button
                    onClick={() => setAdminBypassMode(!adminBypassMode)}
                    className="flex items-center gap-2.5 px-3 py-1.5 text-xs font-bold"
                  >
                    <FastForward className={\`w-4 h-4 \${adminBypassMode ? 'text-red-500' : 'text-gray-400'}\`} />
                    <span className={\`hidden sm:inline \${adminBypassMode ? 'text-red-600' : 'text-gray-500'}\`}>Bypass</span>
                    <div className={\`relative w-9 h-5 rounded-full transition-colors duration-300 ring-1 ring-inset \${adminBypassMode ? 'bg-red-500 ring-red-600' : 'bg-gray-300 ring-gray-400/30'}\`}>
                      <span className={\`absolute top-[2px] left-[2px] w-4 h-4 bg-white rounded-full shadow-sm transition-transform duration-300 \${adminBypassMode ? 'translate-x-4' : 'translate-x-0'}\`} />
                    </div>
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Sub Row 2: Search + filter — only for applications tab */}
          {activeTab === 'applications' && (
            <div className="mt-6 pt-5 border-t border-gray-100">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
                {/* Search */}
                <div className="lg:col-span-2">
                  <label className="block text-[11px] font-black uppercase text-gray-400 tracking-wider mb-2">Search Query</label>
                  <div className="relative group">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 group-focus-within:text-blue-500 transition-colors" />
                    <input
                      type="text"
                      placeholder="Search by name, employee number, or reference..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="w-full pl-11 pr-4 py-3.5 border border-gray-200 rounded-[14px] text-sm focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 bg-gray-50 hover:bg-white transition-all font-medium"
                    />
                  </div>
                </div>

                {/* Enhanced Filter */}
                <div>
                  <label className="block text-[11px] font-black uppercase text-gray-400 tracking-wider mb-2">Filters</label>
                  <EnhancedFilter
                    selectedTown={selectedTown}
                    onTownChange={handleTownChange}
                    allTowns={propAllTowns}
                    userRole={userRole}
                    userTown={userTown}
                    isRegionalManager={isRegionalManager}
                    selectedStatus={selectedStatus}
                    onStatusChange={setSelectedStatus}
                    selectedMonth={selectedMonth}
                    onMonthChange={setSelectedMonth}
                    selectedDateRange={selectedDateRange}
                    onDateRangeChange={setSelectedDateRange}
                    customStartDate={customStartDate}
                    onCustomStartDateChange={setCustomStartDate}
                    customEndDate={customEndDate}
                    onCustomEndDateChange={setCustomEndDate}
                  />
                </div>

                {/* Reset */}
                <div className="flex items-end">
                  <button
                    onClick={() => {
                      setSearchTerm('');
                      setSelectedStatus('all');
                      setSelectedMonth('all');
                      setSelectedDateRange('all');
                      handleTownChange('');
                    }}
                    className="w-full px-4 py-3 text-xs font-bold text-gray-500 bg-gray-50 hover:bg-gray-100 hover:text-gray-900 border border-gray-200/80 rounded-[14px] transition-all h-[50px]"
                  >
                    Reset All Filters
                  </button>
                </div>
              </div>

              {/* Custom date range */}
              {selectedDateRange === 'custom' && (
                <div className="mt-5 flex items-center gap-4 p-4 bg-blue-50/50 rounded-[14px] border border-blue-100">
                  <Calendar className="w-5 h-5 text-blue-500 shrink-0" />
                  <span className="text-xs font-bold text-blue-900">Custom Range:</span>
                  <input
                    type="date"
                    value={customStartDate}
                    onChange={(e) => setCustomStartDate(e.target.value)}
                    className="border border-blue-200 rounded-[10px] px-3.5 py-2 text-xs text-blue-900 bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 font-medium font-mono shadow-sm"
                  />
                  <span className="text-[10px] font-black text-blue-400 uppercase tracking-widest">TO</span>
                  <input
                    type="date"
                    value={customEndDate}
                    onChange={(e) => setCustomEndDate(e.target.value)}
                    className="border border-blue-200 rounded-[10px] px-3.5 py-2 text-xs text-blue-900 bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 font-medium font-mono shadow-sm"
                  />
                </div>
              )}

              {/* Active town filter badge */}
              {!isBranchManager && !isRegionalManager && selectedTown && (
                <div className="mt-5 flex items-center gap-3">
                  <span className="text-[11px] font-black text-gray-400 uppercase tracking-wider">Active Location:</span>
                  <span className="inline-flex items-center gap-1.5 bg-gray-900 text-white text-xs px-3.5 py-2 rounded-[10px] shadow-sm font-medium">
                    <MapPin className="w-3.5 h-3.5 text-gray-300" />
                    {getDisplayName(selectedTown)}
                    <button onClick={() => handleTownChange('')} className="text-gray-400 hover:text-white ml-2 bg-gray-800 hover:bg-gray-700 p-0.5 rounded-[6px] transition-colors">
                      <X className="w-4 h-4" />
                    </button>
                  </span>
                </div>
              )}
            </div>
          )}
        </div>`;

const startMarker = '{/* ── Action Bar (Enterprise Toolbar Style) ────────────────────────────────── */}';
const endMarkerStr = '{/* Bypass mode warning banner */}';

const startIndex = content.indexOf(startMarker);
const endIndex = content.indexOf(endMarkerStr);

if (startIndex !== -1 && endIndex !== -1) {
    const beforePart = content.substring(0, startIndex);
    const afterPart = content.substring(endIndex);
    let finalContent = beforePart + newActionBar + '\n\n        ' + afterPart;
    fs.writeFileSync('src/components/Settings/SalaryAdmin.tsx', finalContent);
    console.log("SUCCESS: Replaced Action Bar");
} else {
    console.log("ERROR: Could not find markers.", startIndex, endIndex);
}
