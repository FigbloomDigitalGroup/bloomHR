import React, { useState, useEffect } from 'react';
import { Smartphone, Users, CheckSquare, Square, Send, X, Search, ChevronDown } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import toast from 'react-hot-toast';

// Format phone number for M-Pesa (254 format)
const formatPhoneNumber = (phone) => {
  if (!phone) return '';

  // Remove any non-digit characters
  let cleaned = phone.replace(/\D/g, '');

  // Convert to 254 format if it starts with 0 or 7
  if (cleaned.startsWith('0')) {
    cleaned = '254' + cleaned.substring(1);
  } else if (cleaned.startsWith('7')) {
    cleaned = '254' + cleaned;
  }

  return cleaned;
};

// M-PESA Single Payment Confirmation Modal
const MpesaSinglePaymentModal = ({
  isOpen,
  onClose,
  employee,
  onConfirm
}) => {
  const [isProcessing, setIsProcessing] = useState(false);

  const handlePayment = async () => {
    setIsProcessing(true);
    try {
      await onConfirm();
      onClose();
    } catch (error) {
      console.error('Payment error:', error);
    } finally {
      setIsProcessing(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg max-w-md w-full p-6">
        <h3 className="text-lg font-medium text-gray-900 mb-4 flex items-center gap-2">
          <Smartphone className="h-5 w-5 text-green-600" />
          Confirm M-PESA Payment
        </h3>

        <div className="mb-4 p-3 bg-gray-50 rounded-md">
          <p className="text-xs text-gray-600 mb-2">
            You are about to send an M-PESA payment to:
          </p>
          <div className="space-y-1">
            <p className="font-medium">{employee.employee_name}</p>
            <p className="text-xs text-gray-600">ID: {employee.employee_id}</p>
            <p className="text-xs text-gray-600">
              Phone: {employee.phoneNumber || 'No phone number available'}
            </p>
            <p className="text-xs text-gray-600">
              Amount: KSh {employee.net_pay?.toLocaleString()}
            </p>
          </div>
        </div>

        <div className="flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium text-gray-700 bg-gray-200 rounded-md hover:bg-gray-300"
            disabled={isProcessing}
          >
            Cancel
          </button>
          <button
            onClick={handlePayment}
            className="px-4 py-2 text-xs font-medium text-white bg-green-600 rounded-md hover:bg-green-700 flex items-center gap-2"
            disabled={isProcessing}
          >
            {isProcessing ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-t-2 border-b-2 border-white"></div>
                Processing...
              </>
            ) : (
              <>
                <Send size={16} />
                Confirm Payment
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

// M-PESA Bulk Payment Modal (similar to your implementation)
const MpesaBulkPaymentModal = ({
  isOpen,
  onClose,
  employees,
  onConfirm
}) => {
  const [isProcessing, setIsProcessing] = useState(false);
  const [selectedStaff, setSelectedStaff] = useState({});
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    // Initialize all employees as selected
    const initialSelected = {};
    employees.forEach(emp => {
      initialSelected[emp.employee_id] = true;
    });
    setSelectedStaff(initialSelected);
  }, [employees]);

  // Filter employees based on search
  const filteredEmployees = employees.filter(emp =>
    emp.employee_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    emp.employee_id.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Calculate total amount for selected employees
  const calculateTotalAmount = () => {
    return employees.reduce((total, emp) => {
      if (selectedStaff[emp.employee_id]) {
        return total + (emp.net_pay || 0);
      }
      return total;
    }, 0);
  };

  // Get count of selected staff
  const getSelectedStaffCount = () => {
    return Object.values(selectedStaff).filter(selected => selected).length;
  };

  // Toggle selection for a staff member
  const toggleStaffSelection = (id) => {
    setSelectedStaff(prev => ({
      ...prev,
      [id]: !prev[id]
    }));
  };

  // Select all staff
  const selectAllStaff = () => {
    const newSelection = {};
    employees.forEach(emp => {
      newSelection[emp.employee_id] = true;
    });
    setSelectedStaff(newSelection);
  };

  // Deselect all staff
  const deselectAllStaff = () => {
    setSelectedStaff({});
  };

  const handleBulkPayment = async () => {
    setIsProcessing(true);
    try {
      const selectedEmployees = employees.filter(emp => selectedStaff[emp.employee_id]);
      await onConfirm(selectedEmployees);
      onClose();
    } catch (error) {
      console.error('Bulk payment error:', error);
    } finally {
      setIsProcessing(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg max-w-2xl w-full p-6 max-h-[90vh] overflow-y-auto">
        <h3 className="text-lg font-medium text-gray-900 mb-4 flex items-center gap-2">
          <Users className="h-5 w-5 text-green-600" />
          Confirm M-PESA Bulk Payment
        </h3>

        <div className="mb-4 p-3 bg-gray-50 rounded-md">
          <p className="text-xs text-gray-600">
            You are about to process M-PESA B2C payments for {getSelectedStaffCount()} selected staff members.
          </p>

          <div className="mt-3 flex gap-2">
            <button
              onClick={selectAllStaff}
              className="text-xs bg-gray-200 hover:bg-gray-300 px-2 py-1 rounded"
            >
              Select All
            </button>
            <button
              onClick={deselectAllStaff}
              className="text-xs bg-gray-200 hover:bg-gray-300 px-2 py-1 rounded"
            >
              Deselect All
            </button>
          </div>

          <div className="mt-3 border-t pt-3">
            <div className="flex justify-between text-xs">
              <span className="font-medium">Total Amount:</span>
              <span className="font-bold text-green-700">
                KSh {calculateTotalAmount().toLocaleString()}
              </span>
            </div>
          </div>
        </div>

        {/* Search input */}
        <div className="mb-4 relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search employees..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10 pr-4 py-2 border border-gray-300 rounded-md text-xs w-full focus:outline-none focus:ring-1 focus:ring-green-500 focus:border-green-500"
          />
        </div>

        <div className="mb-4 max-h-60 overflow-y-auto">
          <p className="text-xs font-medium mb-2">Staff to be paid:</p>
          <ul className="text-xs divide-y divide-gray-200">
            {filteredEmployees.map(emp => (
              <li key={emp.employee_id} className="py-2 flex items-center justify-between">
                <div className="flex items-center">
                  <button
                    onClick={() => toggleStaffSelection(emp.employee_id)}
                    className="mr-2 text-green-600 hover:text-green-800"
                  >
                    {selectedStaff[emp.employee_id] ? (
                      <CheckSquare className="h-5 w-5" />
                    ) : (
                      <Square className="h-5 w-5" />
                    )}
                  </button>
                  <div>
                    <div className={selectedStaff[emp.employee_id] ? "font-medium" : "text-gray-500"}>
                      {emp.employee_name}
                    </div>
                    <div className="text-xs text-gray-500">
                      {emp.phoneNumber || 'No phone number'} • {emp.employee_id}
                    </div>
                  </div>
                </div>
                <span className={selectedStaff[emp.employee_id] ? "font-medium" : "text-gray-500"}>
                  KSh {emp.net_pay?.toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium text-gray-700 bg-gray-200 rounded-md hover:bg-gray-300"
            disabled={isProcessing}
          >
            Cancel
          </button>
          <button
            onClick={handleBulkPayment}
            className="px-4 py-2 text-xs font-medium text-white bg-green-600 rounded-md hover:bg-green-700 flex items-center gap-2"
            disabled={isProcessing || getSelectedStaffCount() === 0}
          >
            {isProcessing ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-t-2 border-b-2 border-white"></div>
                Processing M-Pesa...
              </>
            ) : (
              <>
                <Send size={16} />
                Confirm M-Pesa Payment ({getSelectedStaffCount()})
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

// Main M-PESA Payment Component
const MpesaPaymentComponent = ({ payrollRecords }) => {
  const [showSingleModal, setShowSingleModal] = useState(false);
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState(null);
  const [employeePhoneNumbers, setEmployeePhoneNumbers] = useState({});

  // Fetch employee phone numbers
  useEffect(() => {
    const fetchPhoneNumbers = async () => {
      try {
        const employeeNumbers = payrollRecords.map(record => record.employee_id).filter(Boolean);

        if (employeeNumbers.length === 0) return;

        const { data, error } = await supabase
          .from('employees')
          .select('"Employee Number", "Mobile Number"')
          .in('"Employee Number"', employeeNumbers);

        if (error) throw error;

        const phoneMap = {};
        data?.forEach(emp => {
          phoneMap[emp["Employee Number"]] = emp["Mobile Number"];
        });

        setEmployeePhoneNumbers(phoneMap);
      } catch (error) {
        console.error('Error fetching phone numbers:', error);
        toast.error('Failed to load phone numbers');
      }
    };

    if (payrollRecords.length > 0) {
      fetchPhoneNumbers();
    }
  }, [payrollRecords]);

  // Process single M-PESA payment
  const processSingleMpesaPayment = async (employee) => {
    try {
      const phoneNumber = employeePhoneNumbers[employee.employee_id];
      if (!phoneNumber) {
        throw new Error(`Phone number not found for employee ${employee.employee_id}`);
      }

      const formattedPhone = formatPhoneNumber(phoneNumber);
      const API_URL = import.meta.env.VITE_API_URL || (import.meta.env.MODE === 'production' ? '/api' : "http://localhost:3001/api");

      // Call backend API to initiate M-Pesa B2C payment
      const response = await fetch(`${API_URL}/mpesa/b2c`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          phoneNumber: formattedPhone,
          amount: employee.net_pay,
          employeeNumber: employee.employee_id,
          fullName: employee.employee_name
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to process payment');
      }

      const result = await response.json();
      toast.success(`Payment sent to ${employee.employee_name}`);
      return result;
    } catch (error) {
      console.error('M-Pesa payment error:', error);
      toast.error(`Failed to pay ${employee.employee_name}`);
      throw error;
    }
  };

  // Process bulk M-PESA payments
  const processBulkMpesaPayment = async (selectedEmployees) => {
    const results = [];

    for (const employee of selectedEmployees) {
      try {
        const result = await processSingleMpesaPayment(employee);
        results.push({ success: true, employee, result });

        // Add a small delay between payments to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (error) {
        results.push({ success: false, employee, error });
      }
    }

    toast.success(`Payments processed for ${results.filter(r => r.success).length} of ${selectedEmployees.length} employees`);
    return results;
  };

  // Handle single payment button click
  const handleSinglePaymentClick = (employee) => {
    setSelectedEmployee({
      ...employee,
      phoneNumber: employeePhoneNumbers[employee.employee_id]
    });
    setShowSingleModal(true);
  };

  return (
    <div className="flex flex-col gap-4 p-4">
      {/* Single Payment Buttons for each employee */}
      <div className="grid grid-cols-1 gap-2">
        {payrollRecords.map(employee => (
          <div key={employee.employee_id} className="flex items-center justify-between p-3 bg-white rounded-lg border border-gray-200">
            <div>
              <p className="font-medium">{employee.employee_name}</p>
              <p className="text-xs text-gray-600">{employee.employee_id}</p>
              <p className="text-xs text-gray-600">
                KSh {employee.net_pay?.toLocaleString()}
              </p>
            </div>
            <button
              onClick={() => handleSinglePaymentClick(employee)}
              className="flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-md text-xs font-medium"
            >
              <Smartphone size={16} />
              M-PESA (Single)
            </button>
          </div>
        ))}
      </div>

      {/* Bulk Payment Button */}
      {payrollRecords.length > 0 && (
        <div className="mt-4">
          <button
            onClick={() => setShowBulkModal(true)}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-md text-xs font-medium w-full justify-center"
          >
            <Users size={16} />
            M-PESA Bulk Pay ({payrollRecords.length} employees)
          </button>
        </div>
      )}

      {/* Single Payment Modal */}
      {selectedEmployee && (
        <MpesaSinglePaymentModal
          isOpen={showSingleModal}
          onClose={() => setShowSingleModal(false)}
          employee={selectedEmployee}
          onConfirm={() => processSingleMpesaPayment(selectedEmployee)}
        />
      )}

      {/* Bulk Payment Modal */}
      <MpesaBulkPaymentModal
        isOpen={showBulkModal}
        onClose={() => setShowBulkModal(false)}
        employees={payrollRecords.map(emp => ({
          ...emp,
          phoneNumber: employeePhoneNumbers[emp.employee_id]
        }))}
        onConfirm={processBulkMpesaPayment}
      />
    </div>
  );
};

export default MpesaPaymentComponent;