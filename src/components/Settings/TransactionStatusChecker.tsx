import React, { useState } from 'react';
import { Search, RefreshCw, CheckCircle, XCircle, Clock, Copy, Trash2, Zap, Database, Server, Info, X } from 'lucide-react';
import toast from 'react-hot-toast';

interface TransactionResult {
    transactionID: string;
    status: 'pending' | 'success' | 'failed' | 'checking';
    resultCode?: number;
    resultDesc?: string;
    conversationID?: string;
    originatorConversationID?: string;
    error?: string;
}

const TransactionStatusChecker: React.FC = () => {
    const [singleCode, setSingleCode] = useState('');
    const [bulkCodes, setBulkCodes] = useState('');
    const [results, setResults] = useState<TransactionResult[]>([]);
    const [isChecking, setIsChecking] = useState(false);
    const [activeTab, setActiveTab] = useState<'single' | 'bulk'>('single');

    const checkSingleStatus = async () => {
        if (!singleCode.trim()) {
            toast.error('Please enter a Transaction ID');
            return;
        }

        setIsChecking(true);
        const toastId = toast.loading('Checking M-Pesa transaction status...');

        try {
            const newResult: TransactionResult = {
                transactionID: singleCode.trim(),
                status: 'checking'
            };
            setResults(prev => [newResult, ...prev]);

            const response = await fetch('https://mpesa-22p0.onrender.com/api/mpesa/check-transaction-status', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    transactionID: singleCode.trim(),
                    remarks: 'Manual status check from ZiraPro',
                    occasion: 'StatusCheck'
                }),
            });

            const result = await response.json();

            if (result.success) {
                toast.success('Check Request Sent', { id: toastId });
                setResults(prev => prev.map(r =>
                    r.transactionID === singleCode.trim()
                        ? {
                            ...r,
                            status: 'pending',
                            conversationID: result.data?.ConversationID,
                            originatorConversationID: result.data?.OriginatorConversationID
                        }
                        : r
                ));
                setSingleCode('');
            } else {
                toast.error('Failed: ' + (result.message || 'M-Pesa API Unresponsive'), { id: toastId });
                setResults(prev => prev.map(r =>
                    r.transactionID === singleCode.trim()
                        ? { ...r, status: 'failed', error: result.message }
                        : r
                ));
            }
        } catch (error) {
            toast.error('Network Error: Could not connect to API', { id: toastId });
            setResults(prev => prev.map(r =>
                r.transactionID === singleCode.trim()
                    ? { ...r, status: 'failed', error: 'Network Connection Failed' }
                    : r
            ));
        } finally {
            setIsChecking(false);
        }
    };

    const checkBulkStatus = async () => {
        const codes = bulkCodes
            .split(/[\n,;]/)
            .map(code => code.trim())
            .filter(code => code.length > 0);

        if (codes.length === 0) {
            toast.error('Please enter at least one Transaction ID');
            return;
        }

        setIsChecking(true);
        const toastId = toast.loading(`Checking bulk status: ${codes.length} transactions`);

        try {
            const newResults: TransactionResult[] = codes.map(code => ({
                transactionID: code,
                status: 'checking'
            }));
            setResults(prev => [...newResults, ...prev]);

            let successCount = 0;
            let failCount = 0;

            const batchSize = 5;
            for (let i = 0; i < codes.length; i += batchSize) {
                const batch = codes.slice(i, i + batchSize);
                await Promise.all(
                    batch.map(async (code) => {
                        try {
                            const response = await fetch('https://mpesa-22p0.onrender.com/api/mpesa/check-transaction-status', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    transactionID: code,
                                    remarks: 'Bulk automated status check',
                                    occasion: 'BulkStatusCheck'
                                }),
                            });

                            const result = await response.json();
                            if (result.success) {
                                successCount++;
                                setResults(prev => prev.map(r =>
                                    r.transactionID === code
                                        ? {
                                            ...r,
                                            status: 'pending',
                                            conversationID: result.data?.ConversationID,
                                            originatorConversationID: result.data?.OriginatorConversationID
                                        }
                                        : r
                                ));
                            } else {
                                failCount++;
                                setResults(prev => prev.map(r =>
                                    r.transactionID === code
                                        ? { ...r, status: 'failed', error: result.message }
                                        : r
                                ));
                            }
                        } catch (error) {
                            failCount++;
                            setResults(prev => prev.map(r =>
                                r.transactionID === code
                                    ? { ...r, status: 'failed', error: 'Connection Error' }
                                    : r
                            ));
                        }
                    })
                );
                if (i + batchSize < codes.length) {
                    await new Promise(resolve => setTimeout(resolve, 800));
                }
            }

            toast.success(`Bulk Check Complete: ${successCount} Successful`, { id: toastId });
            setBulkCodes('');
        } catch (error) {
            toast.error('Bulk Check Interrupted', { id: toastId });
        } finally {
            setIsChecking(false);
        }
    };

    const copyToClipboard = (text: string) => {
        navigator.clipboard.writeText(text);
        toast.success('Copied to Clipboard');
    };

    const getStatusStyles = (status: string) => {
        switch (status) {
            case 'success': return 'bg-green-50 text-green-700 border-green-200';
            case 'failed': return 'bg-red-50 text-red-700 border-red-200';
            case 'pending': return 'bg-yellow-50 text-yellow-700 border-yellow-200';
            case 'checking': return 'bg-blue-50 text-blue-700 border-blue-200';
            default: return 'bg-gray-50 text-gray-700 border-gray-200';
        }
    };

    return (
        <div className="p-6">
            {/* Header */}
            <div className="mb-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                        <Server className="w-5 h-5 text-gray-500" />
                        M-Pesa Transaction Status Checker
                    </h2>
                    <p className="text-sm text-gray-600 mt-1">
                        Manually query Safaricom's B2C API for the final status of a transaction
                    </p>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">

                {/* Left Column: Input Panel */}
                <div className="lg:col-span-5 space-y-6">
                    <div className="bg-white rounded-[10px] border border-gray-300 shadow-sm overflow-hidden">

                        {/* Tabs */}
                        <div className="flex border-b border-gray-300 bg-gray-50">
                            <button
                                onClick={() => setActiveTab('single')}
                                className={`flex-1 py-3 px-4 text-xs font-medium transition-colors ${activeTab === 'single'
                                        ? 'bg-white text-blue-600 border-b-2 border-blue-600'
                                        : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                                    }`}
                            >
                                <div className="flex items-center justify-center gap-2">
                                    <Zap className="w-4 h-4" /> Single Lookup
                                </div>
                            </button>
                            <button
                                onClick={() => setActiveTab('bulk')}
                                className={`flex-1 py-3 px-4 text-xs font-medium transition-colors ${activeTab === 'bulk'
                                        ? 'bg-white text-blue-600 border-b-2 border-blue-600'
                                        : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                                    }`}
                            >
                                <div className="flex items-center justify-center gap-2">
                                    <Database className="w-4 h-4" /> Bulk Lookup
                                </div>
                            </button>
                        </div>

                        {/* Input Area */}
                        <div className="p-5">
                            {activeTab === 'single' ? (
                                <div className="space-y-4">
                                    <div>
                                        <label className="block text-sm font-semibold text-gray-700 mb-2">
                                            Transaction ID (M-Pesa Receipt Number)
                                        </label>
                                        <div className="relative">
                                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                                            <input
                                                type="text"
                                                value={singleCode}
                                                onChange={(e) => setSingleCode(e.target.value.toUpperCase())}
                                                onKeyPress={(e) => e.key === 'Enter' && checkSingleStatus()}
                                                placeholder="e.g. SAA0XXXXXX"
                                                className="w-full pl-10 pr-4 py-2 bg-white border border-gray-300 rounded-[10px] focus:ring-2 focus:ring-blue-600 focus:border-blue-600 uppercase font-mono shadow-sm"
                                                disabled={isChecking}
                                            />
                                        </div>
                                    </div>

                                    <button
                                        onClick={checkSingleStatus}
                                        disabled={isChecking || !singleCode.trim()}
                                        className="text-xs w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-[10px] font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-sm"
                                    >
                                        {isChecking ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                                        Check Status
                                    </button>
                                </div>
                            ) : (
                                <div className="space-y-4">
                                    <div>
                                        <label className="block text-sm font-semibold text-gray-700 mb-2">
                                            Multiple Transaction IDs (One per line)
                                        </label>
                                        <textarea
                                            value={bulkCodes}
                                            onChange={(e) => setBulkCodes(e.target.value.toUpperCase())}
                                            placeholder="SAA0XXXXXX&#10;SAB1XXXXXX&#10;SAC2XXXXXX"
                                            rows={6}
                                            className="w-full p-3 bg-white border border-gray-300 rounded-[10px] focus:ring-2 focus:ring-blue-600 focus:border-blue-600 font-mono uppercase shadow-sm"
                                            disabled={isChecking}
                                        />
                                    </div>

                                    <button
                                        onClick={checkBulkStatus}
                                        disabled={isChecking || !bulkCodes.trim()}
                                        className="text-xs w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-[10px] font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-sm"
                                    >
                                        {isChecking ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Database className="w-4 h-4" />}
                                        Check {bulkCodes.split(/[\n,;]/).filter(c => c.trim()).length || 0} Transactions
                                    </button>
                                </div>
                            )}

                            {/* Info Callout */}
                            <div className="mt-6 p-3 bg-blue-50 border border-blue-200 rounded-[10px] flex gap-3 text-blue-800">
                                <Info className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
                                <p>
                                    This tool sends a server-to-server request directly to Safaricom's B2C API to query the
                                    Transaction Status. If the transaction was successful, Safaricom will queue a callback to the system within a few minutes.
                                </p>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Right Column: Results List */}
                <div className="lg:col-span-7">
                    <div className="bg-white rounded-[10px] border border-gray-300 shadow-sm h-full flex flex-col min-h-[500px]">
                        <div className="px-5 py-4 border-b border-gray-300 bg-gray-50 flex items-center justify-between rounded-[10px]">
                            <h3 className="font-semibold text-gray-700 flex items-center gap-2">
                                <RefreshCw className="w-4 h-4 text-gray-500" /> Result History
                            </h3>
                            {results.length > 0 && (
                                <button
                                    onClick={() => setResults([])}
                                    className="text-xs text-red-600 hover:text-red-800 font-medium flex items-center gap-1"
                                >
                                    <Trash2 className="w-3.5 h-3.5" /> Clear History
                                </button>
                            )}
                        </div>

                        <div className="flex-1 overflow-y-auto p-2 max-h-[600px]">
                            {results.length > 0 ? (
                                <ul className="divide-y divide-gray-200">
                                    {results.map((result) => (
                                        <li key={result.transactionID} className="p-3 hover:bg-gray-50 flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition-colors">
                                            <div className="flex items-center gap-4">
                                                {/* Status Icon */}
                                                <div className="shrink-0 bg-white shadow-sm border border-gray-200 w-10 h-10 rounded-full flex items-center justify-center">
                                                    {result.status === 'checking' ? <RefreshCw className="w-5 h-5 text-blue-600 animate-spin" /> :
                                                        result.status === 'success' ? <CheckCircle className="w-5 h-5 text-green-600" /> :
                                                            result.status === 'failed' ? <XCircle className="w-5 h-5 text-red-600" /> :
                                                                <Clock className="w-5 h-5 text-yellow-600" />}
                                                </div>

                                                {/* Details */}
                                                <div>
                                                    <div className="flex items-center gap-2">
                                                        <span className="font-bold text-gray-900 font-mono">
                                                            {result.transactionID}
                                                        </span>
                                                        <button
                                                            onClick={() => copyToClipboard(result.transactionID)}
                                                            className="text-xs text-gray-400 hover:text-blue-600"
                                                            title="Copy ID"
                                                        >
                                                            <Copy className="w-3.5 h-3.5" />
                                                        </button>
                                                    </div>
                                                    <p className="text-gray-500 mt-0.5">
                                                        Conv ID: {result.originatorConversationID || 'Waiting...'}
                                                    </p>
                                                    {result.error && (
                                                        <p className="text-red-600 mt-1">{result.error}</p>
                                                    )}
                                                </div>
                                            </div>

                                            {/* Status Badge & Remove Action */}
                                            <div className="flex items-center justify-between sm:justify-end gap-4 ml-14 sm:ml-0">
                                                <span className={`px-2.5 py-1 inline-flex leading-5 font-semibold rounded-[10px] border uppercase ${getStatusStyles(result.status)}`}>
                                                    {result.status}
                                                </span>
                                                <button
                                                    onClick={() => setResults(prev => prev.filter(r => r.transactionID !== result.transactionID))}
                                                    className="text-xs text-gray-400 hover:text-red-500"
                                                    title="Remove from list"
                                                >
                                                    <X className="w-4 h-4" />
                                                </button>
                                            </div>
                                        </li>
                                    ))}
                                </ul>
                            ) : (
                                <div className="h-full flex flex-col items-center justify-center py-20 text-gray-400">
                                    <Database className="w-12 h-12 mb-4 text-gray-300" />
                                    <p className="font-medium text-gray-500">No recent status checks.</p>
                                    <p className="mt-1 text-center">Enter a transaction ID on the left to query safaricom.</p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>

            </div>
        </div>
    );
};

export default TransactionStatusChecker;
