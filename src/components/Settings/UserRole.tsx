import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  User,
  Users,
  UserPlus,
  Shield,
  Settings,
  Eye,
  EyeOff,
  Edit,
  Trash2,
  Search,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Check,
  X,
  MoreVertical,
  Key,
  Mail,
  RefreshCw,
  AlertTriangle,
  MapPin,
  Lock,
  ShieldCheck,
  Activity,
  ArrowUpRight,
  Filter,
  CheckCircle2,
  Calendar,
  Globe,
  Fingerprint
} from 'lucide-react';
import { supabaseAdmin } from '../../lib/supabase';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';

// Role definitions
const ROLES = {
  ADMIN: {
    label: 'Admin',
    description: 'Full access to all features and settings across all locations',
    icon: <Shield className="w-4 h-4 text-purple-400" />,
    requiresLocation: false,
    color: 'bg-indigo-900 text-white'
  },
  REGIONAL: {
    label: 'Regional Manager',
    description: 'Can manage users across multiple locations or regions',
    icon: <MapPin className="w-4 h-4 text-violet-400" />,
    requiresLocation: true,
    color: 'bg-violet-900 text-white'
  },
  MANAGER: {
    label: 'Manager',
    description: 'Can manage users and content for specific locations',
    icon: <Settings className="w-4 h-4 text-blue-400" />,
    requiresLocation: true,
    color: 'bg-blue-900 text-white'
  },
  OPERATIONS: {
    label: 'Operations',
    description: 'Can manage operational tasks for specific locations',
    icon: <Settings className="w-4 h-4 text-indigo-400" />,
    requiresLocation: true,
    color: 'bg-indigo-800 text-white'
  },
  STAFF: {
    label: 'Staff',
    description: 'Standard access with limited permissions for specific locations',
    icon: <User className="w-4 h-4 text-emerald-400" />,
    requiresLocation: true,
    color: 'bg-emerald-900 text-white'
  },
  HR: {
    label: 'HR',
    description: 'Read-only access to location-specific features',
    icon: <Eye className="w-4 h-4 text-gray-400" />,
    requiresLocation: true,
    color: 'bg-gray-800 text-white'
  },
  CHECKER: {
    label: 'Checker',
    description: 'Read-only access to location-specific features',
    icon: <Eye className="w-4 h-4 text-orange-400" />,
    requiresLocation: true,
    color: 'bg-orange-800 text-white'
  }
};

const MULAR_CREDIT_ROLES = ['MANAGER', 'REGIONAL'];

const UserCard = ({
  user,
  onEdit,
  onDelete,
  onResetPassword
}: {
  user: any;
  onEdit: (user: any) => void;
  onDelete: (user: any) => void;
  onResetPassword: (user: any) => void;
}) => {
  const [showOptions, setShowOptions] = useState(false);
  const isMularCreditEmail = user.email.toLowerCase().endsWith('@mularcredit.com');
  const needsRoleUpdate = isMularCreditEmail && !MULAR_CREDIT_ROLES.includes(user.role);

  return (
    <motion.div
      layout
      whileHover={{ y: -4 }}
      className={`relative bg-white rounded-[2rem] p-6 border transition-all group ${needsRoleUpdate ? 'border-orange-200 bg-orange-50/30' : 'border-gray-100 hover:border-indigo-100'
        }`}
    >
      {needsRoleUpdate && (
        <div className="absolute top-4 right-4 animate-pulse">
          <AlertTriangle className="w-5 h-5 text-orange-500" />
        </div>
      )}

      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-indigo-600 text-white flex items-center justify-center font-black text-lg shadow-lg shadow-indigo-100">
            {user.email[0].toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-black text-gray-900 truncate uppercase">{user.email.split('@')[0]}</h3>
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest truncate">{user.email}</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="p-3 bg-gray-50 rounded-xl border border-gray-100">
            <p className="text-[8px] font-black text-gray-400 uppercase tracking-widest mb-1">Security Role</p>
            <div className="flex items-center gap-2">
              <span className="text-[9px] font-black text-indigo-600 uppercase italic">
                {ROLES[user.role as keyof typeof ROLES]?.label || user.role}
              </span>
            </div>
          </div>
          <div className="p-3 bg-gray-50 rounded-xl border border-gray-100">
            <p className="text-[8px] font-black text-gray-400 uppercase tracking-widest mb-1">Status</p>
            <div className="flex items-center gap-1.5">
              <div className={`w-1.5 h-1.5 rounded-full ${user.active ? 'bg-emerald-500' : 'bg-gray-300'}`} />
              <span className="text-[9px] font-black text-gray-700 uppercase">{user.active ? 'Active' : 'Locked'}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between pt-2">
          <div className="flex flex-col">
            <span className="text-[8px] font-black text-gray-400 uppercase tracking-widest">Last Activity</span>
            <span className="text-[9px] font-bold text-gray-600 uppercase">
              {user.last_sign_in_at ? new Date(user.last_sign_in_at).toLocaleDateString() : 'Inactive'}
            </span>
          </div>
          <div className="flex gap-2">
            <button onClick={() => onEdit(user)} className="p-2 bg-gray-50 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all">
              <Edit className="w-4 h-4" />
            </button>
            <button onClick={() => onResetPassword(user)} className="p-2 bg-gray-50 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-all">
              <Key className="w-4 h-4" />
            </button>
            <button onClick={() => onDelete(user)} className="p-2 bg-gray-50 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all">
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </motion.div>
  );
};

export default function UserRolesSettings() {
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedRole, setSelectedRole] = useState<string>('ALL');
  const [selectedStatus, setSelectedStatus] = useState<string>('ALL');
  const [showAddUserModal, setShowAddUserModal] = useState(false);
  const [editingUser, setEditingUser] = useState<any | null>(null);
  const [resettingPasswordUser, setResettingPasswordUser] = useState<any | null>(null);
  const [showBulkUpdateModal, setShowBulkUpdateModal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [usersPerPage] = useState(12);
  const navigate = useNavigate();

  const [mfaEnabled, setMfaEnabled] = useState(false);
  const [mfaLoading, setMfaLoading] = useState(false);
  const [mfaFetched, setMfaFetched] = useState(false);

  useEffect(() => {
    fetchMfaSetting();
    fetchUsers();
  }, []);

  const fetchMfaSetting = async () => {
    try {
      const { data, error } = await supabaseAdmin
        .from('system_settings')
        .select('mfa_enabled')
        .eq('id', 1)
        .single();
      if (!error && data) setMfaEnabled(data.mfa_enabled ?? false);
    } catch (e) {
      console.error(e);
    } finally {
      setMfaFetched(true);
    }
  };

  const fetchUsers = async () => {
    setLoading(true);
    try {
      let allUsers: any[] = [];
      let page = 1;
      let hasMore = true;

      while (hasMore) {
        const { data: { users }, error } = await supabaseAdmin.auth.admin.listUsers({
          page: page,
          perPage: 100
        });
        if (error) throw error;
        if (users.length === 0) hasMore = false;
        else {
          allUsers = [...allUsers, ...users];
          page++;
        }
      }

      setUsers(allUsers.map((user: any) => ({
        id: user.id,
        email: user.email,
        role: user.user_metadata?.role || 'STAFF',
        active: !user.banned_at && user.email_confirmed_at !== null,
        last_sign_in_at: user.last_sign_in_at,
        created_at: user.created_at,
        location: user.user_metadata?.location || null,
        user_metadata: user.user_metadata
      })));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleMfaToggle = async () => {
    const newValue = !mfaEnabled;
    setMfaLoading(true);
    try {
      const { error } = await supabaseAdmin
        .from('system_settings')
        .update({ mfa_enabled: newValue })
        .eq('id', 1);
      if (error) throw error;
      setMfaEnabled(newValue);
      toast.success(`MFA verification ${newValue ? 'enabled' : 'disabled'}`);
    } catch (e: any) {
      toast.error('Failed to update security protocol');
    } finally {
      setMfaLoading(false);
    }
  };

  const filteredUsers = users.filter(user => {
    const matchesSearch = user.email.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesRole = selectedRole === 'ALL' || user.role === selectedRole;
    const matchesStatus = selectedStatus === 'ALL' || (selectedStatus === 'ACTIVE' && user.active) || (selectedStatus === 'INACTIVE' && !user.active);
    return matchesSearch && matchesRole && matchesStatus;
  });

  const usersNeedingUpdate = users.filter(user =>
    user.email.toLowerCase().endsWith('@mularcredit.com') && !MULAR_CREDIT_ROLES.includes(user.role)
  );

  const handleDeleteUser = async (user: any) => {
    if (!window.confirm(`Permanently delete governance node ${user.email}?`)) return;
    try {
      setLoading(true);
      const { error } = await supabaseAdmin.auth.admin.deleteUser(user.id);
      if (error) throw error;
      setUsers(users.filter(u => u.id !== user.id));
      toast.success('Governance node terminated');
    } catch (err: any) {
      toast.error('Failed to revoke access');
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async (user: any, passwordOrEmail: string) => {
    try {
      setLoading(true);
      if (typeof passwordOrEmail === 'string' && passwordOrEmail.includes('@')) {
        const { error } = await supabaseAdmin.auth.admin.generateLink({ type: 'recovery', email: passwordOrEmail });
        if (error) throw error;
        toast.success(`Recovery payload dispatched to ${user.email}`);
      } else {
        const { error } = await supabaseAdmin.auth.admin.updateUserById(user.id, { password: passwordOrEmail });
        if (error) throw error;
        toast.success('Security credentials updated');
      }
      setResettingPasswordUser(null);
    } catch (err: any) {
      toast.error('Protocol failure');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveUser = async (userData: any) => {
    try {
      let finalRole = userData.role;
      if (userData.email.toLowerCase().endsWith('@mularcredit.com')) {
        if (!MULAR_CREDIT_ROLES.includes(userData.role)) finalRole = 'MANAGER';
      }

      if (editingUser) {
        const { error } = await supabaseAdmin.auth.admin.updateUserById(editingUser.id, {
          email: userData.email,
          user_metadata: { ...editingUser.user_metadata, role: finalRole, location: userData.location || null },
          ban_duration: userData.active ? 'none' : 'permanent'
        });
        if (error) throw error;
        setUsers(users.map(u => u.id === editingUser.id ? { ...u, email: userData.email, role: finalRole, active: userData.active, location: userData.location || null } : u));
        setEditingUser(null);
        toast.success('Registry updated');
      } else {
        const { data, error } = await supabaseAdmin.auth.admin.createUser({
          email: userData.email,
          password: userData.password,
          email_confirm: true,
          user_metadata: { role: finalRole, location: userData.location || null }
        });
        if (error) throw error;
        setUsers([...users, { id: data.user.id, email: userData.email, role: finalRole, active: true, last_sign_in_at: null, created_at: new Date().toISOString(), location: userData.location || null }]);
        setShowAddUserModal(false);
        toast.success('New node added to registry');
      }
    } catch (err: any) {
      toast.error('Failed to finalize node');
    }
  };

  // Pagination logic
  const indexOfLastUser = currentPage * usersPerPage;
  const currentUsers = filteredUsers.slice(indexOfLastUser - usersPerPage, indexOfLastUser);
  const totalPages = Math.ceil(filteredUsers.length / usersPerPage);

  return (
    <div className="space-y-8 pb-12">
      {/* Premium Header Card */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="md:col-span-1 bg-gradient-to-br from-indigo-600 to-indigo-800 rounded-[2.5rem] p-8 text-white shadow-xl shadow-indigo-100 relative overflow-hidden group"
        >
          <div className="relative z-10 space-y-6">
            <div className="space-y-1">
              <h2 className="text-2xl font-black tracking-tight italic uppercase">Identity Hub</h2>
              <p className="text-indigo-100 text-[10px] font-black uppercase tracking-[0.2em] opacity-80">Access Control & Governance</p>
            </div>

            <div className="flex items-center gap-3">
              <div className="p-3 bg-white/10 rounded-2xl backdrop-blur-md">
                <Fingerprint className="w-5 h-5 text-indigo-300" />
              </div>
              <span className="text-[10px] font-black uppercase tracking-widest text-indigo-100 italic">Auth Level 9 Root</span>
            </div>

            <div className="flex flex-col gap-2 pt-4">
              <div className="flex items-center justify-between text-[10px] font-black uppercase tracking-widest border-b border-white/10 pb-2">
                <span>Total Registry</span>
                <span className="text-white font-black">{users.length}</span>
              </div>
              <div className="flex items-center justify-between text-[10px] font-black uppercase tracking-widest text-white/50 pt-2">
                <span>Active Nodes</span>
                <span>{users.filter(u => u.active).length}</span>
              </div>
            </div>
          </div>
          <ShieldCheck className="absolute -bottom-10 -right-10 w-48 h-48 text-white/5" />
        </motion.div>

        {/* Security Controls */}
        <div className="lg:col-span-3 bg-white rounded-[2.5rem] border border-gray-100 shadow-sm p-8 flex flex-col justify-center">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
            <div className="space-y-6">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg">
                  <Lock className="w-4 h-4" />
                </div>
                <h3 className="text-lg font-black text-gray-900 uppercase italic">Security Matrix</h3>
              </div>
              <div className="flex items-center justify-between p-6 bg-gray-50 rounded-[2rem] border border-gray-100 group transition-all hover:bg-white hover:shadow-xl hover:shadow-indigo-50">
                <div className="space-y-1">
                  <p className="text-[10px] font-black text-gray-900 uppercase tracking-widest transition-colors group-hover:text-indigo-600">Dual-Factor SMS Auth</p>
                  <p className="text-[9px] font-bold text-gray-400 uppercase tracking-tighter">Enforced for Admin/Checker Roles</p>
                </div>
                <button
                  onClick={handleMfaToggle}
                  disabled={mfaLoading || !mfaFetched}
                  className={`relative inline-flex h-7 w-12 flex-shrink-0 cursor-pointer rounded-full border-4 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${mfaEnabled ? 'bg-indigo-600' : 'bg-gray-200'}`}
                >
                  <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${mfaEnabled ? 'translate-x-5' : 'translate-x-0'}`} />
                </button>
              </div>
            </div>

            <div className="flex flex-col justify-end gap-4">
              <div className="flex items-center gap-3">
                <button onClick={() => setShowAddUserModal(true)} className="flex-1 py-4 bg-indigo-600 text-white rounded-[2rem] text-[10px] font-black uppercase tracking-[0.2em] shadow-xl shadow-indigo-100 hover:bg-indigo-700 transition-all flex items-center justify-center gap-3">
                  <UserPlus className="w-4 h-4" />
                  Provision New Node
                </button>
              </div>
              {usersNeedingUpdate.length > 0 && (
                <button onClick={() => setShowBulkUpdateModal(true)} className="flex items-center justify-center gap-2 py-3 bg-amber-50 text-amber-600 rounded-[1.5rem] border border-amber-100 text-[9px] font-black uppercase tracking-widest hover:bg-amber-100 transition-all animate-pulse">
                  <AlertTriangle className="w-4 h-4" />
                  {usersNeedingUpdate.length} Nodes Require Upgrades
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Registry Filters */}
      <div className="bg-white rounded-[3rem] border border-gray-100 shadow-sm overflow-hidden min-h-[600px] flex flex-col">
        <div className="p-8 border-b border-gray-50 flex items-center justify-between bg-gray-50/50">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-6 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="SEARCH REGISTRY BY IDENTITY..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-14 pr-6 py-4 bg-white border border-gray-100 rounded-[2rem] text-[10px] font-black uppercase tracking-widest focus:ring-4 focus:ring-indigo-100 transition-all font-mono shadow-sm"
            />
          </div>

          <div className="flex items-center gap-2">
            <select
              value={selectedRole}
              onChange={(e) => setSelectedRole(e.target.value)}
              className="px-6 py-3.5 bg-white border border-gray-100 rounded-2xl text-[9px] font-black uppercase tracking-widest focus:ring-4 focus:ring-indigo-50 transition-all outline-none shadow-sm"
            >
              <option value="ALL">All Authority Levels</option>
              {Object.keys(ROLES).map(role => <option key={role} value={role}>{role}</option>)}
            </select>
            <select
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
              className="px-6 py-3.5 bg-white border border-gray-100 rounded-2xl text-[9px] font-black uppercase tracking-widest focus:ring-4 focus:ring-indigo-50 transition-all outline-none shadow-sm"
            >
              <option value="ALL">All Registry States</option>
              <option value="ACTIVE">Authorized Only</option>
              <option value="INACTIVE">Deauthorized</option>
            </select>
          </div>
        </div>

        <div className="p-10 flex-1">
          {loading ? (
            <div className="h-full flex flex-col items-center justify-center space-y-4">
              <RefreshCw className="w-10 h-10 text-indigo-600 animate-spin" />
              <span className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">Synchronizing Registry...</span>
            </div>
          ) : filteredUsers.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              {currentUsers.map(user => (
                <UserCard key={user.id} user={user} onEdit={setEditingUser} onDelete={handleDeleteUser} onResetPassword={setResettingPasswordUser} />
              ))}
            </div>
          ) : (
            <div className="h-full flex flex-col items-center justify-center space-y-6">
              <div className="w-24 h-24 bg-gray-50 rounded-[2.5rem] flex items-center justify-center border border-gray-100 shadow-inner">
                <Users className="w-10 h-10 text-gray-200" />
              </div>
              <div className="text-center space-y-1">
                <h3 className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">Registry Fragmented</h3>
                <p className="text-[9px] font-bold text-gray-300 uppercase italic">Zero nodes match your isolation criteria</p>
              </div>
            </div>
          )}
        </div>

        {totalPages > 1 && (
          <div className="p-8 border-t border-gray-50 bg-gray-50/30 flex items-center justify-between">
            <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Page {currentPage} of {totalPages}</span>
            <div className="flex gap-2">
              <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1} className="p-3 bg-white border border-gray-100 rounded-xl text-gray-400 hover:text-indigo-600 disabled:opacity-30">
                <ChevronLeft className="w-5 h-5" />
              </button>
              <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages} className="p-3 bg-white border border-gray-100 rounded-xl text-gray-400 hover:text-indigo-600 disabled:opacity-30">
                <ChevronRight className="w-5 h-5" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Provisioning/Editing Modal */}
      <AnimatePresence>
        {(showAddUserModal || editingUser) && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 sm:p-12 overflow-y-auto">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => { setShowAddUserModal(false); setEditingUser(null); }} className="fixed inset-0 bg-gray-900/60 backdrop-blur-md" />
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white rounded-[3rem] shadow-2xl w-full max-w-lg overflow-hidden flex flex-col relative z-10 border border-white/20"
            >
              <div className="p-8 border-b border-gray-50 flex items-center justify-between bg-gray-50/50">
                <div className="space-y-1">
                  <h3 className="text-2xl font-black text-gray-900 tracking-tight uppercase italic">{editingUser ? 'Finalize Node' : 'Provision Node'}</h3>
                  <p className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">Security Protocol Configuration</p>
                </div>
                <button onClick={() => { setShowAddUserModal(false); setEditingUser(null); }} className="p-4 bg-white text-gray-400 hover:text-red-500 rounded-2xl shadow-sm border border-gray-100 transition-colors">
                  <X className="w-6 h-6" />
                </button>
              </div>
              <form onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); handleSaveUser(Object.fromEntries(fd)); }} className="p-10 space-y-8">
                <div className="space-y-4">
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Identity Payload</label>
                  <input name="email" defaultValue={editingUser?.email} required type="email" placeholder="EMAIL@PROTOCOL.COM" className="w-full p-6 bg-gray-50 border-none rounded-[2rem] text-[10px] font-black uppercase tracking-widest focus:ring-4 focus:ring-indigo-100 transition-all font-mono shadow-inner" disabled={!!editingUser} />
                </div>

                {!editingUser && (
                  <div className="space-y-4">
                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Access Credentials</label>
                    <input name="password" required type="password" placeholder="MIN 8 ALPHA-NUMERIC" className="w-full p-6 bg-gray-50 border-none rounded-[2rem] text-[10px] font-black uppercase tracking-widest focus:ring-4 focus:ring-indigo-100 transition-all font-mono shadow-inner" />
                  </div>
                )}

                <div className="space-y-4">
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Authority Clearance</label>
                  <div className="grid grid-cols-2 gap-3">
                    {Object.keys(ROLES).map(r => (
                      <label key={r} className="relative cursor-pointer">
                        <input type="radio" name="role" value={r} defaultChecked={(editingUser?.role || 'STAFF') === r} className="sr-only peer" />
                        <div className="p-4 rounded-2xl border border-gray-100 text-[9px] font-black uppercase text-center transition-all peer-checked:bg-indigo-600 peer-checked:text-white peer-checked:shadow-lg peer-checked:shadow-indigo-100">
                          {r}
                        </div>
                      </label>
                    ))}
                  </div>
                </div>

                <div className="flex items-center justify-between p-6 bg-gray-50 rounded-[2rem] border border-gray-100">
                  <div className="space-y-1">
                    <p className="text-[10px] font-black text-gray-900 uppercase tracking-widest">Active State</p>
                    <p className="text-[9px] font-bold text-gray-400 uppercase tracking-tighter">Toggle Node Visibility</p>
                  </div>
                  <input type="checkbox" name="active" defaultChecked={editingUser ? editingUser.active : true} className="w-12 h-6 bg-gray-200 rounded-full appearance-none checked:bg-emerald-500 transition-all relative cursor-pointer after:content-[''] after:absolute after:top-1 after:left-1 after:w-4 after:h-4 after:bg-white after:rounded-full after:transition-all checked:after:left-7" />
                </div>

                <div className="pt-6 flex gap-4">
                  <button type="button" onClick={() => { setShowAddUserModal(false); setEditingUser(null); }} className="px-10 py-5 bg-white border border-gray-200 text-[10px] font-black uppercase tracking-[0.2em] text-gray-400 hover:text-gray-600 rounded-[2rem] transition-all">Abort</button>
                  <button type="submit" className="flex-1 py-5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-[2rem] text-[10px] font-black uppercase tracking-[0.2em] shadow-xl shadow-indigo-100 transition-all">Authorize Node</button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}