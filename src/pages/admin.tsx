import { motion, AnimatePresence } from 'framer-motion';
import {
  Users,
  FileText,
  CheckCircle,
  Loader2,
  AlertCircle,
  ChevronDown,
  CheckSquare,
  Square,
  Upload,
  Download,
  X,
  ArrowRight,
  Table
} from 'lucide-react';
import EmailDashboard from '../components/Email/EmailDashboard';
import { useStaffSignupLogic } from '../hooks/useStaffSignupLogic';

export default function StaffSignupRequests() {
  const {
    requests,
    filteredRequests,
    loading,
    processingId,
    selectedBranch,
    currentPage,
    totalCount,
    isDropdownOpen,
    searchTerm,
    selectedRequests,
    bulkProcessing,
    checkingExistingUsers,
    showBulkUpload,
    bulkEmails,
    bulkBranch,
    uploadingBulk,
    uploadMethod,
    excelFile,
    parsedData,
    activeTab,
    filteredBranches,
    totalPages,

    // Setters
    setIsDropdownOpen,
    setSearchTerm,
    setShowBulkUpload,
    setBulkEmails,
    setBulkBranch,
    setUploadMethod,
    setActiveTab,

    // Handlers
    checkAllExistingUsers,
    handleProcessRequest,
    handleBulkProcess,
    downloadExcelTemplate,
    handleExcelUpload,
    handleBulkUploadFromExcel,
    handleManualBulkUpload,
    getEmailStatus,
    handleReject,
    handleBranchSelect,
    toggleRequestSelection,
    toggleSelectAll,
    handlePreviousPage,
    handleNextPage,
    getSelectedBranchLabel,
    getBranchDisplayName
  } = useStaffSignupLogic();

  if (loading && requests.length === 0) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center">
        <Loader2 className="w-8 h-8 text-indigo-600 animate-spin mb-4" />
        <p className="text-gray-500 font-medium text-sm">Loading requests...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 font-sans text-gray-900 p-8">
      <div className="max-w-[1200px] mx-auto space-y-8">

        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Staff Requests</h1>
            <p className="text-sm text-gray-500 mt-1">Manage pending access approvals and invitations.</p>
          </div>

          <div className="flex items-center gap-3">
            <div className="bg-white border border-gray-200 rounded-lg p-1 flex items-center shadow-sm">
              <button
                onClick={() => setActiveTab('requests')}
                className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${activeTab === 'requests'
                    ? 'bg-gray-100 text-gray-900'
                    : 'text-gray-500 hover:text-gray-900 hover:bg-gray-50'
                  }`}
              >
                Requests
              </button>
              <div className="w-px h-4 bg-gray-200 mx-1"></div>
              <button
                onClick={() => setActiveTab('emails')}
                className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${activeTab === 'emails'
                    ? 'bg-gray-100 text-gray-900'
                    : 'text-gray-500 hover:text-gray-900 hover:bg-gray-50'
                  }`}
              >
                Email Logs
              </button>
            </div>
          </div>
        </div>

        {activeTab === 'requests' && (
          <div className="space-y-6">
            {/* Toolbar */}
            <div className="flex flex-col lg:flex-row gap-4 items-start lg:items-center justify-between">
              <div className="flex items-center gap-3 w-full lg:w-auto">
                {/* Branch Filter */}
                <div className="relative z-20">
                  <button
                    onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                    className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-200 rounded-lg shadow-sm hover:bg-gray-50 text-sm font-medium text-gray-700 w-full lg:w-[240px] justify-between"
                  >
                    <span className="truncate">{getSelectedBranchLabel()}</span>
                    <ChevronDown className="w-4 h-4 text-gray-400" />
                  </button>

                  <AnimatePresence>
                    {isDropdownOpen && (
                      <motion.div
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 4 }}
                        className="absolute top-full left-0 mt-1 w-[280px] bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden"
                      >
                        <div className="p-2 border-b border-gray-100">
                          <input
                            autoFocus
                            type="text"
                            placeholder="Filter branches..."
                            className="w-full px-3 py-1.5 text-sm bg-gray-50 border-none rounded-md focus:ring-1 focus:ring-indigo-500 outline-none"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                          />
                        </div>
                        <div className="max-h-[200px] overflow-y-auto p-1">
                          <button
                            onClick={() => handleBranchSelect('all')}
                            className={`w-full text-left px-3 py-2 text-sm rounded-md transition-colors ${selectedBranch === 'all' ? 'bg-indigo-50 text-indigo-700' : 'hover:bg-gray-50 text-gray-700'}`}
                          >
                            All Branches
                          </button>
                          {filteredBranches.map(branch => (
                            <button
                              key={branch}
                              onClick={() => handleBranchSelect(branch)}
                              className={`w-full text-left px-3 py-2 text-sm rounded-md transition-colors ${selectedBranch === branch ? 'bg-indigo-50 text-indigo-700' : 'hover:bg-gray-50 text-gray-700'}`}
                            >
                              {branch}
                            </button>
                          ))}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {/* Stats Pill */}
                <div className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-200 rounded-lg shadow-sm">
                  <span className="text-sm font-medium text-gray-500">Total Pending:</span>
                  <span className="text-sm font-bold text-gray-900">{totalCount}</span>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-3 w-full lg:w-auto justify-end">
                <button
                  onClick={checkAllExistingUsers}
                  disabled={checkingExistingUsers}
                  className="px-3 py-2 text-sm font-medium text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"
                >
                  {checkingExistingUsers ? 'Checking...' : 'Check Duplicates'}
                </button>
                <button
                  onClick={() => setShowBulkUpload(true)}
                  className="px-3 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 shadow-sm transition-colors flex items-center gap-2"
                >
                  <Upload className="w-4 h-4" />
                  Import Staff
                </button>
              </div>
            </div>

            {/* Bulk Actions Header */}
            {selectedRequests.size > 0 && (
              <div className="flex items-center justify-between p-4 bg-indigo-50 border border-indigo-100 rounded-lg text-indigo-900 animate-in fade-in slide-in-from-top-2 duration-200">
                <div className="flex items-center gap-3">
                  <span className="font-semibold text-sm">{selectedRequests.size} selected</span>
                  <button onClick={toggleSelectAll} className="text-xs hover:underline text-indigo-700">
                    {selectedRequests.size === filteredRequests.length ? 'Deselect All' : 'Select All'}
                  </button>
                </div>
                <button
                  onClick={handleBulkProcess}
                  disabled={bulkProcessing}
                  className="px-4 py-1.5 bg-indigo-600 text-white text-sm font-medium rounded-md hover:bg-indigo-700 shadow-sm disabled:opacity-70 transition-colors"
                >
                  {bulkProcessing ? 'Processing...' : 'Approve Selected'}
                </button>
              </div>
            )}

            {/* Request List */}
            <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
              {filteredRequests.length === 0 ? (
                <div className="p-12 text-center">
                  <div className="w-12 h-12 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-4">
                    <CheckCircle className="w-6 h-6 text-gray-300" />
                  </div>
                  <h3 className="text-gray-900 font-medium">No pending requests</h3>
                  <p className="text-gray-500 text-sm mt-1">There are no signup requests matching your filters.</p>
                </div>
              ) : (
                <div className="divide-y divide-gray-100">
                  <div className="bg-gray-50 px-6 py-3 border-b border-gray-100 flex items-center gap-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    <div className="w-6">
                      <button onClick={toggleSelectAll}>
                        {selectedRequests.size === filteredRequests.length && filteredRequests.length > 0 ? (
                          <CheckSquare className="w-4 h-4 text-indigo-600" />
                        ) : (
                          <Square className="w-4 h-4 text-gray-400" />
                        )}
                      </button>
                    </div>
                    <div className="flex-1">User Details</div>
                    <div className="w-32 hidden sm:block">Branch</div>
                    <div className="w-32 hidden sm:block">Date</div>
                    <div className="w-24">Status</div>
                    <div className="w-32 text-right">Actions</div>
                  </div>

                  {filteredRequests.map((request) => {
                    const emailStatus = getEmailStatus(request.email);
                    const hasBounced = emailStatus?.status === 'bounced';
                    const isSelected = selectedRequests.has(request.id);

                    return (
                      <div
                        key={request.id}
                        className={`px-6 py-4 flex items-center gap-4 hover:bg-gray-50 transition-colors group ${isSelected ? 'bg-indigo-50/30' : ''}`}
                      >
                        <div className="w-6 flex-shrink-0">
                          <button onClick={() => toggleRequestSelection(request.id)} className="text-gray-400 hover:text-indigo-600">
                            {isSelected ? <CheckSquare className="w-4 h-4 text-indigo-600" /> : <Square className="w-4 h-4" />}
                          </button>
                        </div>

                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900 truncate">{request.email}</p>
                          {request.existingUser?.exists && (
                            <span className="inline-flex items-center gap-1 mt-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-50 text-amber-700 border border-amber-100">
                              <Users className="w-3 h-3" /> Existing User
                            </span>
                          )}
                        </div>

                        <div className="w-32 hidden sm:block text-sm text-gray-500 truncate">
                          {getBranchDisplayName(request.branch)}
                        </div>

                        <div className="w-32 hidden sm:block text-sm text-gray-500">
                          {new Date(request.created_at).toLocaleDateString()}
                        </div>

                        <div className="w-24">
                          {hasBounced ? (
                            <div className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-rose-50 text-rose-700 border border-rose-100">
                              <AlertCircle className="w-3 h-3" /> Bounced
                            </div>
                          ) : emailStatus?.status === 'delivered' ? (
                            <div className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-100">
                              <CheckCircle className="w-3 h-3" /> Delivered
                            </div>
                          ) : (
                            <span className="text-xs text-gray-400 font-medium">Pending</span>
                          )}
                        </div>

                        <div className="w-32 flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => handleReject(request.id, request.email)}
                            disabled={processingId === request.id}
                            className="p-1.5 text-gray-400 hover:text-rose-600 hover:bg-rose-50 rounded-md transition-colors"
                            title="Reject"
                          >
                            <X className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleProcessRequest(request.id, request.email, request.branch)}
                            disabled={processingId === request.id || hasBounced}
                            className="p-1.5 text-indigo-600 hover:bg-indigo-50 rounded-md transition-colors"
                            title="Approve"
                          >
                            {processingId === request.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              {/* Pagination Footer */}
              {totalPages > 1 && (
                <div className="bg-gray-50 px-6 py-3 border-t border-gray-100 flex items-center justify-between">
                  <button
                    onClick={handlePreviousPage}
                    disabled={currentPage === 1}
                    className="text-sm font-medium text-gray-500 hover:text-gray-900 disabled:opacity-50"
                  >
                    Previous
                  </button>
                  <span className="text-xs text-gray-500">Page {currentPage} of {totalPages}</span>
                  <button
                    onClick={handleNextPage}
                    disabled={currentPage === totalPages}
                    className="text-sm font-medium text-gray-500 hover:text-gray-900 disabled:opacity-50"
                  >
                    Next
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Email Dashboard Tab */}
        {activeTab === 'emails' && (
          <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-6">
            <EmailDashboard />
          </div>
        )}
      </div>

      {/* Bulk Upload Modal Portal */}
      <AnimatePresence>
        {showBulkUpload && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/20 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-xl shadow-2xl w-full max-w-lg overflow-hidden border border-gray-200"
            >
              <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-gray-50">
                <h3 className="font-semibold text-gray-900">Import Staff</h3>
                <button onClick={() => setShowBulkUpload(false)} className="text-gray-400 hover:text-gray-600">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-6 space-y-6">
                <div className="flex bg-gray-100 p-1 rounded-lg">
                  <button
                    onClick={() => setUploadMethod('excel')}
                    className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-all ${uploadMethod === 'excel' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}
                  >
                    Excel File
                  </button>
                  <button
                    onClick={() => setUploadMethod('manual')}
                    className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-all ${uploadMethod === 'manual' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}
                  >
                    Manual Entry
                  </button>
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Default Branch</label>
                    <input
                      type="text"
                      value={bulkBranch}
                      onChange={(e) => setBulkBranch(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all"
                      placeholder="e.g. Headquarters"
                    />
                  </div>

                  {uploadMethod === 'excel' ? (
                    <div className="space-y-3">
                      <div className="border-2 border-dashed border-gray-200 rounded-xl p-8 text-center hover:bg-gray-50 transition-colors relative">
                        <input type="file" accept=".xlsx,.xls" onChange={handleExcelUpload} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
                        <Upload className="w-8 h-8 text-indigo-500 mx-auto mb-3" />
                        <p className="text-sm font-medium text-gray-900">{excelFile ? (excelFile as any).name : 'Click to upload Excel file'}</p>
                        <p className="text-xs text-gray-500 mt-1">.xlsx or .xls files supported</p>
                      </div>
                      <button onClick={downloadExcelTemplate} className="text-xs font-semibold text-indigo-600 hover:text-indigo-700 flex items-center justify-center gap-1.5 w-full py-2">
                        <Download className="w-3.5 h-3.5" /> Download Template
                      </button>
                    </div>
                  ) : (
                    <div>
                      <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Email Addresses</label>
                      <textarea
                        value={bulkEmails}
                        onChange={(e) => setBulkEmails(e.target.value)}
                        placeholder="user@example.com&#10;another@example.com"
                        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm h-32 font-mono focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none"
                      />
                    </div>
                  )}
                </div>
              </div>

              <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex justify-end gap-3">
                <button onClick={() => setShowBulkUpload(false)} className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors">
                  Cancel
                </button>
                <button
                  onClick={uploadMethod === 'excel' ? handleBulkUploadFromExcel : handleManualBulkUpload}
                  disabled={uploadingBulk || !bulkBranch || (uploadMethod === 'excel' ? !parsedData.length : !bulkEmails)}
                  className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-sm disabled:opacity-50 transition-colors flex items-center gap-2"
                >
                  {uploadingBulk && <Loader2 className="w-4 h-4 animate-spin" />}
                  Import Users
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
