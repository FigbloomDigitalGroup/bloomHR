import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import toast from 'react-hot-toast';
import { CheckCircle2, XCircle, Clock, Search, ChevronDown } from 'lucide-react';

const LoanRequestsAdmin = () => {
  const [loans, setLoans] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editedLoanAmount, setEditedLoanAmount] = useState('');
  const [editedInstallment, setEditedInstallment] = useState('');
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [showNotesDropdown, setShowNotesDropdown] = useState<string | null>(null);

  useEffect(() => {
    fetchLoans();
  }, []);

  const fetchLoans = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('loan_requests')
        .select('*')
        .order('time_added', { ascending: false });

      if (error) throw error;
      setLoans(data || []);

      // Initialize notes state
      const initialNotes: Record<string, string> = {};
      data?.forEach(loan => {
        initialNotes[loan.id] = loan.admin_notes || '';
      });
      setNotes(initialNotes);
    } catch (error) {
      console.error('Error fetching loan requests:', error);
      toast.error('Failed to load loan requests');
    } finally {
      setIsLoading(false);
    }
  };

  // Format amount as Kenyan Shillings
  const formatKES = (amount: number) => {
    return new Intl.NumberFormat('en-KE', {
      style: 'currency',
      currency: 'KES',
      minimumFractionDigits: 2
    }).format(amount);
  };

  const formatDate = (dateValue: any) => {
    if (!dateValue) return 'N/A';
    let d = new Date(dateValue);
    if (isNaN(d.getTime()) || d.getFullYear() < 2000) {
      return new Date().toLocaleDateString('en-KE');
    }
    return d.toLocaleDateString('en-KE');
  };

  const handleLoanAmountEdit = (id: string, currentAmount: number) => {
    setEditingId(id);
    setEditedLoanAmount(currentAmount.toString());
  };

  const handleInstallmentEdit = (id: string, currentInstallment: string) => {
    setEditingId(id);
    setEditedInstallment(currentInstallment);
  };

  const handleLoanAmountSave = async (id: string) => {
    if (!editedLoanAmount || isNaN(Number(editedLoanAmount))) {
      toast.error('Please enter a valid amount');
      return;
    }

    try {
      const { error } = await supabase
        .from('loan_requests')
        .update({ "Loan Amount": Number(editedLoanAmount) })
        .eq('id', id);

      if (error) throw error;

      toast.success('Loan amount updated!');
      setEditingId(null);
      fetchLoans();
    } catch (error) {
      console.error('Error updating loan amount:', error);
      toast.error('Failed to update loan amount');
    }
  };

  const handleInstallmentSave = async (id: string) => {
    if (!editedInstallment) {
      toast.error('Please enter a valid installment');
      return;
    }

    try {
      const { error } = await supabase
        .from('loan_requests')
        .update({ "Repayment Installment": editedInstallment })
        .eq('id', id);

      if (error) throw error;

      toast.success('Installment updated!');
      setEditingId(null);
      fetchLoans();
    } catch (error) {
      console.error('Error updating installment:', error);
      toast.error('Failed to update installment');
    }
  };

  const handleApprove = async (id: string) => {
    try {
      const { error } = await supabase
        .from('loan_requests')
        .update({
          status: 'Approved',
          admin_notes: notes[id] || null
        })
        .eq('id', id);

      if (error) throw error;
      toast.success('Loan approved!');
      fetchLoans();
    } catch (error) {
      console.error('Error approving loan:', error);
      toast.error('Failed to approve loan');
    }
  };

  const handleReject = async (id: string) => {
    try {
      const { error } = await supabase
        .from('loan_requests')
        .update({
          status: 'Rejected',
          admin_notes: notes[id] || null
        })
        .eq('id', id);

      if (error) throw error;
      toast.success('Loan rejected!');
      fetchLoans();
    } catch (error) {
      console.error('Error rejecting loan:', error);
      toast.error('Failed to reject loan');
    }
  };

  const handleNoteChange = (id: string, value: string) => {
    setNotes(prev => ({
      ...prev,
      [id]: value
    }));
  };

  const saveNotes = async (id: string) => {
    try {
      const { error } = await supabase
        .from('loan_requests')
        .update({ admin_notes: notes[id] || null })
        .eq('id', id);

      if (error) throw error;
      toast.success('Notes saved!');
      setShowNotesDropdown(null);
    } catch (error) {
      console.error('Error saving notes:', error);
      toast.error('Failed to save notes');
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status?.toLowerCase()) {
      case 'approved':
        return <CheckCircle2 className="h-4 w-4 text-green-500" />;
      case 'rejected':
        return <XCircle className="h-4 w-4 text-red-500" />;
      default:
        return <Clock className="h-4 w-4 text-yellow-500" />;
    }
  };

  const filteredLoans = loans.filter(loan => {
    const matchesSearch =
      loan["Employee Number"]?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      loan["Full Name"]?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      loan["Office Branch"]?.toLowerCase().includes(searchTerm.toLowerCase());

    return matchesSearch;
  });

  return (
    <div className="p-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
        <h2 className="text-lg font-medium text-gray-900">Loan Requests</h2>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search loan requests..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10 pr-4 py-2 border border-gray-300 rounded-md text-xs focus:outline-none focus:ring-1 focus:ring-green-500 focus:border-green-500"
          />
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-green-600"></div>
        </div>
      ) : filteredLoans.length === 0 ? (
        <div className="text-center py-8 text-gray-500">
          No loan requests found.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Employee
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Branch
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Basic Salary
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Loan Amount
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Installment
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Payment Dates
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Reason
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Notes
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Date
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {filteredLoans.map((loan) => (
                <tr key={loan.id}>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-xs font-medium text-gray-900">{loan["Full Name"]}</div>
                    <div className="text-xs text-gray-500">{loan["Employee Number"]}</div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-xs text-gray-500">
                    {loan["Office Branch"]}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-xs font-medium text-gray-900">
                    {formatKES(Number(loan["Basic Salary"]))}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {editingId === loan.id ? (
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={editedLoanAmount}
                          onChange={(e) => setEditedLoanAmount(e.target.value)}
                          className="w-24 p-1 border rounded text-xs"
                        />
                        <button
                          onClick={() => handleLoanAmountSave(loan.id)}
                          className="text-xs bg-green-500 text-white px-2 py-1 rounded hover:bg-green-600"
                        >
                          Save
                        </button>
                        <button
                          onClick={() => setEditingId(null)}
                          className="text-xs bg-gray-500 text-white px-2 py-1 rounded hover:bg-gray-600"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <div
                        className="text-xs font-medium text-gray-900 cursor-pointer hover:underline"
                        onClick={() => handleLoanAmountEdit(loan.id, loan["Loan Amount"])}
                      >
                        {formatKES(Number(loan["Loan Amount"]))}
                      </div>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {editingId === loan.id ? (
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={editedInstallment}
                          onChange={(e) => setEditedInstallment(e.target.value)}
                          className="w-24 p-1 border rounded text-xs"
                          placeholder="Monthly amount"
                        />
                        <button
                          onClick={() => handleInstallmentSave(loan.id)}
                          className="text-xs bg-green-500 text-white px-2 py-1 rounded hover:bg-green-600"
                        >
                          Save
                        </button>
                      </div>
                    ) : (
                      <div
                        className="text-xs text-gray-500 cursor-pointer hover:underline"
                        onClick={() => handleInstallmentEdit(loan.id, loan["Repayment Installment"])}
                      >
                        {loan["Repayment Installment"] || 'N/A'}
                      </div>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-xs text-gray-500">
                    <div>1st: {formatDate(loan["First Payment Date"])}</div>
                    <div>2nd: {formatDate(loan["Second Payment Date"])}</div>
                  </td>
                  <td className="px-6 py-4 text-xs text-gray-500 max-w-xs truncate">
                    {loan["Reason for Loan"]}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center">
                      {getStatusIcon(loan["status"])}
                      <span className="ml-2 text-xs text-gray-500 capitalize">
                        {loan["status"] || 'Pending'}
                      </span>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap relative">
                    <div className="flex items-center">
                      <button
                        onClick={() => setShowNotesDropdown(showNotesDropdown === loan.id ? null : loan.id)}
                        className="flex items-center text-xs text-gray-500 hover:text-gray-700"
                      >
                        Notes <ChevronDown className="h-4 w-4 ml-1" />
                      </button>
                    </div>
                    {showNotesDropdown === loan.id && (
                      <div className="absolute z-10 mt-2 w-64 bg-white shadow-lg rounded-md p-2 border border-gray-200">
                        <textarea
                          value={notes[loan.id] || ''}
                          onChange={(e) => handleNoteChange(loan.id, e.target.value)}
                          placeholder="Add admin notes..."
                          className="w-full p-2 border rounded text-xs mb-2"
                          rows={3}
                        />
                        <div className="flex justify-end space-x-2">
                          <button
                            onClick={() => setShowNotesDropdown(null)}
                            className="text-xs bg-gray-500 text-white px-2 py-1 rounded hover:bg-gray-600"
                          >
                            Cancel
                          </button>
                          <button
                            onClick={() => saveNotes(loan.id)}
                            className="text-xs bg-green-500 text-white px-2 py-1 rounded hover:bg-green-600"
                          >
                            Save
                          </button>
                        </div>
                      </div>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-xs text-gray-500">
                    {new Date(loan.time_added).toLocaleDateString()}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-xs font-medium">
                    {(!loan["status"] || loan["status"].toLowerCase() === 'pending') && (
                      <div className="flex space-x-2">
                        <button
                          onClick={() => handleApprove(loan.id)}
                          className="text-green-600 hover:text-green-900"
                        >
                          Approve
                        </button>
                        <button
                          onClick={() => handleReject(loan.id)}
                          className="text-red-600 hover:text-red-900"
                        >
                          Reject
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default LoanRequestsAdmin;