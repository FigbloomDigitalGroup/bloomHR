import React, { useState } from 'react';
import { Upload, Download, Send, CheckCircle, X, Plus, Trash2, FileSpreadsheet, Users, ArrowLeft, Search, Edit, Copy, AlertCircle, Loader } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import toast from 'react-hot-toast';
import * as XLSX from 'xlsx';

const MPesaSpreadsheetFullPage = ({ onBack, userRole }) => {
  const [rows, setRows] = useState([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [justification, setJustification] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [selectedRows, setSelectedRows] = useState(new Set());

  // Simple table component
  const SimpleTable = () => (
    <div className="overflow-x-auto">
      <table className="w-full bg-white border border-gray-200">
        <thead>
          <tr className="bg-gray-50 border-b border-gray-200">
            <th className="p-2 border-r border-gray-200 w-12">
              <input
                type="checkbox"
                onChange={(e) => {
                  if (e.target.checked) {
                    setSelectedRows(new Set(filteredRows.map(row => row.id)));
                  } else {
                    setSelectedRows(new Set());
                  }
                }}
                className="h-4 w-4"
              />
            </th>
            <th className="p-2 border-r border-gray-200 text-left text-xs font-semibold">Employee ID</th>
            <th className="p-2 border-r border-gray-200 text-left text-xs font-semibold">Employee Name</th>
            <th className="p-2 border-r border-gray-200 text-left text-xs font-semibold">Phone Number</th>
            <th className="p-2 border-r border-gray-200 text-left text-xs font-semibold">Amount</th>
            <th className="p-2 border-r border-gray-200 text-left text-xs font-semibold">Status</th>
            <th className="p-2 text-left text-xs font-semibold">Actions</th>
          </tr>
        </thead>
        <tbody>
          {filteredRows.map((row) => (
            <tr 
              key={row.id} 
              className={`border-b border-gray-200 ${
                selectedRows.has(row.id) ? 'bg-blue-50' : 'hover:bg-gray-50'
              }`}
            >
              <td className="p-2 border-r border-gray-200">
                <input
                  type="checkbox"
                  checked={selectedRows.has(row.id)}
                  onChange={(e) => {
                    const newSelected = new Set(selectedRows);
                    if (e.target.checked) {
                      newSelected.add(row.id);
                    } else {
                      newSelected.delete(row.id);
                    }
                    setSelectedRows(newSelected);
                  }}
                  className="h-4 w-4"
                />
              </td>
              <td className="p-2 border-r border-gray-200">
                <input
                  value={row.employee_id}
                  onChange={(e) => {
                    const updatedRows = rows.map(r => 
                      r.id === row.id ? { ...r, employee_id: e.target.value } : r
                    );
                    setRows(updatedRows);
                  }}
                  className="w-full text-xs p-1 border border-gray-300 rounded"
                  placeholder="EMP001"
                />
              </td>
              <td className="p-2 border-r border-gray-200">
                <input
                  value={row.employee_name}
                  onChange={(e) => {
                    const updatedRows = rows.map(r => 
                      r.id === row.id ? { ...r, employee_name: e.target.value } : r
                    );
                    setRows(updatedRows);
                  }}
                  className="w-full text-xs p-1 border border-gray-300 rounded"
                  placeholder="John Doe"
                />
              </td>
              <td className="p-2 border-r border-gray-200">
                <input
                  value={row.phone_number}
                  onChange={(e) => {
                    const updatedRows = rows.map(r => 
                      r.id === row.id ? { ...r, phone_number: e.target.value } : r
                    );
                    setRows(updatedRows);
                  }}
                  className="w-full text-xs p-1 border border-gray-300 rounded font-mono"
                  placeholder="0712345678"
                />
              </td>
              <td className="p-2 border-r border-gray-200">
                <input
                  type="number"
                  value={row.amount}
                  onChange={(e) => {
                    const updatedRows = rows.map(r => 
                      r.id === row.id ? { ...r, amount: e.target.value } : r
                    );
                    setRows(updatedRows);
                  }}
                  className="w-full text-xs p-1 border border-gray-300 rounded"
                  placeholder="0.00"
                />
              </td>
              <td className="p-2 border-r border-gray-200">
                <span className={`text-xs px-2 py-1 rounded ${
                  row.status === 'sent' ? 'bg-green-100 text-green-800' :
                  row.status === 'failed' ? 'bg-red-100 text-red-800' :
                  row.status === 'processing' ? 'bg-blue-100 text-blue-800' :
                  'bg-gray-100 text-gray-800'
                }`}>
                  {row.status}
                </span>
              </td>
              <td className="p-2">
                <div className="flex gap-1">
                  <button
                    onClick={() => {
                      const duplicatedRow = { ...row, id: Date.now(), status: 'pending' };
                      setRows(prev => [...prev, duplicatedRow]);
                      toast.success('Row duplicated');
                    }}
                    className="p-1 text-gray-600 hover:text-blue-600 hover:bg-blue-50 rounded text-xs"
                    title="Duplicate"
                  >
                    <Copy size={12} />
                  </button>
                  <button
                    onClick={() => {
                      setRows(prev => prev.filter(r => r.id !== row.id));
                      setSelectedRows(prev => {
                        const newSelected = new Set(prev);
                        newSelected.delete(row.id);
                        return newSelected;
                      });
                      toast.success('Row deleted');
                    }}
                    className="p-1 text-gray-600 hover:text-red-600 hover:bg-red-50 rounded text-xs"
                    title="Delete"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  // Add a new empty row
  const addNewRow = () => {
    const newRow = {
      id: Date.now(),
      employee_id: '',
      employee_name: '',
      phone_number: '',
      amount: '',
      status: 'pending'
    };
    setRows(prev => [...prev, newRow]);
    toast.success('New row added');
  };

  // Add multiple rows
  const addMultipleRows = (count) => {
    const newRows = Array.from({ length: count }, (_, index) => ({
      id: Date.now() + index,
      employee_id: '',
      employee_name: '',
      phone_number: '',
      amount: '',
      status: 'pending'
    }));
    setRows(prev => [...prev, ...newRows]);
    toast.success(`Added ${count} new rows`);
  };

  // Delete selected rows
  const deleteSelectedRows = () => {
    if (selectedRows.size > 0) {
      setRows(prev => prev.filter(row => !selectedRows.has(row.id)));
      setSelectedRows(new Set());
      toast.success(`${selectedRows.size} rows deleted`);
    }
  };

  // Clear all rows
  const clearAllRows = () => {
    if (rows.length > 0 && window.confirm('Are you sure you want to clear all rows?')) {
      setRows([]);
      setSelectedRows(new Set());
      toast.success('All rows cleared');
    }
  };

  // Filter rows based on search and status
  const filteredRows = rows.filter(row => {
    const matchesSearch = !searchTerm || 
      row.employee_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      row.employee_id?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      row.phone_number?.includes(searchTerm);
    
    const matchesStatus = filterStatus === 'all' || row.status === filterStatus;
    
    return matchesSearch && matchesStatus;
  });

  // Format phone number to 254 format
  const formatPhoneNumber = (phone) => {
    if (!phone) return '';
    
    let cleaned = phone.replace(/\D/g, '');
    
    if (cleaned.startsWith('0')) {
      cleaned = '254' + cleaned.substring(1);
    } else if (cleaned.startsWith('7')) {
      cleaned = '254' + cleaned;
    }
    
    return cleaned;
  };

  // Validate row data
  const validateRow = (row) => {
    const errors = [];
    
    if (!row.employee_id?.trim()) errors.push('Employee ID is required');
    if (!row.employee_name?.trim()) errors.push('Employee Name is required');
    if (!row.phone_number?.trim()) errors.push('Phone Number is required');
    
    const amount = parseFloat(row.amount);
    if (!amount || amount <= 0) errors.push('Valid Amount is required');
    
    const phoneRegex = /^[0-9+\-\s()]{10,15}$/;
    if (!phoneRegex.test(row.phone_number)) errors.push('Valid Phone Number is required');
    
    return errors;
  };

  // Process single M-PESA payment
  const processSingleMpesaPayment = async (row) => {
    try {
      const phoneNumber = formatPhoneNumber(row.phone_number);
      if (!phoneNumber) {
        throw new Error(`Invalid phone number for ${row.employee_name}`);
      }

      const response = await fetch('https://mpesa-22p0.onrender.com/api/mpesa/b2c', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          phoneNumber: phoneNumber,
          amount: parseFloat(row.amount),
          employeeNumber: row.employee_id,
          fullName: row.employee_name
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to process payment');
      }

      const result = await response.json();
      return { success: true, result };
    } catch (error) {
      return { success: false, error: error.message };
    }
  };

  // Process all payments
  const processPayments = async () => {
    const rowsToProcess = selectedRows.size > 0 
      ? rows.filter(row => selectedRows.has(row.id))
      : rows;

    // Validate all rows first
    const validationResults = rowsToProcess.map(row => ({
      row,
      errors: validateRow(row)
    }));

    const invalidRows = validationResults.filter(result => result.errors.length > 0);
    
    if (invalidRows.length > 0) {
      const errorMessage = invalidRows
        .slice(0, 3)
        .map(result => `${result.row.employee_name || 'Unnamed'}: ${result.errors.join(', ')}`)
        .join('\n');
      
      toast.error(`Please fix errors in ${invalidRows.length} rows:\n${errorMessage}`);
      return;
    }

    const validRows = rowsToProcess.filter(row => validateRow(row).length === 0);

    if (validRows.length === 0) {
      toast.error('No valid payments to process');
      return;
    }

    if (userRole === 'maker' && !justification.trim()) {
      toast.error('Please provide a justification for this payment request');
      return;
    }

    setIsProcessing(true);

    try {
      if (userRole === 'credit_analyst_officer') {
        // Process payments immediately for admin
        const results = [];
        
        for (const row of validRows) {
          // Update status to processing
          setRows(prev => prev.map(r => 
            r.id === row.id ? { ...r, status: 'processing' } : r
          ));

          const result = await processSingleMpesaPayment(row);
          
          if (result.success) {
            setRows(prev => prev.map(r => 
              r.id === row.id ? { ...r, status: 'sent' } : r
            ));
            results.push({ ...row, success: true });
          } else {
            setRows(prev => prev.map(r => 
              r.id === row.id ? { ...r, status: 'failed' } : r
            ));
            results.push({ ...row, success: false, error: result.error });
          }

          await new Promise(resolve => setTimeout(resolve, 800));
        }

        const successCount = results.filter(r => r.success).length;
        if (successCount === validRows.length) {
          toast.success(`All ${validRows.length} payments processed successfully!`);
        } else {
          toast.success(`Processed ${successCount} of ${validRows.length} payments successfully`);
        }
      } else {
        // Create payment request for approval (maker role)
        const { data: { user } } = await supabase.auth.getUser();
        
        const paymentData = {
          type: 'bulk',
          employees_data: validRows.map(row => ({
            employee_id: row.employee_id,
            employee_name: row.employee_name,
            employeeNu: row.phone_number,
            net_pay: parseFloat(row.amount)
          })),
          justification: justification,
          created_by: user.id,
          status: 'pending',
          total_amount: validRows.reduce((sum, row) => sum + parseFloat(row.amount), 0),
          created_at: new Date().toISOString()
        };

        const { data, error } = await supabase
          .from('payment_flows')
          .insert([paymentData])
          .select()
          .single();

        if (error) throw error;

        toast.success(`Payment request submitted for ${validRows.length} employees! Awaiting approval.`);
        onBack();
      }
    } catch (error) {
      console.error('Payment processing error:', error);
      toast.error('Failed to process payments: ' + error.message);
    } finally {
      setIsProcessing(false);
    }
  };

  // Import from Excel
  const handleFileUpload = (event) => {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const worksheet = workbook.Sheets[workbook.SheetNames[0]];
        const jsonData = XLSX.utils.sheet_to_json(worksheet);

        const importedRows = jsonData.map((row, index) => ({
          id: Date.now() + index,
          employee_id: row['Employee ID'] || row['employee_id'] || row['ID'] || '',
          employee_name: row['Employee Name'] || row['employee_name'] || row['Name'] || '',
          phone_number: row['Phone Number'] || row['phone_number'] || row['Phone'] || row['Mobile'] || '',
          amount: row['Amount'] || row['amount'] || row['Net Pay'] || row['net_pay'] || '',
          status: 'pending'
        }));

        setRows(importedRows);
        toast.success(`Imported ${importedRows.length} records from Excel`);
        event.target.value = '';
      } catch (error) {
        console.error('Import error:', error);
        toast.error('Error reading Excel file. Please check the format.');
      }
    };
    reader.readAsArrayBuffer(file);
  };

  // Export to Excel
  const exportToExcel = () => {
    if (rows.length === 0) {
      toast.error('No data to export');
      return;
    }

    const exportData = rows.map(row => ({
      'Employee ID': row.employee_id,
      'Employee Name': row.employee_name,
      'Phone Number': row.phone_number,
      'Amount': row.amount,
      'Status': row.status
    }));

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'M-PESA Payments');
    
    const colWidths = [
      { wch: 15 }, { wch: 25 }, { wch: 15 }, { wch: 12 }, { wch: 12 }
    ];
    ws['!cols'] = colWidths;
    
    XLSX.writeFile(wb, `mpesa_bulk_payments_${new Date().toISOString().slice(0, 10)}.xlsx`);
    toast.success('Excel file exported successfully!');
  };

  // Download template
  const downloadTemplate = () => {
    const templateData = [
      {
        'Employee ID': 'EMP001',
        'Employee Name': 'John Doe',
        'Phone Number': '0712345678',
        'Amount': '15000'
      },
      {
        'Employee ID': 'EMP002', 
        'Employee Name': 'Jane Smith',
        'Phone Number': '0723456789',
        'Amount': '20000'
      }
    ];

    const ws = XLSX.utils.json_to_sheet(templateData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Template');
    XLSX.writeFile(wb, 'mpesa_payment_template.xlsx');
    toast.success('Template downloaded!');
  };

  // Calculate totals and statistics
  const totalAmount = rows.reduce((sum, row) => sum + (parseFloat(row.amount) || 0), 0);
  const selectedAmount = rows
    .filter(row => selectedRows.has(row.id))
    .reduce((sum, row) => sum + (parseFloat(row.amount) || 0), 0);

  const validRowsCount = rows.filter(row => validateRow(row).length === 0).length;
  const sentCount = rows.filter(row => row.status === 'sent').length;
  const failedCount = rows.filter(row => row.status === 'failed').length;
  const processingCount = rows.filter(row => row.status === 'processing').length;

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      {/* Header */}
      <div className="bg-white rounded-lg shadow-sm p-4 mb-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={onBack}
              className="flex items-center gap-2 px-3 py-2 text-gray-700 hover:text-gray-900 hover:bg-gray-100 rounded border border-gray-300 text-xs"
            >
              <ArrowLeft size={14} />
              Back to Payroll
            </button>
            
            {/* <div className="flex items-center gap-3">
              <div className="p-2 bg-green-500 rounded">
                <FileSpreadsheet className="w-5 h-5 text-white" />
              </div>
              <div>
                <h1 className="text-lg font-bold text-gray-900">M-PESA Bulk Payments</h1>
                <p className="text-gray-600 text-xs">Simple spreadsheet interface for bulk M-PESA transactions</p>
              </div>
            </div> */}
          </div>

          <div className="flex items-center gap-3">
            <div className="text-right">
              <div className="text-xs text-gray-600 font-semibold">Total Amount</div>
              <div className="text-lg font-bold text-green-600">
                KSh {totalAmount.toLocaleString()}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-3 mb-4">
        {[
          { 
            label: 'Total Records', 
            value: rows.length, 
            color: 'bg-blue-500',
            textColor: 'text-blue-600',
            icon: Users
          },
          { 
            label: 'Valid Records', 
            value: validRowsCount, 
            color: 'bg-green-500',
            textColor: 'text-green-600',
            icon: CheckCircle
          },
          { 
            label: 'Processing', 
            value: processingCount, 
            color: 'bg-blue-500',
            textColor: 'text-blue-600',
            icon: Loader
          },
          { 
            label: 'Sent', 
            value: sentCount, 
            color: 'bg-green-500',
            textColor: 'text-green-600',
            icon: Send
          },
          { 
            label: 'Failed', 
            value: failedCount, 
            color: 'bg-red-500',
            textColor: 'text-red-600',
            icon: X
          }
        ].map((stat, index) => {
          const Icon = stat.icon;
          
          return (
            <div key={index} className="bg-white rounded-lg shadow-sm p-3 border border-gray-200">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">{stat.label}</p>
                  <p className={`text-sm font-bold ${stat.textColor}`}>
                    {stat.value}
                  </p>
                </div>
                <div className={`p-2 ${stat.color} rounded`}>
                  <Icon className="w-3 h-3 text-white" />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Controls Bar */}
      <div className="bg-white rounded-lg shadow-sm p-4 mb-4 border border-gray-200">
        <div className="flex items-center gap-2 mb-4">
          <h3 className="text-sm font-semibold text-gray-900">Payment Spreadsheet Controls</h3>
        </div>
        
        <div className="flex flex-wrap gap-3 items-center justify-between">
          <div className="flex flex-wrap gap-2">
            <button
              onClick={addNewRow}
              className="flex items-center gap-2 bg-green-500 hover:bg-green-600 text-white px-3 py-2 rounded text-xs font-semibold"
            >
              <Plus size={12} />
              Add Row
            </button>
            
            <button
              onClick={() => addMultipleRows(5)}
              className="flex items-center gap-2 bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-2 rounded text-xs font-semibold"
            >
              <Plus size={12} />
              Add 5 Rows
            </button>

            <label className="flex items-center gap-2 bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-2 rounded text-xs font-semibold cursor-pointer">
              <Upload size={12} />
              Import Excel
              <input
                type="file"
                accept=".xlsx, .xls, .csv"
                onChange={handleFileUpload}
                className="hidden"
              />
            </label>

            <button
              onClick={downloadTemplate}
              className="flex items-center gap-2 bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-2 rounded text-xs font-semibold"
            >
              <Download size={12} />
              Template
            </button>

            <button
              onClick={exportToExcel}
              disabled={rows.length === 0}
              className="flex items-center gap-2 bg-gray-100 hover:bg-gray-200 disabled:opacity-50 text-gray-700 px-3 py-2 rounded text-xs font-semibold"
            >
              <Download size={12} />
              Export
            </button>
          </div>

          <div className="flex flex-wrap gap-2">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 text-gray-400 w-3 h-3" />
              <input
                type="text"
                placeholder="Search employees..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-8 pr-3 py-2 bg-gray-50 border border-gray-300 rounded text-xs w-48"
              />
            </div>

            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="px-3 py-2 bg-gray-50 border border-gray-300 rounded text-xs"
            >
              <option value="all">All Status</option>
              <option value="pending">Pending</option>
              <option value="processing">Processing</option>
              <option value="sent">Sent</option>
              <option value="failed">Failed</option>
            </select>
          </div>
        </div>

        {/* Action Buttons Row */}
        <div className="flex flex-wrap gap-2 mt-4">
          {selectedRows.size > 0 && (
            <button
              onClick={deleteSelectedRows}
              className="flex items-center gap-2 bg-red-500 hover:bg-red-600 text-white px-3 py-2 rounded text-xs font-semibold"
            >
              <Trash2 size={12} />
              Delete ({selectedRows.size})
            </button>
          )}

          {rows.length > 0 && (
            <button
              onClick={clearAllRows}
              className="flex items-center gap-2 bg-white border border-red-300 text-red-600 px-3 py-2 rounded text-xs font-semibold hover:bg-red-50"
            >
              <Trash2 size={12} />
              Clear All
            </button>
          )}

          {selectedRows.size > 0 && (
            <button
              onClick={() => {
                if (selectedRows.size === filteredRows.length) {
                  setSelectedRows(new Set());
                } else {
                  setSelectedRows(new Set(filteredRows.map(row => row.id)));
                }
              }}
              className="flex items-center gap-2 bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-2 rounded text-xs font-semibold"
            >
              {selectedRows.size === filteredRows.length ? 'Deselect All' : 'Select All'}
            </button>
          )}
        </div>

        {/* Justification for Maker Role */}
        {userRole === 'maker' && (
          <div className="mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded">
            <label className="block text-xs font-semibold text-yellow-800 mb-1 flex items-center gap-2">
              <AlertCircle size={12} />
              Justification for Payment Request *
            </label>
            <textarea
              value={justification}
              onChange={(e) => setJustification(e.target.value)}
              placeholder="Explain why this bulk payment is needed for approval..."
              rows={2}
              className="w-full px-3 py-2 border border-yellow-300 rounded text-xs bg-white"
            />
          </div>
        )}
      </div>

      {/* Spreadsheet Container */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
        {filteredRows.length === 0 ? (
          <div className="text-center py-12">
            <div className="w-16 h-16 bg-gray-200 rounded flex items-center justify-center mx-auto mb-4">
              
              <img src='logo (2).png' className="w-6"></img>
            </div>
            <h3 className="text-sm font-bold text-gray-900 mb-2">No payment records yet</h3>
            <p className="text-gray-600 mb-6 max-w-md mx-auto text-xs">
              Get started by adding rows manually or importing from an Excel file to create your bulk payment list.
            </p>
            <div className="flex gap-3 justify-center">
              <button
                onClick={addNewRow}
                className="flex items-center gap-2 bg-green-500 hover:bg-green-600 text-white px-4 py-2 rounded text-xs font-semibold"
              >
                <Plus size={12} />
                Add Your First Row
              </button>
              <label className="flex items-center gap-2 bg-gray-100 hover:bg-gray-200 text-gray-700 px-4 py-2 rounded text-xs font-semibold cursor-pointer">
                <Upload size={12} />
                Import from Excel
                <input
                  type="file"
                  accept=".xlsx, .xls, .csv"
                  onChange={handleFileUpload}
                  className="hidden"
                />
              </label>
            </div>
          </div>
        ) : (
          <>
            {/* Selection Summary */}
            {selectedRows.size > 0 && (
              <div className="bg-blue-50 border-b border-blue-200 px-4 py-2">
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-4">
                    <span className="font-semibold text-blue-800">
                      {selectedRows.size} {selectedRows.size === 1 ? 'row' : 'rows'} selected
                    </span>
                    <span className="text-blue-700 font-semibold">
                      Total: KSh {selectedAmount.toLocaleString()}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => setSelectedRows(new Set())}
                      className="text-blue-600 hover:text-blue-800 font-semibold text-xs"
                    >
                      Clear Selection
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Simple Table */}
            <SimpleTable />
          </>
        )}
      </div>

      {/* Action Footer */}
      {rows.length > 0 && (
        <div className="bg-white rounded-lg border border-gray-200 p-4 mt-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-6">
              <div className="text-xs">
                <span className="text-gray-600 font-semibold">Ready to process: </span>
                <span className="font-bold text-gray-900">{validRowsCount} of {rows.length} records</span>
              </div>
              <div className="text-xs">
                <span className="text-gray-600 font-semibold">Total amount: </span>
                <span className="font-bold text-green-600">
                  KSh {totalAmount.toLocaleString()}
                </span>
              </div>
              {selectedRows.size > 0 && (
                <div className="text-xs">
                  <span className="text-blue-600 font-semibold">Selected: </span>
                  <span className="font-bold text-blue-700">
                    {selectedRows.size} rows • KSh {selectedAmount.toLocaleString()}
                  </span>
                </div>
              )}
            </div>

            <div className="flex gap-2">
              <button
                onClick={onBack}
                className="px-4 py-2 text-xs font-semibold text-gray-700 bg-white border border-gray-300 rounded hover:bg-gray-50"
                disabled={isProcessing}
              >
                Cancel
              </button>
              
              <button
                onClick={processPayments}
                disabled={isProcessing || validRowsCount === 0 || (userRole === 'maker' && !justification.trim())}
                className="flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-green-500 hover:bg-green-600 rounded disabled:opacity-50"
              >
                {isProcessing ? (
                  <>
                    <Loader size={12} className="animate-spin" />
                    Processing...
                  </>
                ) : (
                  <>
                    <Send size={12} />
                    {userRole === 'credit_analyst_officer' 
                      ? `Process ${selectedRows.size > 0 ? selectedRows.size : validRowsCount} Payments`
                      : `Submit ${selectedRows.size > 0 ? selectedRows.size : validRowsCount} for Approval`
                    }
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MPesaSpreadsheetFullPage;