import { useState, useEffect, useRef } from 'react';
import { 
  Search, Plus, Eye, Edit, Trash2, Filter, Download, 
  PrinterIcon, ChevronLeft, ChevronRight, X, Settings,
  HardDrive, Smartphone, Monitor, Camera, Car, Wrench, 
  Server, Headphones, Cpu, CheckCircle, AlertCircle,
  Clock, Archive, MoreVertical, QrCode, MapPin, User,
  Tag, Building, Briefcase, CircleOff, ChevronDown,
  Mail, Phone, BookUser
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

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'active': return <CheckCircle className="w-3 h-3" />;
      case 'maintenance': return <Wrench className="w-3 h-3" />;
      case 'retired': return <Archive className="w-3 h-3" />;
      case 'lost': return <AlertCircle className="w-3 h-3" />;
      default: return <Clock className="w-3 h-3" />;
    }
  };

  const getConditionColor = (condition: string) => {
    switch (condition) {
      case 'excellent': return 'text-green-600 bg-green-500/10';
      case 'good': return 'text-blue-600 bg-blue-500/10';
      case 'fair': return 'text-yellow-600 bg-yellow-500/10';
      case 'poor': return 'text-orange-600 bg-orange-500/10';
      case 'damaged': return 'text-red-600 bg-red-500/10';
      default: return 'text-gray-600 bg-gray-500/10';
    }
  };

  // Handle functions
  const handleAddAsset = async () => {
    try {
      const { data, error } = await supabase
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
                  <select
                    name="assigned_to"
                    value={newAsset.assigned_to || ''}
                    onChange={handleInputChange}
                    className="w-full h-[38px] bg-gray-50 border border-gray-300 rounded-lg px-3 py-1.5 text-xs text-gray-900 focus:outline-none focus:border-green-500 focus:shadow-[0_0_10px_rgba(34,197,94,0.3)] transition-all duration-200"
                  >
                    <option value="">Select Employee</option>
                    {employees.map(emp => (
                      <option key={emp['Employee Number']} value={`${emp['First Name']} ${emp['Last Name']} (${emp['Employee Number']})`}>
                        {emp['First Name']} {emp['Last Name']} - {emp['Employee Number']}
                      </option>
                    ))}
                  </select>
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
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Asset Management</h1>
          <p className="text-gray-600 mt-0.5">
            Track and manage all company assets
          </p>
        </div>
        
        <div className="flex flex-wrap gap-2">
          <GlowButton 
            variant="secondary" 
            icon={QrCode}
            size="sm"
            onClick={() => navigate('/asset/scan')}
          >
            Scan QR
          </GlowButton>
          
          <GlowButton 
            icon={Plus} 
            size="sm"
            onClick={() => setIsAddModalOpen(true)}
          >
            Add Asset
          </GlowButton>
          
          {/* Bulk Actions Dropdown */}
          <div className="relative" ref={bulkActionsRef}>
            <GlowButton 
              variant="secondary"
              icon={MoreVertical}
              size="sm"
              onClick={() => setIsBulkActionsOpen(!isBulkActionsOpen)}
            >
              Bulk Actions
            </GlowButton>
            
            {isBulkActionsOpen && (
              <motion.div 
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="absolute right-0 mt-1 w-40 origin-top-right rounded-md bg-white shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none z-10 text-xs"
              >
                <div className="py-1">
                  {[
                    { id: 'export', label: 'Export to Excel', icon: <Download className="w-3 h-3 mr-1.5" /> },
                    { id: 'print', label: 'Print Report', icon: <PrinterIcon className="w-3 h-3 mr-1.5" /> },
                    { id: 'bulk_assign', label: 'Bulk Assign', icon: <User className="w-3 h-3 mr-1.5" /> },
                    { id: 'bulk_update', label: 'Bulk Update', icon: <Settings className="w-3 h-3 mr-1.5" /> }
                  ].map((action) => (
                    <button
                      key={action.id}
                      onClick={() => handleBulkAction(action.id)}
                      className="flex items-center w-full px-3 py-1.5 text-left text-xs text-gray-700 hover:bg-gray-100 hover:text-gray-900"
                    >
                      {action.icon}
                      {action.label}
                    </button>
                  ))}
                </div>
              </motion.div>
            )}
          </div>
        </div>
      </div>
      
      {/* Stats Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <motion.div 
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="bg-white backdrop-blur-sm border border-gray-200 rounded-lg p-3 hover:shadow-[0_0_15px_rgba(59,130,246,0.2)] transition-all duration-300"
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-gray-500">Total Assets</p>
              <p className="text-lg font-bold text-gray-900">{stats.total}</p>
            </div>
            <div className="w-8 h-8 bg-blue-500/10 rounded-full flex items-center justify-center">
              <HardDrive className="w-4 h-4 text-blue-600" />
            </div>
          </div>
          <div className="mt-1 text-gray-500">
            Value: KES {stats.totalValue.toLocaleString()}
          </div>
        </motion.div>
        
        <motion.div 
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="bg-white backdrop-blur-sm border border-gray-200 rounded-lg p-3 hover:shadow-[0_0_15px_rgba(34,197,94,0.2)] transition-all duration-300"
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-gray-500">Active</p>
              <p className="text-lg font-bold text-gray-900">{stats.active}</p>
            </div>
            <div className="w-8 h-8 bg-green-500/10 rounded-full flex items-center justify-center">
              <CheckCircle className="w-4 h-4 text-green-600" />
            </div>
          </div>
          <div className="mt-1 text-green-600">
            {stats.total > 0 ? Math.round((stats.active / stats.total) * 100) : 0}%
          </div>
        </motion.div>
        
        <motion.div 
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="bg-white backdrop-blur-sm border border-gray-200 rounded-lg p-3 hover:shadow-[0_0_15px_rgba(234,179,8,0.2)] transition-all duration-300"
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-gray-500">Maintenance</p>
              <p className="text-lg font-bold text-gray-900">{stats.maintenance}</p>
            </div>
            <div className="w-8 h-8 bg-yellow-500/10 rounded-full flex items-center justify-center">
              <Wrench className="w-4 h-4 text-yellow-600" />
            </div>
          </div>
          <div className="mt-1 text-yellow-600">
            Needs attention
          </div>
        </motion.div>
        
        <motion.div 
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25 }}
          className="bg-white backdrop-blur-sm border border-gray-200 rounded-lg p-3 hover:shadow-[0_0_15px_rgba(107,114,128,0.2)] transition-all duration-300"
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-gray-500">Retired</p>
              <p className="text-lg font-bold text-gray-900">{stats.retired}</p>
            </div>
            <div className="w-8 h-8 bg-gray-500/10 rounded-full flex items-center justify-center">
              <Archive className="w-4 h-4 text-gray-600" />
            </div>
          </div>
          <div className="mt-1 text-gray-500">
            Out of service
          </div>
        </motion.div>
        
        <motion.div 
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="bg-white backdrop-blur-sm border border-gray-200 rounded-lg p-3 hover:shadow-[0_0_15px_rgba(239,68,68,0.2)] transition-all duration-300"
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-gray-500">Lost</p>
              <p className="text-lg font-bold text-gray-900">{stats.lost}</p>
            </div>
            <div className="w-8 h-8 bg-red-500/10 rounded-full flex items-center justify-center">
              <AlertCircle className="w-4 h-4 text-red-600" />
            </div>
          </div>
          <div className="mt-1 text-red-600">
            Missing assets
          </div>
        </motion.div>
      </div>
      
      {/* Category Tabs - Like in employee component */}
      <div className="bg-white/80 backdrop-blur-sm border border-gray-200 rounded-lg p-4">
        <h3 className="text-xs font-semibold text-gray-700 mb-3">Asset Categories</h3>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setSelectedCategory('all')}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-200 flex items-center gap-1.5 ${
              selectedCategory === 'all' 
                ? 'bg-green-500 text-white border border-green-500' 
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200 border border-gray-200'
            }`}
          >
            <HardDrive className="w-3 h-3" />
            All Categories ({stats.total})
          </button>
          
          {assetCategories.map(category => (
            <button
              key={category.id}
              onClick={() => setSelectedCategory(category.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-200 ${
                selectedCategory === category.id 
                  ? `${category.color} text-white border ${category.color.replace('bg-', 'border-')}` 
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200 border border-gray-200'
              }`}
            >
              {category.icon}
              {category.name} ({category.count})
            </button>
          ))}
        </div>
      </div>
      
      {/* Filters */}
      <div className="bg-white/80 backdrop-blur-sm border border-gray-200 rounded-lg p-4">
        <div className="grid grid-cols-1 md:grid-cols-6 gap-3 items-center">
          {/* Search Input */}
          <div className="relative md:col-span-2">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-500 w-3 h-3" />
            <input
              type="text"
              placeholder="Search assets..."
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full h-[34px] bg-gray-50 border border-gray-300 rounded-lg pl-8 pr-3 py-1.5 text-xs text-gray-900 placeholder-gray-500 focus:outline-none focus:border-green-500 focus:shadow-[0_0_10px_rgba(34,197,94,0.3)] transition-all duration-200"
            />
          </div>
          
          {/* Category Filter */}
          <div className="relative">
            <select
              value={selectedCategory}
              onChange={(e) => {
                setSelectedCategory(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full h-[34px] bg-gray-50 border border-gray-300 rounded-lg pl-3 pr-8 py-1.5 text-xs text-gray-900 appearance-none focus:outline-none focus:border-green-500 focus:shadow-[0_0_10px_rgba(34,197,94,0.3)] transition-all duration-200"
            >
              <option value="all">All Categories</option>
              {categories.filter(c => c !== 'all').map(category => (
                <option key={category} value={category}>{category}</option>
              ))}
            </select>
            <ChevronDown className="absolute right-2 top-1/2 transform -translate-y-1/2 text-gray-500 w-3 h-3 pointer-events-none" />
          </div>
          
          {/* Status Filter */}
          <div className="relative">
            <select
              value={selectedStatus}
              onChange={(e) => {
                setSelectedStatus(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full h-[34px] bg-gray-50 border border-gray-300 rounded-lg pl-3 pr-8 py-1.5 text-xs text-gray-900 appearance-none focus:outline-none focus:border-green-500 focus:shadow-[0_0_10px_rgba(34,197,94,0.3)] transition-all duration-200"
            >
              <option value="all">All Status</option>
              {statuses.filter(s => s !== 'all').map(status => (
                <option key={status} value={status}>{status}</option>
              ))}
            </select>
            <ChevronDown className="absolute right-2 top-1/2 transform -translate-y-1/2 text-gray-500 w-3 h-3 pointer-events-none" />
          </div>
          
          {/* Department Filter */}
          <div className="relative">
            <select
              value={selectedDepartment}
              onChange={(e) => {
                setSelectedDepartment(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full h-[34px] bg-gray-50 border border-gray-300 rounded-lg pl-3 pr-8 py-1.5 text-xs text-gray-900 appearance-none focus:outline-none focus:border-green-500 focus:shadow-[0_0_10px_rgba(34,197,94,0.3)] transition-all duration-200"
            >
              <option value="all">All Departments</option>
              {departments.filter(d => d !== 'all').map(dept => (
                <option key={dept} value={dept}>{dept}</option>
              ))}
            </select>
            <ChevronDown className="absolute right-2 top-1/2 transform -translate-y-1/2 text-gray-500 w-3 h-3 pointer-events-none" />
          </div>
          
          {/* Location Filter */}
          <div className="relative">
            <select
              value={selectedLocation}
              onChange={(e) => {
                setSelectedLocation(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full h-[34px] bg-gray-50 border border-gray-300 rounded-lg pl-3 pr-8 py-1.5 text-xs text-gray-900 appearance-none focus:outline-none focus:border-green-500 focus:shadow-[0_0_10px_rgba(34,197,94,0.3)] transition-all duration-200"
            >
              <option value="all">All Locations</option>
              {locations.filter(l => l !== 'all').map(location => (
                <option key={location} value={location}>{location}</option>
              ))}
            </select>
            <ChevronDown className="absolute right-2 top-1/2 transform -translate-y-1/2 text-gray-500 w-3 h-3 pointer-events-none" />
          </div>
          
          {/* Reset Filters Button */}
          <button
            onClick={() => {
              setSearchTerm('');
              setSelectedCategory('all');
              setSelectedStatus('all');
              setSelectedDepartment('all');
              setSelectedLocation('all');
              setCurrentPage(1);
            }}
            className="h-[34px] px-3 bg-gray-100 hover:bg-gray-200 border border-gray-300 rounded-lg text-xs text-gray-700 transition-colors flex items-center justify-center gap-1"
          >
            <CircleOff className="w-3 h-3" />
            Reset
          </button>
        </div>
      </div>
      
      {/* Asset Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {currentAssets.map((asset, index) => (
          <motion.div
            key={asset.id}
            className="bg-white backdrop-blur-sm border border-gray-200 rounded-lg p-4 hover:border-green-500/50 hover:shadow-[0_0_15px_rgba(34,197,94,0.2)] shadow-md transition-all duration-300"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.05 }}
            whileHover={{ scale: 1.02, y: -2 }}
          >
            {/* Asset Header */}
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center space-x-2">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${getCategoryColor(asset.category || 'other')}`}>
                  {getCategoryIcon(asset.category || 'other')}
                </div>
                <div>
                  <h3 className="text-gray-900 font-semibold line-clamp-1 text-xs">
                    {asset.asset_name}
                  </h3>
                  <p className="text-gray-600">{asset.asset_tag || 'No Tag'}</p>
                </div>
              </div>
              <div className={`px-1.5 py-0.5 rounded-full flex items-center gap-1 ${getStatusColor(asset.status || 'active')}`}>
                {getStatusIcon(asset.status || 'active')}
                <span className="text-xs">{asset.status?.charAt(0).toUpperCase()}</span>
              </div>
            </div>
            
            {/* Asset Details */}
            <div className="space-y-1.5 mb-3">
              <div className="flex items-center justify-between">
                <span className="text-gray-500">Serial:</span>
                <span className="font-medium text-gray-900 truncate ml-2 max-w-[120px]">{asset.serial_number || 'N/A'}</span>
              </div>
              
              <div className="flex items-center justify-between">
                <span className="text-gray-500">Value:</span>
                <span className="font-medium text-green-700">
                  KES {asset.purchase_value ? asset.purchase_value.toLocaleString() : 'N/A'}
                </span>
              </div>
              
              <div className="flex items-center gap-1">
                <Building className="w-3 h-3 text-gray-400 flex-shrink-0" />
                <span className="text-gray-700 truncate">{asset.location || 'Unassigned'}</span>
              </div>
              
              {asset.assigned_to && (
                <div className="flex items-center gap-1">
                  <User className="w-3 h-3 text-gray-400 flex-shrink-0" />
                  <span className="text-gray-700 truncate">{asset.assigned_to}</span>
                </div>
              )}
              
              <div className="flex items-center justify-between pt-1">
                <span className={`px-1.5 py-0.5 rounded text-xs ${getConditionColor(asset.condition || 'good')}`}>
                  {asset.condition?.charAt(0).toUpperCase() + asset.condition?.slice(1) || 'Good'}
                </span>
                <span className="text-gray-500 text-xs">
                  {asset.purchase_date ? new Date(asset.purchase_date).toLocaleDateString('en-GB') : 'N/A'}
                </span>
              </div>
            </div>
            
            {/* Action Buttons */}
            <div className="flex space-x-1.5">
              <GlowButton 
                variant="primary" 
                size="xs"
                icon={Eye}
                onClick={() => {
                  setSelectedAsset(asset);
                  setIsViewModalOpen(true);
                }}
              >
                View
              </GlowButton>
              
              <GlowButton 
                variant="secondary" 
                size="xs"
                icon={Edit}
                onClick={() => navigate(`/asset/edit/${asset.id}`)}
              >
                Edit
              </GlowButton>
              
              <RoleButtonWrapper allowedRoles={['ADMIN', 'IT']}>
                <GlowButton 
                  variant="danger" 
                  size="xs"
                  icon={Trash2}
                  onClick={() => handleDeleteAsset(asset.id)}
                >
                  Delete
                </GlowButton>
              </RoleButtonWrapper>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Pagination */}
      {filteredAssets.length > 0 && (
        <div className="mt-4 flex flex-col sm:flex-row justify-between items-center gap-3">
          <div className="text-gray-600">
            Showing {indexOfFirstAsset + 1} to {Math.min(indexOfLastAsset, filteredAssets.length)} of {filteredAssets.length} assets
          </div>
          <div className="flex gap-1">
            <button
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="w-7 h-7 border rounded disabled:opacity-50 hover:bg-gray-50 transition-colors flex items-center justify-center"
            >
              <ChevronLeft className="w-3 h-3" />
            </button>
            
            {/* Pagination numbers */}
            {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
              const page = i + 1;
              return (
                <button
                  key={page}
                  onClick={() => setCurrentPage(page)}
                  className={`w-7 h-7 border rounded hover:bg-gray-50 transition-colors flex items-center justify-center ${
                    currentPage === page ? 'bg-green-100 border-green-500 text-green-800' : ''
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
                  onClick={() => setCurrentPage(totalPages)}
                  className="w-7 h-7 border rounded hover:bg-gray-50 transition-colors flex items-center justify-center"
                >
                  {totalPages}
                </button>
              </>
            )}
            
            <button
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="w-7 h-7 border rounded disabled:opacity-50 hover:bg-gray-50 transition-colors flex items-center justify-center"
            >
              <ChevronRight className="w-3 h-3" />
            </button>
          </div>
        </div>
      )}
      
      {/* Empty state */}
      {filteredAssets.length === 0 && (
        <div className="mt-8 text-center">
          <div className="mx-auto w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mb-3">
            <HardDrive className="text-gray-400 w-6 h-6" />
          </div>
          <h3 className="text-sm font-medium text-gray-700">No assets found</h3>
          <p className="text-gray-500 mt-0.5">Try adjusting your search or add a new asset</p>
          <GlowButton 
            icon={Plus} 
            size="sm"
            onClick={() => setIsAddModalOpen(true)}
            className="mt-3"
          >
            Add First Asset
          </GlowButton>
        </div>
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