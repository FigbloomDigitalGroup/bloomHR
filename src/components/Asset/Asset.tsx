import { useState, useEffect, useRef } from 'react';
import EmployeePicker from '../UI/EmployeePicker';
import { PageHeader, Card, Button, StatusPill, EmptyState, SearchInput } from '../UI';
import type { StatusTone } from '../UI';
import { 
  Plus, Eye, Edit, Trash2, Download, 
  PrinterIcon, ChevronLeft, ChevronRight, X, Settings,
  HardDrive, Smartphone, Monitor, Camera, Car, Wrench, 
  Server, Headphones, Cpu, CheckCircle, AlertCircle,
  Archive, MoreVertical, QrCode, MapPin, User,
  Tag, Building, Briefcase, CircleOff, ChevronDown
} from 'lucide-react';
import { motion } from 'framer-motion';
import { supabase } from '../../lib/supabase';
import { Database } from '../../types/supabase';
import GlowButton from '../UI/GlowButton';
import { useNavigate } from 'react-router-dom';
import { utils, writeFile } from 'xlsx';
import RoleButtonWrapper from '../ProtectedRoutes/RoleButton';

type Asset = Database['public']['Tables']['assets']['Row'];
type Employee = Database['public']['Tables']['employees']['Row'];

interface AssetCategory {
  id: string;
  name: string;
  icon: React.ReactNode;
  color: string;
  count: number;
}

const AssetManagement: React.FC = () => {
  const navigate = useNavigate();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // State for filters
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [selectedStatus, setSelectedStatus] = useState('all');
  const [selectedLocation, setSelectedLocation] = useState('all');
  const [selectedDepartment, setSelectedDepartment] = useState('all');
  
  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const assetsPerPage = 8;

  // Modal state
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null);
  const [isViewModalOpen, setIsViewModalOpen] = useState(false);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isBulkActionsOpen, setIsBulkActionsOpen] = useState(false);
  const [newAsset, setNewAsset] = useState<Partial<Asset>>({});
  const bulkActionsRef = useRef<HTMLDivElement>(null);
  const addModalRef = useRef<HTMLDivElement>(null);

  // Stats state
  const [stats, setStats] = useState({
    total: 0,
    active: 0,
    maintenance: 0,
    retired: 0,
    lost: 0,
    totalValue: 0
  });

  // Get unique values for filters from live data
  const [categories, setCategories] = useState<string[]>(['all']);
  const [statuses, setStatuses] = useState<string[]>(['all']);
  const [locations, setLocations] = useState<string[]>(['all']);
  const [departments, setDepartments] = useState<string[]>(['all']);
  const [assetCategories, setAssetCategories] = useState<AssetCategory[]>([]);

  // Fetch all data from Supabase
  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        
        // Fetch assets
        const { data: assetsData, error: assetsError } = await supabase
          .from('assets')
          .select('*')
          .order('purchase_date', { ascending: false });

        if (assetsError) throw assetsError;
        setAssets(assetsData || []);

        // Fetch employees for dropdowns
        const { data: employeesData, error: employeesError } = await supabase
          .from('employees')
          .select('*');

        if (employeesError) throw employeesError;
        setEmployees(employeesData || []);

        // Calculate stats and unique values
        if (assetsData) {
          const total = assetsData.length;
          const active = assetsData.filter(a => a.status === 'active').length;
          const maintenance = assetsData.filter(a => a.status === 'maintenance').length;
          const retired = assetsData.filter(a => a.status === 'retired').length;
          const lost = assetsData.filter(a => a.status === 'lost').length;
          const totalValue = assetsData.reduce((sum, asset) => sum + (asset.purchase_value || 0), 0);

          setStats({ total, active, maintenance, retired, lost, totalValue });

          // Get unique values for filters
          const uniqueCategories = ['all', ...new Set(assetsData.map(a => a.category).filter(Boolean) as string[])];
          const uniqueStatuses = ['all', ...new Set(assetsData.map(a => a.status).filter(Boolean) as string[])];
          const uniqueLocations = ['all', ...new Set(assetsData.map(a => a.location).filter(Boolean) as string[])];
          const uniqueDepartments = ['all', ...new Set(assetsData.map(a => a.department).filter(Boolean) as string[])];

          setCategories(uniqueCategories);
          setStatuses(uniqueStatuses);
          setLocations(uniqueLocations);
          setDepartments(uniqueDepartments);

          // Create asset categories with counts
          const categoryCounts: { [key: string]: number } = {};
          assetsData.forEach(asset => {
            if (asset.category) {
              categoryCounts[asset.category] = (categoryCounts[asset.category] || 0) + 1;
            }
          });

          const allCategories: AssetCategory[] = [
            { id: 'vehicle', name: 'Vehicles', icon: <Car className="w-3 h-3" />, color: 'bg-blue-500', count: categoryCounts['vehicle'] || 0 },
            { id: 'computer', name: 'Computers', icon: <Monitor className="w-3 h-3" />, color: 'bg-purple-500', count: categoryCounts['computer'] || 0 },
            { id: 'phone', name: 'Mobile Phones', icon: <Smartphone className="w-3 h-3" />, color: 'bg-green-500', count: categoryCounts['phone'] || 0 },
            { id: 'camera', name: 'Cameras', icon: <Camera className="w-3 h-3" />, color: 'bg-yellow-500', count: categoryCounts['camera'] || 0 },
            { id: 'server', name: 'Servers', icon: <Server className="w-3 h-3" />, color: 'bg-red-500', count: categoryCounts['server'] || 0 },
            { id: 'network', name: 'Network', icon: <Cpu className="w-3 h-3" />, color: 'bg-indigo-500', count: categoryCounts['network'] || 0 },
            { id: 'accessory', name: 'Accessories', icon: <Headphones className="w-3 h-3" />, color: 'bg-pink-500', count: categoryCounts['accessory'] || 0 },
            { id: 'tool', name: 'Tools', icon: <Wrench className="w-3 h-3" />, color: 'bg-orange-500', count: categoryCounts['tool'] || 0 },
            { id: 'other', name: 'Other', icon: <HardDrive className="w-3 h-3" />, color: 'bg-gray-500', count: categoryCounts['other'] || categoryCounts[''] || 0 }
          ];

          setAssetCategories(allCategories);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch data');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (bulkActionsRef.current && !bulkActionsRef.current.contains(event.target as Node)) {
        setIsBulkActionsOpen(false);
      }
      if (addModalRef.current && !addModalRef.current.contains(event.target as Node)) {
        setIsAddModalOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  // Filter assets
  const filteredAssets = assets.filter(asset => {
    const matchesSearch = asset.asset_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         asset.asset_tag?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         asset.serial_number?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         asset.model?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = selectedCategory === 'all' || asset.category === selectedCategory;
    const matchesStatus = selectedStatus === 'all' || asset.status === selectedStatus;
    const matchesLocation = selectedLocation === 'all' || asset.location === selectedLocation;
    const matchesDepartment = selectedDepartment === 'all' || asset.department === selectedDepartment;
    
    return matchesSearch && matchesCategory && matchesStatus && matchesLocation && matchesDepartment;
  });

  // Pagination logic
  const indexOfLastAsset = currentPage * assetsPerPage;
  const indexOfFirstAsset = indexOfLastAsset - assetsPerPage;
  const currentAssets = filteredAssets.slice(indexOfFirstAsset, indexOfLastAsset);
  const totalPages = Math.ceil(filteredAssets.length / assetsPerPage);

  // Helper functions
  const getCategoryIcon = (categoryId: string) => {
    const category = assetCategories.find(c => c.id === categoryId);
    return category?.icon || <HardDrive className="w-3 h-3" />;
  };

  const getCategoryColor = (categoryId: string) => {
    const category = assetCategories.find(c => c.id === categoryId);
    return category?.color || 'bg-gray-500';
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active': return 'bg-green-500/20 text-green-800 border-green-500/30';
      case 'maintenance': return 'bg-yellow-500/20 text-yellow-800 border-yellow-500/30';
      case 'retired': return 'bg-gray-500/20 text-gray-800 border-gray-500/30';
      case 'lost': return 'bg-red-500/20 text-red-800 border-red-500/30';
      default: return 'bg-blue-500/20 text-blue-800 border-blue-500/30';
    }
  };

  // Handle functions
  const handleAddAsset = async () => {
    try {
      const { error } = await supabase
        .from('assets')
        .insert([{
          ...newAsset,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }]);
      
      if (error) throw error;
      
      // Refresh asset list
      const { data: updatedData } = await supabase
        .from('assets')
        .select('*')
        .order('purchase_date', { ascending: false });
      
      setAssets(updatedData || []);
      setIsAddModalOpen(false);
      setNewAsset({});
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add asset');
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setNewAsset(prev => ({
      ...prev,
      [name]: value
    }));
  };

  // Export function
  const handleExport = () => {
    const exportData = filteredAssets.map(asset => ({
      'Asset Tag': asset.asset_tag,
      'Asset Name': asset.asset_name,
      'Category': asset.category,
      'Serial Number': asset.serial_number,
      'Model': asset.model,
      'Brand': asset.brand,
      'Status': asset.status,
      'Condition': asset.condition,
      'Location': asset.location,
      'Department': asset.department,
      'Assigned To': asset.assigned_to,
      'Purchase Value': asset.purchase_value,
      'Purchase Date': asset.purchase_date,
      'Warranty Expiry': asset.warranty_expiry
    }));

    const ws = utils.json_to_sheet(exportData);
    const wb = utils.book_new();
    utils.book_append_sheet(wb, ws, "Assets");
    writeFile(wb, "assets.xlsx");
  };

  const handleBulkAction = async (action: string) => {
    setIsBulkActionsOpen(false);
    
    switch(action) {
      case 'export':
        handleExport();
        break;
      case 'print':
        window.print();
        break;
      case 'bulk_assign':
        // Implement bulk assignment
        console.log('Bulk assign assets...');
        break;
      case 'bulk_update':
        // Implement bulk update
        console.log('Bulk update assets...');
        break;
      default:
        break;
    }
  };

  const handleDeleteAsset = async (assetId: string) => {
    if (window.confirm('Are you sure you want to delete this asset?')) {
      try {
        const { error } = await supabase
          .from('assets')
          .delete()
          .eq('id', assetId);
        
        if (error) throw error;
        
        // Refresh asset list
        const { data } = await supabase
          .from('assets')
          .select('*')
          .order('purchase_date', { ascending: false });
        
        setAssets(data || []);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to delete asset');
      }
    }
  };

  // Loading state
  if (loading) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="p-6 max-w-7xl mx-auto flex justify-center items-center min-h-[60vh] text-xs"
      >
        <div className="text-center">
          <div className="animate-pulse flex flex-col items-center">
            <div className="w-16 h-16 bg-gradient-to-r from-blue-50 to-blue-200 rounded-full mb-6"></div>
            <div className="h-5 bg-gradient-to-r from-gray-100 to-gray-200 rounded-full w-64 mb-4"></div>
            <div className="h-4 bg-gradient-to-r from-gray-100 to-gray-200 rounded-full w-48"></div>
          </div>
        </div>
      </motion.div>
    );
  }
  
  if (error) return <div className="p-6 text-center text-red-500 text-xs">Error: {error}</div>;

  const assetStatusTone = (status: string): StatusTone => {
    switch (status) {
      case 'active': return 'success';
      case 'maintenance': return 'warning';
      case 'retired': return 'neutral';
      case 'lost': return 'danger';
      default: return 'info';
    }
  };

  const assetConditionTone = (condition: string): StatusTone => {
    switch (condition) {
      case 'excellent': return 'success';
      case 'good': return 'info';
      case 'fair':
      case 'poor': return 'warning';
      case 'damaged': return 'danger';
      default: return 'neutral';
    }
  };

  return (
    <div className="p-6 space-y-6 text-xs">
      {/* Add Asset Modal */}
      {isAddModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <motion.div 
            ref={addModalRef}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={{ duration: 0.2 }}
            className="bg-white rounded-lg w-full max-w-3xl max-h-[90vh] overflow-y-auto text-xs"
          >
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-bold text-gray-900">Add New Asset</h2>
                <button 
                  onClick={() => setIsAddModalOpen(false)}
                  className="text-gray-500 hover:text-gray-700 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
                {/* Form fields with live data */}
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Asset Name *</label>
                  <input
                    type="text"
                    name="asset_name"
                    value={newAsset.asset_name || ''}
                    onChange={handleInputChange}
                    className="w-full h-[38px] bg-gray-50 border border-gray-300 rounded-lg px-3 py-1.5 text-xs text-gray-900 placeholder-gray-500 focus:outline-none focus:border-green-500 focus:shadow-[0_0_10px_rgba(34,197,94,0.3)] transition-all duration-200"
                    placeholder="Dell Latitude 5420"
                    required
                  />
                </div>
                
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Asset Tag</label>
                  <input
                    type="text"
                    name="asset_tag"
                    value={newAsset.asset_tag || ''}
                    onChange={handleInputChange}
                    className="w-full h-[38px] bg-gray-50 border border-gray-300 rounded-lg px-3 py-1.5 text-xs text-gray-900 placeholder-gray-500 focus:outline-none focus:border-green-500 focus:shadow-[0_0_10px_rgba(34,197,94,0.3)] transition-all duration-200"
                    placeholder="ASSET-001"
                  />
                </div>
                
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Category *</label>
                  <select
                    name="category"
                    value={newAsset.category || ''}
                    onChange={handleInputChange}
                    className="w-full h-[38px] bg-gray-50 border border-gray-300 rounded-lg px-3 py-1.5 text-xs text-gray-900 focus:outline-none focus:border-green-500 focus:shadow-[0_0_10px_rgba(34,197,94,0.3)] transition-all duration-200"
                    required
                  >
                    <option value="">Select Category</option>
                    {assetCategories.map(cat => (
                      <option key={cat.id} value={cat.id}>{cat.name} ({cat.count})</option>
                    ))}
                  </select>
                </div>
                
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Serial Number</label>
                  <input
                    type="text"
                    name="serial_number"
                    value={newAsset.serial_number || ''}
                    onChange={handleInputChange}
                    className="w-full h-[38px] bg-gray-50 border border-gray-300 rounded-lg px-3 py-1.5 text-xs text-gray-900 placeholder-gray-500 focus:outline-none focus:border-green-500 focus:shadow-[0_0_10px_rgba(34,197,94,0.3)] transition-all duration-200"
                    placeholder="SN123456789"
                  />
                </div>
                
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Department</label>
                  <select
                    name="department"
                    value={newAsset.department || ''}
                    onChange={handleInputChange}
                    className="w-full h-[38px] bg-gray-50 border border-gray-300 rounded-lg px-3 py-1.5 text-xs text-gray-900 focus:outline-none focus:border-green-500 focus:shadow-[0_0_10px_rgba(34,197,94,0.3)] transition-all duration-200"
                  >
                    <option value="">Select Department</option>
                    {departments.filter(d => d !== 'all').map(dept => (
                      <option key={dept} value={dept}>{dept}</option>
                    ))}
                    {/* Fallback to employee departments if no asset departments */}
                    {departments.length <= 1 && employees.length > 0 && (
                      <>
                        {Array.from(new Set(employees.map(e => e['Employee Type']).filter(Boolean) as string[])).map(dept => (
                          <option key={dept} value={dept}>{dept}</option>
                        ))}
                      </>
                    )}
                  </select>
                </div>
                
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Location</label>
                  <select
                    name="location"
                    value={newAsset.location || ''}
                    onChange={handleInputChange}
                    className="w-full h-[38px] bg-gray-50 border border-gray-300 rounded-lg px-3 py-1.5 text-xs text-gray-900 focus:outline-none focus:border-green-500 focus:shadow-[0_0_10px_rgba(34,197,94,0.3)] transition-all duration-200"
                  >
                    <option value="">Select Location</option>
                    {locations.filter(l => l !== 'all').map(location => (
                      <option key={location} value={location}>{location}</option>
                    ))}
                    {/* Fallback to employee towns if no asset locations */}
                    {locations.length <= 1 && employees.length > 0 && (
                      <>
                        {Array.from(new Set(employees.map(e => e.Town).filter(Boolean) as string[])).map(town => (
                          <option key={town} value={town}>{town}</option>
                        ))}
                      </>
                    )}
                  </select>
                </div>
                
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Status</label>
                  <select
                    name="status"
                    value={newAsset.status || ''}
                    onChange={handleInputChange}
                    className="w-full h-[38px] bg-gray-50 border border-gray-300 rounded-lg px-3 py-1.5 text-xs text-gray-900 focus:outline-none focus:border-green-500 focus:shadow-[0_0_10px_rgba(34,197,94,0.3)] transition-all duration-200"
                  >
                    <option value="active">Active</option>
                    <option value="maintenance">Under Maintenance</option>
                    <option value="retired">Retired</option>
                    <option value="lost">Lost</option>
                  </select>
                </div>
                
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Condition</label>
                  <select
                    name="condition"
                    value={newAsset.condition || ''}
                    onChange={handleInputChange}
                    className="w-full h-[38px] bg-gray-50 border border-gray-300 rounded-lg px-3 py-1.5 text-xs text-gray-900 focus:outline-none focus:border-green-500 focus:shadow-[0_0_10px_rgba(34,197,94,0.3)] transition-all duration-200"
                  >
                    <option value="excellent">Excellent</option>
                    <option value="good">Good</option>
                    <option value="fair">Fair</option>
                    <option value="poor">Poor</option>
                    <option value="damaged">Damaged</option>
                  </select>
                </div>
                
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Assigned To</label>
                  <EmployeePicker
                    // assigned_to is stored as "First Last (EmpNo)"; the picker wants just the number
                    value={newAsset.assigned_to?.match(/\(([^()]+)\)\s*$/)?.[1] ?? ''}
                    fallbackLabel={newAsset.assigned_to || undefined}
                    placeholder="Select Employee"
                    onChange={emp =>
                      setNewAsset((prev: Partial<Asset>) => ({
                        ...prev,
                        assigned_to: emp ? `${emp.firstName} ${emp.lastName} (${emp.employeeNumber})` : '',
                      }))
                    }
                  />
                </div>
                
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Purchase Value (KES)</label>
                  <input
                    type="number"
                    name="purchase_value"
                    value={newAsset.purchase_value || ''}
                    onChange={handleInputChange}
                    className="w-full h-[38px] bg-gray-50 border border-gray-300 rounded-lg px-3 py-1.5 text-xs text-gray-900 placeholder-gray-500 focus:outline-none focus:border-green-500 focus:shadow-[0_0_10px_rgba(34,197,94,0.3)] transition-all duration-200"
                    placeholder="150000"
                  />
                </div>
                
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Purchase Date</label>
                  <input
                    type="date"
                    name="purchase_date"
                    value={newAsset.purchase_date || ''}
                    onChange={handleInputChange}
                    className="w-full h-[38px] bg-gray-50 border border-gray-300 rounded-lg px-3 py-1.5 text-xs text-gray-900 focus:outline-none focus:border-green-500 focus:shadow-[0_0_10px_rgba(34,197,94,0.3)] transition-all duration-200"
                  />
                </div>
                
                <div className="md:col-span-2">
                  <label className="block text-xs font-medium text-gray-700 mb-1">Notes</label>
                  <textarea
                    name="notes"
                    value={newAsset.notes || ''}
                    onChange={handleInputChange}
                    rows={2}
                    className="w-full bg-gray-50 border border-gray-300 rounded-lg px-3 py-1.5 text-xs text-gray-900 placeholder-gray-500 focus:outline-none focus:border-green-500 focus:shadow-[0_0_10px_rgba(34,197,94,0.3)] transition-all duration-200 resize-none"
                    placeholder="Additional information..."
                  />
                </div>
              </div>
              
              <div className="flex justify-end space-x-2 pt-2 border-t border-gray-200">
                <GlowButton 
                  variant="secondary" 
                  onClick={() => setIsAddModalOpen(false)}
                  size="sm"
                >
                  Cancel
                </GlowButton>
                <GlowButton 
                  onClick={handleAddAsset}
                  icon={Plus}
                  size="sm"
                >
                  Add Asset
                </GlowButton>
              </div>
            </div>
          </motion.div>
        </div>
      )}
      
      {/* Header */}
      <PageHeader
        title="Asset Management"
        subtitle="Track and manage all company assets"
        actions={
          <>
            <Button variant="secondary" icon={<QrCode className="w-[13px] h-[13px]" strokeWidth={1.8} />} onClick={() => navigate('/asset/scan')}>
              Scan QR
            </Button>
            <Button icon={<Plus className="w-[13px] h-[13px]" strokeWidth={2.2} />} onClick={() => setIsAddModalOpen(true)}>
              Add Asset
            </Button>

            {/* Bulk Actions Dropdown */}
            <div className="relative" ref={bulkActionsRef}>
              <Button
                variant="secondary"
                icon={<MoreVertical className="w-[13px] h-[13px]" />}
                aria-haspopup="menu"
                aria-expanded={isBulkActionsOpen}
                onClick={() => setIsBulkActionsOpen(!isBulkActionsOpen)}
              >
                Bulk Actions
              </Button>

              {isBulkActionsOpen && (
                <div
                  role="menu"
                  className="absolute right-0 mt-1 w-44 origin-top-right rounded-xl bg-white border border-border shadow-lg z-10 py-1"
                >
                  {[
                    { id: 'export', label: 'Export to Excel', icon: <Download className="w-3 h-3 mr-1.5" /> },
                    { id: 'print', label: 'Print Report', icon: <PrinterIcon className="w-3 h-3 mr-1.5" /> },
                    { id: 'bulk_assign', label: 'Bulk Assign', icon: <User className="w-3 h-3 mr-1.5" /> },
                    { id: 'bulk_update', label: 'Bulk Update', icon: <Settings className="w-3 h-3 mr-1.5" /> }
                  ].map((action) => (
                    <button
                      key={action.id}
                      type="button"
                      role="menuitem"
                      onClick={() => handleBulkAction(action.id)}
                      className="flex items-center w-full px-3 py-1.5 text-left text-xs text-ink hover:bg-background"
                    >
                      {action.icon}
                      {action.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </>
        }
      />

      {/* Stat tiles */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3.5">
        {[
          { label: 'Total Assets', value: stats.total, icon: <HardDrive className="w-4 h-4 text-muted-foreground" strokeWidth={1.8} />, sub: `Value: KES ${stats.totalValue.toLocaleString()}`, valueClass: 'text-ink' },
          { label: 'Active', value: stats.active, icon: <CheckCircle className="w-4 h-4 text-status-success" strokeWidth={1.8} />, sub: `${stats.total > 0 ? Math.round((stats.active / stats.total) * 100) : 0}% of assets`, valueClass: 'text-ink' },
          { label: 'Maintenance', value: stats.maintenance, icon: <Wrench className="w-4 h-4 text-orange" strokeWidth={1.8} />, sub: 'Needs attention', valueClass: 'text-ink' },
          { label: 'Retired', value: stats.retired, icon: <Archive className="w-4 h-4 text-subtle" strokeWidth={1.8} />, sub: 'Out of service', valueClass: 'text-ink' },
          { label: 'Lost', value: stats.lost, icon: <AlertCircle className="w-4 h-4 text-status-danger" strokeWidth={1.8} />, sub: 'Missing assets', valueClass: 'text-status-danger' },
        ].map((tile) => (
          <Card key={tile.label} padding="sm" className="!p-4">
            <div className="flex items-center justify-between">
              <div className="text-[11px] font-semibold text-muted-foreground">{tile.label}</div>
              {tile.icon}
            </div>
            <div className={`text-xl font-bold mt-1 ${tile.valueClass}`}>{tile.value}</div>
            <div className="text-[10.5px] text-subtle mt-0.5">{tile.sub}</div>
          </Card>
        ))}
      </div>

      {/* Category pills */}
      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by category">
        {[
          { id: 'all', label: `All Categories (${stats.total})`, icon: <HardDrive className="w-3 h-3" /> },
          ...assetCategories.map(c => ({ id: c.id, label: `${c.name} (${c.count})`, icon: c.icon })),
        ].map((cat) => {
          const active = selectedCategory === cat.id;
          return (
            <button
              key={cat.id}
              type="button"
              aria-pressed={active}
              onClick={() => {
                setSelectedCategory(cat.id);
                setCurrentPage(1);
              }}
              className={`flex items-center gap-1.5 px-3.5 py-[7px] rounded-pill text-[11.5px] font-semibold transition-colors ${
                active ? 'bg-brand text-white' : 'bg-secondary text-ink hover:bg-border'
              }`}
            >
              {cat.icon}
              {cat.label}
            </button>
          );
        })}
      </div>

      {/* Filters */}
      <Card padding="sm" className="!p-3.5">
        <div className="grid grid-cols-1 md:grid-cols-6 gap-3 items-center">
          <div className="md:col-span-2">
            <SearchInput
              placeholder="Search assets..."
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setCurrentPage(1);
              }}
              className="!bg-white !border-border"
            />
          </div>

          {[
            { label: 'Category', value: selectedCategory, set: setSelectedCategory, all: 'All Categories', options: categories },
            { label: 'Status', value: selectedStatus, set: setSelectedStatus, all: 'All Status', options: statuses },
            { label: 'Department', value: selectedDepartment, set: setSelectedDepartment, all: 'All Departments', options: departments },
            { label: 'Location', value: selectedLocation, set: setSelectedLocation, all: 'All Locations', options: locations },
          ].map((f) => (
            <div className="relative" key={f.label}>
              <select
                aria-label={`Filter by ${f.label.toLowerCase()}`}
                value={f.value}
                onChange={(e) => {
                  f.set(e.target.value);
                  setCurrentPage(1);
                }}
                className="w-full appearance-none rounded-tile border border-border bg-white pl-3 pr-8 py-2 text-xs text-ink outline-none focus:border-brand"
              >
                <option value="all">{f.all}</option>
                {f.options.filter((o: string) => o !== 'all').map((o: string) => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </select>
              <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 text-subtle w-3 h-3 pointer-events-none" />
            </div>
          ))}

          <Button
            variant="secondary"
            className="justify-center"
            icon={<CircleOff className="w-3 h-3" />}
            onClick={() => {
              setSearchTerm('');
              setSelectedCategory('all');
              setSelectedStatus('all');
              setSelectedDepartment('all');
              setSelectedLocation('all');
              setCurrentPage(1);
            }}
          >
            Reset
          </Button>
        </div>
      </Card>

      {/* Asset cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {currentAssets.map((asset) => (
          <Card key={asset.id} padding="sm" className="!p-4 hover:border-brand/40 transition-colors">
            {/* Asset header */}
            <div className="flex items-start justify-between mb-3 gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <div className={`w-8 h-8 shrink-0 rounded-lg flex items-center justify-center text-white ${getCategoryColor(asset.category || 'other')}`}>
                  {getCategoryIcon(asset.category || 'other')}
                </div>
                <div className="min-w-0">
                  <h3 className="m-0 text-xs font-bold text-ink truncate">{asset.asset_name}</h3>
                  <p className="m-0 text-[11px] text-muted-foreground">{asset.asset_tag || 'No Tag'}</p>
                </div>
              </div>
              <StatusPill
                label={asset.status ? asset.status.charAt(0).toUpperCase() + asset.status.slice(1) : 'Active'}
                tone={assetStatusTone(asset.status || 'active')}
              />
            </div>

            {/* Asset details */}
            <div className="space-y-1.5 mb-3 text-[11px]">
              <div className="flex items-center justify-between">
                <span className="text-subtle">Serial</span>
                <span className="font-semibold text-ink truncate ml-2 max-w-[120px]">{asset.serial_number || 'N/A'}</span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-subtle">Value</span>
                <span className="font-semibold text-brand-dark">
                  KES {asset.purchase_value ? asset.purchase_value.toLocaleString() : 'N/A'}
                </span>
              </div>

              <div className="flex items-center gap-1.5 text-muted-foreground">
                <Building className="w-3 h-3 text-subtle shrink-0" />
                <span className="truncate">{asset.location || 'Unassigned'}</span>
              </div>

              {asset.assigned_to && (
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <User className="w-3 h-3 text-subtle shrink-0" />
                  <span className="truncate">{asset.assigned_to}</span>
                </div>
              )}

              <div className="flex items-center justify-between pt-1">
                <StatusPill
                  label={asset.condition ? asset.condition.charAt(0).toUpperCase() + asset.condition.slice(1) : 'Good'}
                  tone={assetConditionTone(asset.condition || 'good')}
                />
                <span className="text-subtle">
                  {asset.purchase_date ? new Date(asset.purchase_date).toLocaleDateString('en-GB') : 'N/A'}
                </span>
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-1.5">
              <Button
                className="!px-2.5 !py-1.5 !text-[11px]"
                icon={<Eye className="w-3 h-3" />}
                onClick={() => {
                  setSelectedAsset(asset);
                  setIsViewModalOpen(true);
                }}
              >
                View
              </Button>

              <Button
                variant="secondary"
                className="!px-2.5 !py-1.5 !text-[11px]"
                icon={<Edit className="w-3 h-3" />}
                onClick={() => navigate(`/asset/edit/${asset.id}`)}
              >
                Edit
              </Button>

              <RoleButtonWrapper allowedRoles={['ADMIN', 'IT']}>
                <Button
                  variant="secondary"
                  className="!px-2.5 !py-1.5 !text-[11px] !text-status-danger !border-[#F6DCC7]"
                  icon={<Trash2 className="w-3 h-3" />}
                  onClick={() => handleDeleteAsset(asset.id)}
                >
                  Delete
                </Button>
              </RoleButtonWrapper>
            </div>
          </Card>
        ))}
      </div>

      {/* Pagination */}
      {filteredAssets.length > 0 && (
        <div className="mt-4 flex flex-col sm:flex-row justify-between items-center gap-3">
          <div className="text-muted-foreground">
            Showing {indexOfFirstAsset + 1} to {Math.min(indexOfLastAsset, filteredAssets.length)} of {filteredAssets.length} assets
          </div>
          <div className="flex gap-1">
            <button
              type="button"
              aria-label="Previous page"
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="w-7 h-7 border border-border bg-white rounded-lg disabled:opacity-50 hover:bg-secondary transition-colors flex items-center justify-center"
            >
              <ChevronLeft className="w-3 h-3" />
            </button>

            {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
              const page = i + 1;
              return (
                <button
                  type="button"
                  key={page}
                  onClick={() => setCurrentPage(page)}
                  className={`w-7 h-7 border rounded-lg transition-colors flex items-center justify-center ${
                    currentPage === page ? 'bg-green-tint border-brand text-brand font-semibold' : 'bg-white border-border hover:bg-secondary'
                  }`}
                >
                  {page}
                </button>
              );
            })}

            {totalPages > 5 && currentPage < totalPages - 2 && (
              <>
                <span className="w-7 h-7 flex items-center justify-center">...</span>
                <button
                  type="button"
                  onClick={() => setCurrentPage(totalPages)}
                  className="w-7 h-7 border border-border bg-white rounded-lg hover:bg-secondary transition-colors flex items-center justify-center"
                >
                  {totalPages}
                </button>
              </>
            )}

            <button
              type="button"
              aria-label="Next page"
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="w-7 h-7 border border-border bg-white rounded-lg disabled:opacity-50 hover:bg-secondary transition-colors flex items-center justify-center"
            >
              <ChevronRight className="w-3 h-3" />
            </button>
          </div>
        </div>
      )}

      {/* Empty state */}
      {filteredAssets.length === 0 && (
        <Card>
          <EmptyState
            className="py-12"
            icon={<HardDrive size={20} />}
            title="No assets found"
            description="Try adjusting your search or add a new asset"
            action={
              <Button icon={<Plus className="w-3 h-3" />} onClick={() => setIsAddModalOpen(true)}>
                Add First Asset
              </Button>
            }
          />
        </Card>
      )}

      {/* View Asset Modal */}
      {isViewModalOpen && selectedAsset && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-3 z-50 backdrop-blur-sm">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ type: "spring", damping: 20, stiffness: 300 }}
            className="bg-white rounded-lg w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden border border-gray-300 text-xs"
          >
            {/* Header */}
            <div className="p-4 pb-0 flex justify-between items-center sticky top-0 bg-white z-10 border-b border-gray-300">
              <div className="flex items-center space-x-2">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${getCategoryColor(selectedAsset.category || 'other')}`}>
                  {getCategoryIcon(selectedAsset.category || 'other')}
                </div>
                <div>
                  <h2 className="text-lg font-bold text-gray-800">
                    {selectedAsset.asset_name}
                  </h2>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className="text-gray-500">Tag: {selectedAsset.asset_tag || 'N/A'}</span>
                    <span className={`px-1.5 py-0.5 rounded-full ${getStatusColor(selectedAsset.status || 'active')}`}>
                      {selectedAsset.status}
                    </span>
                  </div>
                </div>
              </div>
              <button 
                onClick={() => setIsViewModalOpen(false)}
                className="p-1 rounded-full hover:bg-gray-100 transition-colors text-gray-500 hover:text-gray-700"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Scrollable Content */}
            <div className="overflow-y-auto px-4 py-3 flex-1">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Basic Information */}
                <div className="space-y-2">
                  <h3 className="font-semibold text-gray-800 flex items-center">
                    <Briefcase className="w-3 h-3 mr-1.5" />
                    Basic Information
                  </h3>
                  <div className="space-y-1.5 pl-4">
                    <DetailRow label="Category" value={selectedAsset.category} />
                    <DetailRow label="Brand" value={selectedAsset.brand} />
                    <DetailRow label="Model" value={selectedAsset.model} />
                    <DetailRow label="Serial Number" value={selectedAsset.serial_number} />
                    <DetailRow label="Condition" value={selectedAsset.condition} />
                  </div>
                </div>

                {/* Financial Information */}
                <div className="space-y-2">
                  <h3 className="font-semibold text-gray-800 flex items-center">
                    <Tag className="w-3 h-3 mr-1.5" />
                    Financial Information
                  </h3>
                  <div className="space-y-1.5 pl-4">
                    <DetailRow 
                      label="Purchase Value" 
                      value={selectedAsset.purchase_value ? `KES ${selectedAsset.purchase_value.toLocaleString()}` : 'N/A'} 
                    />
                    <DetailRow label="Purchase Date" value={selectedAsset.purchase_date} />
                    <DetailRow label="Warranty Expiry" value={selectedAsset.warranty_expiry} />
                  </div>
                </div>

                {/* Location & Assignment */}
                <div className="space-y-2">
                  <h3 className="font-semibold text-gray-800 flex items-center">
                    <MapPin className="w-3 h-3 mr-1.5" />
                    Location & Assignment
                  </h3>
                  <div className="space-y-1.5 pl-4">
                    <DetailRow label="Department" value={selectedAsset.department} />
                    <DetailRow label="Location" value={selectedAsset.location} />
                    <DetailRow label="Assigned To" value={selectedAsset.assigned_to} />
                  </div>
                </div>

                {/* Maintenance & History */}
                <div className="space-y-2">
                  <h3 className="font-semibold text-gray-800 flex items-center">
                    <Settings className="w-3 h-3 mr-1.5" />
                    Maintenance & History
                  </h3>
                  <div className="space-y-1.5 pl-4">
                    <DetailRow label="Last Maintenance" value={selectedAsset.last_maintenance} />
                    <DetailRow label="Next Maintenance" value={selectedAsset.next_maintenance} />
                    <DetailRow label="Created At" value={selectedAsset.created_at ? new Date(selectedAsset.created_at).toLocaleDateString('en-GB') : 'N/A'} />
                  </div>
                </div>

                {/* Notes */}
                {selectedAsset.notes && (
                  <div className="md:col-span-2 space-y-2">
                    <h3 className="font-semibold text-gray-800">Notes</h3>
                    <div className="bg-gray-50 rounded p-3 text-gray-700">
                      {selectedAsset.notes}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="px-4 py-2 border-t border-gray-300 bg-gray-50 flex justify-between items-center sticky bottom-0">
              <div className="text-gray-600">
                Asset ID: {selectedAsset.id.substring(0, 8)}...
              </div>
              <div className="flex space-x-2">
                <GlowButton 
                  variant="secondary"
                  size="xs"
                  onClick={() => setIsViewModalOpen(false)}
                >
                  Close
                </GlowButton>
                <GlowButton 
                  size="xs"
                  onClick={() => navigate(`/assets/edit/${selectedAsset.id}`)}
                  icon={Edit}
                >
                  Edit Asset
                </GlowButton>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
};

const DetailRow = ({ label, value }: { label: string; value: string | number | null }) => (
  <div className="flex justify-between">
    <span className="text-gray-600">{label}:</span>
    <span className="font-medium text-gray-900 text-right max-w-[150px] truncate">{value || 'N/A'}</span>
  </div>
);

export default AssetManagement;