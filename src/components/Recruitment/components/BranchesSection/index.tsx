import { useEffect, useState } from 'react';
import { BranchCard } from './BranchCard';
import { jobPositions } from '../constants/jobPositions';
import { StatusBadge } from '../StatusBadge';
import GlowButton from '../../../UI/GlowButton';
import { Briefcase, Edit, Save, X, Plus } from 'lucide-react';
import { supabase } from '../../../../lib/supabase';

interface KenyaOfficeLocation {
  id: string;
  name: string;
  location: string;
  hiring_status: string;
  total_positions?: number;
  critically_needed?: number;
  urgent_positions?: number;
  contact_email?: string;
  contact_phone?: string;
  address?: string;
  town?: string;
  county?: string;
  country?: string;
  is_active?: boolean;
  created_at: string;
}

export const BranchesSection = () => {
  const [kenyaOfficeLocations, setKenyaOfficeLocations] = useState<KenyaOfficeLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<KenyaOfficeLocation>>({});
  const [showAddForm, setShowAddForm] = useState(false);
  const [newOffice, setNewOffice] = useState<Partial<KenyaOfficeLocation>>({
    hiring_status: 'active',
    country: 'Kenya',
    is_active: true
  });

  // Fetch Kenya office locations from Supabase
  const fetchKenyaOfficeLocations = async () => {
    try {
      setLoading(true);
      setError(null);

      const { data, error: supabaseError } = await supabase
        .from('kenya_office_locations')
        .select('*')
        .eq('is_active', true)
        .order('name');

      if (supabaseError) {
        throw supabaseError;
      }

      setKenyaOfficeLocations(data || []);
    } catch (err) {
      console.error('Error fetching Kenya office locations:', err);
      setError('Failed to load office locations data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchKenyaOfficeLocations();
  }, []);

  // Start editing an office
  const startEditing = (office: KenyaOfficeLocation) => {
    setEditingId(office.id);
    setEditForm({ ...office });
  };

  // Cancel editing
  const cancelEditing = () => {
    setEditingId(null);
    setEditForm({});
  };

  // Save edited office
  const saveEdit = async () => {
    if (!editingId) return;

    try {
      const { error } = await supabase
        .from('kenya_office_locations')
        .update(editForm)
        .eq('id', editingId);

      if (error) throw error;

      // Refresh the data
      await fetchKenyaOfficeLocations();
      setEditingId(null);
      setEditForm({});
      toast.success('Office updated successfully!');
    } catch (err) {
      console.error('Error updating office:', err);
      toast.error('Failed to update office');
    }
  };

  // Add new office
  const addNewOffice = async () => {
    try {
      const { error } = await supabase
        .from('kenya_office_locations')
        .insert([newOffice]);

      if (error) throw error;

      // Refresh the data
      await fetchKenyaOfficeLocations();
      setShowAddForm(false);
      setNewOffice({
        hiring_status: 'active',
        country: 'Kenya',
        is_active: true
      });
      toast.success('Office added successfully!');
    } catch (err) {
      console.error('Error adding office:', err);
      toast.error('Failed to add office');
    }
  };

  // Delete office (soft delete)
  const deleteOffice = async (id: string) => {
    if (!confirm('Are you sure you want to delete this office?')) return;

    try {
      const { error } = await supabase
        .from('kenya_office_locations')
        .update({ is_active: false })
        .eq('id', id);

      if (error) throw error;

      // Refresh the data
      await fetchKenyaOfficeLocations();
      toast.success('Office deleted successfully!');
    } catch (err) {
      console.error('Error deleting office:', err);
      toast.error('Failed to delete office');
    }
  };

  // Calculate position counts for each location
  const getLocationStats = (locationId: string) => {
    const locationPositions = jobPositions.filter(p => p.branch === locationId);
    const criticalPositions = locationPositions.filter(p => p.status === 'Critically Needed').length;
    const urgentPositions = locationPositions.filter(p => p.status === 'Urgent').length;
    
    return {
      total: locationPositions.length,
      critical: criticalPositions,
      urgent: urgentPositions
    };
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center py-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#47d475]"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <div className="text-center">
          <p className="text-red-600 mb-4">{error}</p>
          <GlowButton onClick={fetchKenyaOfficeLocations} size="sm">
            Retry
          </GlowButton>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Kenya Office Hiring Needs</h2>
          <div className="flex gap-2">
            <GlowButton onClick={fetchKenyaOfficeLocations} size="sm" variant="secondary">
              Refresh
            </GlowButton>
            <GlowButton 
              onClick={() => setShowAddForm(true)} 
              icon={Plus} 
              size="sm"
            >
              Add Office
            </GlowButton>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {kenyaOfficeLocations.map((location) => {
            const stats = getLocationStats(location.id);
            return (
              <BranchCard 
                key={location.id} 
                branch={location} 
                positions={jobPositions.filter((p) => p.branch === location.id)} 
                onEdit={() => startEditing(location)}
              />
            );
          })}
        </div>
        
        {kenyaOfficeLocations.length === 0 && (
          <div className="text-center py-8">
            <p className="text-gray-500">No office locations found</p>
          </div>
        )}
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Kenya Office Hiring Status</h2>
          <GlowButton onClick={fetchKenyaOfficeLocations} size="sm" variant="secondary">
            Refresh
          </GlowButton>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left py-3 px-4 text-gray-700 font-semibold">Office</th>
                <th className="text-left py-3 px-4 text-gray-700 font-semibold">Location</th>
                <th className="text-left py-3 px-4 text-gray-700 font-semibold">County</th>
                <th className="text-left py-3 px-4 text-gray-700 font-semibold">Hiring Status</th>
                <th className="text-right py-3 px-4 text-gray-700 font-semibold">Total Positions</th>
                <th className="text-right py-3 px-4 text-gray-700 font-semibold">Critically Needed</th>
                <th className="text-right py-3 px-4 text-gray-700 font-semibold">Urgent</th>
                <th className="text-center py-3 px-4 text-gray-700 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {kenyaOfficeLocations.map((location) => {
                const stats = getLocationStats(location.id);
                const isEditing = editingId === location.id;
                
                return (
                  <tr key={location.id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="py-4 px-4">
                      {isEditing ? (
                        <input
                          type="text"
                          value={editForm.name || ''}
                          onChange={(e) => setEditForm({...editForm, name: e.target.value})}
                          className="w-full px-2 py-1 border border-gray-300 rounded text-xs"
                        />
                      ) : (
                        <p className="text-gray-900 font-semibold">{location.name}</p>
                      )}
                    </td>
                    <td className="py-4 px-4">
                      {isEditing ? (
                        <input
                          type="text"
                          value={editForm.town || ''}
                          onChange={(e) => setEditForm({...editForm, town: e.target.value})}
                          className="w-full px-2 py-1 border border-gray-300 rounded text-xs"
                          placeholder="Town"
                        />
                      ) : (
                        <p className="text-gray-700">{location.town || location.location}</p>
                      )}
                    </td>
                    <td className="py-4 px-4">
                      {isEditing ? (
                        <input
                          type="text"
                          value={editForm.county || ''}
                          onChange={(e) => setEditForm({...editForm, county: e.target.value})}
                          className="w-full px-2 py-1 border border-gray-300 rounded text-xs"
                          placeholder="County"
                        />
                      ) : (
                        <p className="text-gray-700">{location.county}</p>
                      )}
                    </td>
                    <td className="py-4 px-4">
                      {isEditing ? (
                        <select
                          value={editForm.hiring_status || ''}
                          onChange={(e) => setEditForm({...editForm, hiring_status: e.target.value})}
                          className="w-full px-2 py-1 border border-gray-300 rounded text-xs"
                        >
                          <option value="active">Active</option>
                          <option value="actively-hiring">Actively Hiring</option>
                          <option value="selective-hiring">Selective Hiring</option>
                          <option value="not-hiring">Not Hiring</option>
                        </select>
                      ) : (
                        <StatusBadge status={location.hiring_status} />
                      )}
                    </td>
                    <td className="py-4 px-4 text-right font-semibold text-gray-900">
                      {stats.total}
                    </td>
                    <td className="py-4 px-4 text-right font-semibold text-red-600">
                      {stats.critical}
                    </td>
                    <td className="py-4 px-4 text-right font-semibold text-orange-600">
                      {stats.urgent}
                    </td>
                    <td className="py-4 px-4">
                      <div className="flex justify-center gap-1">
                        {isEditing ? (
                          <>
                            <button
                              onClick={saveEdit}
                              className="p-1 text-green-600 hover:bg-green-50 rounded"
                              title="Save"
                            >
                              <Save className="w-4 h-4" />
                            </button>
                            <button
                              onClick={cancelEditing}
                              className="p-1 text-gray-600 hover:bg-gray-50 rounded"
                              title="Cancel"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              onClick={() => startEditing(location)}
                              className="p-1 text-blue-600 hover:bg-blue-50 rounded"
                              title="Edit"
                            >
                              <Edit className="w-4 h-4" />
                            </button>
                            
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          
          {kenyaOfficeLocations.length === 0 && (
            <div className="text-center py-8">
              <p className="text-gray-500">No office locations data available</p>
            </div>
          )}
        </div>
      </div>

      {/* Add New Office Modal */}
      {showAddForm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-lg w-full max-w-md">
            <div className="p-6 border-b border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900">Add New Office</h3>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Office Name</label>
                <input
                  type="text"
                  value={newOffice.name || ''}
                  onChange={(e) => setNewOffice({...newOffice, name: e.target.value})}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-xs"
                  placeholder="e.g., Nairobi Headquarters"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Town</label>
                <input
                  type="text"
                  value={newOffice.town || ''}
                  onChange={(e) => setNewOffice({...newOffice, town: e.target.value})}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-xs"
                  placeholder="e.g., Nairobi"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">County</label>
                <input
                  type="text"
                  value={newOffice.county || ''}
                  onChange={(e) => setNewOffice({...newOffice, county: e.target.value})}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-xs"
                  placeholder="e.g., Nairobi County"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Hiring Status</label>
                <select
                  value={newOffice.hiring_status || ''}
                  onChange={(e) => setNewOffice({...newOffice, hiring_status: e.target.value})}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-xs"
                >
                  <option value="active">Active</option>
                  <option value="actively-hiring">Actively Hiring</option>
                  <option value="selective-hiring">Selective Hiring</option>
                  <option value="not-hiring">Not Hiring</option>
                </select>
              </div>
            </div>
            <div className="p-6 border-t border-gray-200 flex justify-end gap-3">
              <button
                onClick={() => setShowAddForm(false)}
                className="px-4 py-2 text-xs border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={addNewOffice}
                className="px-4 py-2 text-xs bg-[#47d475] text-white rounded-md hover:bg-[#3bc067]"
                disabled={!newOffice.name}
              >
                Add Office
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};