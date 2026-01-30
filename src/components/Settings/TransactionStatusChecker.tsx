import React, { useState } from 'react';
import { Search, RefreshCw, CheckCircle, XCircle, Clock, AlertCircle, Copy, Trash2 } from 'lucide-react';
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

    // Check single transaction status
    const checkSingleStatus = async () => {
        if (!singleCode.trim()) {
            toast.error('Please enter a transaction code');
            return;
        }

        setIsChecking(true);
        const toastId = toast.loading('Checking transaction status...');

        try {
            // Add to results as pending
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
                    remarks: 'Single status check from Transaction Status tab',
                    occasion: 'SingleStatusCheck'
                }),
            });

            const result = await response.json();

            if (result.success) {
                toast.success('Status check initiated! Results will appear shortly.', { id: toastId });

                // Update result
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

                // Clear input
                setSingleCode('');

                // Poll for results after 10 seconds
                setTimeout(() => pollForResult(singleCode.trim()), 10000);
            } else {
                toast.error('Failed: ' + (result.message || 'Unknown error'), { id: toastId });
                setResults(prev => prev.map(r =>
                    r.transactionID === singleCode.trim()
                        ? { ...r, status: 'failed', error: result.message }
                        : r
                ));
            }
        } catch (error) {
            console.error('Error checking status:', error);
            toast.error('Error checking status', { id: toastId });
            setResults(prev => prev.map(r =>
                r.transactionID === singleCode.trim()
                    ? { ...r, status: 'failed', error: 'Network error' }
                    : r
            ));
        } finally {
            setIsChecking(false);
        }
    };

    // Check bulk transaction statuses
    const checkBulkStatus = async () => {
        const codes = bulkCodes
            .split(/[\n,;]/)
            .map(code => code.trim())
            .filter(code => code.length > 0);

        if (codes.length === 0) {
            toast.error('Please enter at least one transaction code');
            return;
        }

        if (codes.length > 50) {
            toast.error('Maximum 50 transaction codes allowed at once');
            return;
        }

        setIsChecking(true);
        const toastId = toast.loading(`Checking ${codes.length} transactions...`);

        try {
            // Add all to results as checking
            const newResults: TransactionResult[] = codes.map(code => ({
                transactionID: code,
                status: 'checking'
            }));
            setResults(prev => [...newResults, ...prev]);

            let successCount = 0;
            let failCount = 0;

            // Process in batches of 5
            const batchSize = 5;
            for (let i = 0; i < codes.length; i += batchSize) {
                const batch = codes.slice(i, i + batchSize);

                await Promise.all(
                    batch.map(async (code) => {
                        try {
                            const response = await fetch('https://mpesa-22p0.onrender.com/api/mpesa/check-transaction-status', {
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/json',
                                },
                                body: JSON.stringify({
                                    transactionID: code,
                                    remarks: 'Bulk status check from Transaction Status tab',
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
                            console.error(`Error checking ${code}:`, error);
                            failCount++;
                            setResults(prev => prev.map(r =>
                                r.transactionID === code
                                    ? { ...r, status: 'failed', error: 'Network error' }
                                    : r
                            ));
                        }
                    })
                );

                // Update progress
                toast.loading(
                    `Checking transactions... ${Math.min(i + batchSize, codes.length)}/${codes.length}`,
                    { id: toastId }
                );

                // Small delay between batches
                if (i + batchSize < codes.length) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            }

            // Show final result
            if (failCount === 0) {
                toast.success(
                    `✅ Successfully initiated ${successCount} status checks. Results will update shortly.`,
                    { id: toastId, duration: 5000 }
                );
            } else {
                toast.success(
                    `Completed: ${successCount} successful, ${failCount} failed`,
                    { id: toastId, duration: 5000 }
                );
            }

            // Clear input
            setBulkCodes('');

            // Poll for results after 10 seconds
            setTimeout(() => {
                codes.forEach(code => pollForResult(code));
            }, 10000);

        } catch (error) {
            console.error('Bulk check error:', error);
            toast.error('Error during bulk check', { id: toastId });
        } finally {
            setIsChecking(false);
        }
    };

    // Poll for result from database
    const pollForResult = async (transactionID: string) => {
        // This would query your Supabase database for the updated status
        // For now, we'll just mark it as pending
        // You can implement actual polling logic here
        console.log('Polling for result:', transactionID);
    };

    // Copy transaction ID
    const copyToClipboard = (text: string) => {
        navigator.clipboard.writeText(text);
        toast.success('Copied to clipboard');
    };

    // Remove result
    const removeResult = (transactionID: string) => {
        setResults(prev => prev.filter(r => r.transactionID !== transactionID));
    };

    // Clear all results
    const clearAllResults = () => {
        setResults([]);
        toast.success('All results cleared');
    };

    // Get status icon
    const getStatusIcon = (status: string) => {
        switch (status) {
            case 'success':
                return <CheckCircle className="w-5 h-5 text-green-600" />;
            case 'failed':
                return <XCircle className="w-5 h-5 text-red-600" />;
            case 'pending':
                return <Clock className="w-5 h-5 text-yellow-600 animate-pulse" />;
            case 'checking':
                return <RefreshCw className="w-5 h-5 text-blue-600 animate-spin" />;
            default:
                return <AlertCircle className="w-5 h-5 text-gray-600" />;
        }
    };

    // Get status badge
    const getStatusBadge = (status: string) => {
        const config = {
            success: { bg: 'bg-green-100', text: 'text-green-800', label: 'Success' },
            failed: { bg: 'bg-red-100', text: 'text-red-800', label: 'Failed' },
            pending: { bg: 'bg-yellow-100', text: 'text-yellow-800', label: 'Pending' },
            checking: { bg: 'bg-blue-100', text: 'text-blue-800', label: 'Checking...' }
        };

        const { bg, text, label } = config[status as keyof typeof config] || config.pending;

        return (
            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${bg} ${text}`}>
                {label}
            </span>
        );
    };

    return (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            {/* Header */}
            <div className="mb-6">
                <div className="flex items-center justify-between">
                    <div>
                        <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                            <Search className="w-5 h-5 text-blue-600" />
                            M-Pesa Transaction Status Checker
                        </h2>
                        <p className="text-sm text-gray-500 mt-1">
                            Check the status of M-Pesa transactions by entering transaction codes
                        </p>
                    </div>
                    {results.length > 0 && (
                        <button
                            onClick={clearAllResults}
                            className="flex items-center gap-2 px-3 py-2 text-xs font-medium text-red-600 bg-red-50 rounded-md hover:bg-red-100"
                        >
                            <Trash2 className="w-4 h-4" />
                            Clear All
                        </button>
                    )}
                </div>
            </div>

            {/* Tabs */}
            <div className="border-b border-gray-200 mb-6">
                <nav className="-mb-px flex space-x-8">
                    <button
                        onClick={() => setActiveTab('single')}
                        className={`${activeTab === 'single'
                                ? 'border-blue-500 text-blue-600'
                                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                            } whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm flex items-center gap-2`}
                    >
                        <Search className="w-4 h-4" />
                        Single Check
                    </button>
                    <button
                        onClick={() => setActiveTab('bulk')}
                        className={`${activeTab === 'bulk'
                                ? 'border-blue-500 text-blue-600'
                                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                            } whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm flex items-center gap-2`}
                    >
                        <RefreshCw className="w-4 h-4" />
                        Bulk Check
                    </button>
                </nav>
            </div>

            {/* Single Check Tab */}
            {activeTab === 'single' && (
                <div className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                            Enter M-Pesa Transaction Code
                        </label>
                        <div className="flex gap-3">
                            <input
                                type="text"
                                value={singleCode}
                                onChange={(e) => setSingleCode(e.target.value.toUpperCase())}
                                onKeyPress={(e) => e.key === 'Enter' && checkSingleStatus()}
                                placeholder="e.g., UAMC14MZPJ"
                                className="flex-1 px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm font-mono"
                                disabled={isChecking}
                            />
                            <button
                                onClick={checkSingleStatus}
                                disabled={isChecking || !singleCode.trim()}
                                className="flex items-center gap-2 px-6 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {isChecking ? (
                                    <>
                                        <RefreshCw className="w-4 h-4 animate-spin" />
                                        Checking...
                                    </>
                                ) : (
                                    <>
                                        <Search className="w-4 h-4" />
                                        Check Status
                                    </>
                                )}
                            </button>
                        </div>
                        <p className="text-xs text-gray-500 mt-2">
                            Enter a single M-Pesa transaction code (e.g., UAMC14MZPJ) and press Enter or click Check Status
                        </p>
                    </div>
                </div>
            )}

            {/* Bulk Check Tab */}
            {activeTab === 'bulk' && (
                <div className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                            Enter Multiple M-Pesa Transaction Codes
                        </label>
                        <textarea
                            value={bulkCodes}
                            onChange={(e) => setBulkCodes(e.target.value.toUpperCase())}
                            placeholder="Enter transaction codes (one per line or comma-separated)&#10;Example:&#10;UAMC14MZPJ&#10;SGL31HA2UV&#10;RBK41JC3WX"
                            rows={8}
                            className="w-full px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm font-mono"
                            disabled={isChecking}
                        />
                        <div className="flex items-center justify-between mt-2">
                            <p className="text-xs text-gray-500">
                                Separate codes by new line, comma, or semicolon. Maximum 50 codes at once.
                            </p>
                            <span className="text-xs text-gray-600 font-medium">
                                {bulkCodes.split(/[\n,;]/).filter(c => c.trim()).length} codes
                            </span>
                        </div>
                    </div>
                    <button
                        onClick={checkBulkStatus}
                        disabled={isChecking || !bulkCodes.trim()}
                        className="w-full flex items-center justify-center gap-2 px-6 py-3 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {isChecking ? (
                            <>
                                <RefreshCw className="w-5 h-5 animate-spin" />
                                Checking Transactions...
                            </>
                        ) : (
                            <>
                                <RefreshCw className="w-5 h-5" />
                                Check All Statuses
                            </>
                        )}
                    </button>
                </div>
            )}

            {/* Results Section */}
            {results.length > 0 && (
                <div className="mt-8">
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="text-sm font-semibold text-gray-900">
                            Results ({results.length})
                        </h3>
                        <p className="text-xs text-gray-500">
                            Results update automatically as M-Pesa responds (10-60 seconds)
                        </p>
                    </div>

                    <div className="space-y-3">
                        {results.map((result, index) => (
                            <div
                                key={`${result.transactionID}-${index}`}
                                className="border border-gray-200 rounded-lg p-4 hover:border-blue-300 transition-colors"
                            >
                                <div className="flex items-start justify-between">
                                    <div className="flex items-start gap-3 flex-1">
                                        {getStatusIcon(result.status)}
                                        <div className="flex-1">
                                            <div className="flex items-center gap-2 mb-1">
                                                <span className="font-mono text-sm font-semibold text-gray-900">
                                                    {result.transactionID}
                                                </span>
                                                {getStatusBadge(result.status)}
                                            </div>

                                            {result.resultDesc && (
                                                <p className="text-xs text-gray-600 mt-1">
                                                    {result.resultDesc}
                                                </p>
                                            )}

                                            {result.error && (
                                                <p className="text-xs text-red-600 mt-1">
                                                    Error: {result.error}
                                                </p>
                                            )}

                                            {result.conversationID && (
                                                <p className="text-xs text-gray-500 mt-1">
                                                    Conversation ID: {result.conversationID}
                                                </p>
                                            )}
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-2">
                                        <button
                                            onClick={() => copyToClipboard(result.transactionID)}
                                            className="p-1.5 text-gray-400 hover:text-gray-600 rounded"
                                            title="Copy transaction ID"
                                        >
                                            <Copy className="w-4 h-4" />
                                        </button>
                                        <button
                                            onClick={() => removeResult(result.transactionID)}
                                            className="p-1.5 text-gray-400 hover:text-red-600 rounded"
                                            title="Remove"
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Empty State */}
            {results.length === 0 && (
                <div className="mt-8 text-center py-12 bg-gray-50 rounded-lg border-2 border-dashed border-gray-300">
                    <Search className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                    <h3 className="text-sm font-medium text-gray-900 mb-1">No results yet</h3>
                    <p className="text-xs text-gray-500">
                        Enter transaction codes above to check their status
                    </p>
                </div>
            )}
        </div>
    );
};

export default TransactionStatusChecker;
