import React, { useState, useEffect } from 'react';
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
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Check,
  X,
  MoreVertical,
  Key,
  MapPin,
  Lock
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { assertEmployeeForStaffLogin } from '../../lib/staffEmployee';
import { adminApi } from '../../lib/adminApi';
import toast from 'react-hot-toast';
import { Link } from 'react-router-dom';
import { Card, Button, SearchInput, StatusPill, EmptyState } from '../UI';
import type { StatusTone } from '../UI';

// Role definitions
const ROLES = {
  ADMIN: {
    label: 'Admin',
    description: 'Full access to all features and settings across all locations',
    icon: <Shield className="w-4 h-4 text-purple-500" />,
    requiresLocation: false
  },
  REGIONAL: {
    label: 'Regional Manager',
    description: 'Can manage users across multiple locations or regions',
    icon: <MapPin className="w-4 h-4 text-violet-500" />,
    requiresLocation: true
  },
  MANAGER: {
    label: 'Manager',
    description: 'Can manage users and content for specific locations',
    icon: <Settings className="w-4 h-4 text-blue-500" />,
    requiresLocation: true
  },
  OPERATIONS: {
    label: 'Operations',
    description: 'Can manage operational tasks for specific locations',
    icon: <Settings className="w-4 h-4 text-indigo-500" />,
    requiresLocation: true
  },
  STAFF: {
    label: 'Staff',
    description: 'Standard access with limited permissions for specific locations',
    icon: <User className="w-4 h-4 text-green-500" />,
    requiresLocation: true
  },
  HR: {
    label: 'HR',
    description: 'Read-only access to location-specific features',
    icon: <Eye className="w-4 h-4 text-gray-500" />,
    requiresLocation: true
  },
  CHECKER: {
    label: 'Checker',
    description: 'Read-only access to location-specific features',
    icon: <Eye className="w-4 h-4 text-orange-500" />,
    requiresLocation: true
  }
};

const STATUS_TONE: Record<string, StatusTone> = {
  ACTIVE: 'success',
  SUSPENDED: 'warning',
  DEACTIVATED: 'danger'
};

const ROLE_TONE: Record<string, StatusTone> = {
  ADMIN: 'purple',
  REGIONAL: 'purple',
  MANAGER: 'info',
  CHECKER: 'warning',
  OPERATIONS: 'info',
  STAFF: 'success',
  HR: 'neutral'
};

const StatusBadge = ({ status }: { status: string }) => (
  <StatusPill
    label={status === 'ACTIVE' ? 'Active' : status === 'SUSPENDED' ? 'Suspended' : 'Deactivated'}
    tone={STATUS_TONE[status] || 'neutral'}
  />
);

const RoleBadge = ({ role }: { role: keyof typeof ROLES }) => {
  const roleInfo = ROLES[role] || ROLES.STAFF;
  return <StatusPill label={roleInfo.label} tone={ROLE_TONE[role] || 'neutral'} />;
};

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
  const [showDropdown, setShowDropdown] = useState(false);

  return (
    <Card padding="sm" className="!p-4">
      <div className="flex justify-between items-start gap-2">
        <div className="min-w-0">
          <h3 className="m-0 text-xs font-bold text-ink truncate" title={user.email}>
            {user.email}
          </h3>
          <p className="m-0 text-[10.5px] text-subtle truncate">
            {user.last_sign_in_at ? `Last active: ${new Date(user.last_sign_in_at).toLocaleDateString()}` : 'Never active'}
          </p>
        </div>

        <div className="relative flex-shrink-0">
          <button
            type="button"
            aria-label={`Actions for ${user.email}`}
            aria-haspopup="menu"
            aria-expanded={showDropdown}
            onClick={() => setShowDropdown(!showDropdown)}
            className="text-subtle hover:text-ink p-1 rounded"
          >
            <MoreVertical className="w-4 h-4" />
          </button>

          {showDropdown && (
            <div role="menu" className="absolute right-0 mt-1 w-44 bg-white rounded-xl shadow-lg z-10 border border-border py-1">
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  onEdit(user);
                  setShowDropdown(false);
                }}
                className="flex items-center gap-2 px-3 py-2 text-xs text-ink hover:bg-background w-full text-left"
              >
                <Edit className="w-3.5 h-3.5" />
                Edit User
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  onResetPassword(user);
                  setShowDropdown(false);
                }}
                className="flex items-center gap-2 px-3 py-2 text-xs text-status-info hover:bg-status-info-tint w-full text-left"
              >
                <Key className="w-3.5 h-3.5" />
                Reset Password
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  onDelete(user);
                  setShowDropdown(false);
                }}
                className="flex items-center gap-2 px-3 py-2 text-xs text-status-danger hover:bg-orange-tint w-full text-left"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Delete User
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mt-3">
        <StatusBadge status={user.account_status} />
        <RoleBadge role={user.role || 'STAFF'} />
      </div>
    </Card>
  );
};

const Pagination = ({
  currentPage,
  totalPages,
  onPageChange
}: {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void
}) => {
  const maxVisiblePages = 5;

  const getPageNumbers = () => {
    if (totalPages <= maxVisiblePages) {
      return Array.from({ length: totalPages }, (_, i) => i + 1);
    }

    const half = Math.floor(maxVisiblePages / 2);
    let start = Math.max(currentPage - half, 1);
    const end = Math.min(start + maxVisiblePages - 1, totalPages);

    if (end - start + 1 < maxVisiblePages) {
      start = Math.max(end - maxVisiblePages + 1, 1);
    }

    const pages = [];
    for (let i = start; i <= end; i++) {
      pages.push(i);
    }

    return pages;
  };

  const pages = getPageNumbers();

  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3">
      <p className="m-0 text-xs text-muted-foreground">
        Page <span className="font-semibold text-ink">{currentPage}</span> of <span className="font-semibold text-ink">{totalPages}</span>
      </p>
      <nav className="inline-flex items-center gap-1" aria-label="Pagination">
        <button
          type="button"
          onClick={() => onPageChange(Math.max(1, currentPage - 1))}
          disabled={currentPage === 1}
          className="p-1.5 rounded-lg border border-border bg-white text-muted-foreground hover:bg-secondary disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <span className="sr-only">Previous</span>
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        </button>

        {pages.map((page) => (
          <button
            type="button"
            key={page}
            onClick={() => onPageChange(page)}
            aria-current={currentPage === page ? 'page' : undefined}
            className={`min-w-[2rem] px-2.5 py-1.5 text-xs rounded-lg border ${currentPage === page
              ? 'bg-green-tint border-brand text-brand font-semibold'
              : 'bg-white border-border text-ink hover:bg-secondary'
              }`}
          >
            {page}
          </button>
        ))}

        <button
          type="button"
          onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
          disabled={currentPage === totalPages}
          className="p-1.5 rounded-lg border border-border bg-white text-muted-foreground hover:bg-secondary disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <span className="sr-only">Next</span>
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </button>
      </nav>
    </div>
  );
};

interface UserData {
  email: string;
  role: string;
  password?: string;
  confirmPassword?: string;
  location: string | null;
  account_status: string;
}

const UserEditModal = ({
  user,
  onClose,
  onSave
}: {
  user: UserData | null;
  onClose: () => void;
  onSave: (user: UserData) => void
}) => {
  const [editedUser, setEditedUser] = useState<UserData>(user ? {
    ...user,
    password: '',
    confirmPassword: ''
  } : {
    email: '',
    role: 'STAFF',
    password: '',
    confirmPassword: '',
    location: null,
    account_status: 'ACTIVE'
  });
  const [showPassword, setShowPassword] = useState(false);
  const [passwordError, setPasswordError] = useState('');

  useEffect(() => {
    if (user) {
      setEditedUser({ ...user, password: '', confirmPassword: '' });
    }
  }, [user]);

  const handleRoleChange = (role: keyof typeof ROLES) => {
    setEditedUser({ ...editedUser, role });
  };

  const validatePassword = () => {
    if (!user && !editedUser.password) {
      setPasswordError('Password is required');
      return false;
    }

    if (editedUser.password && editedUser.password.length < 6) {
      setPasswordError('Password must be at least 6 characters');
      return false;
    }

    if (editedUser.password !== editedUser.confirmPassword) {
      setPasswordError('Passwords do not match');
      return false;
    }

    setPasswordError('');
    return true;
  };

  const handleSave = () => {
    if (!validatePassword()) return;

    // Don't include password fields if not creating a new user
    const userToSave = user ? {
      ...editedUser,
      password: undefined,
      confirmPassword: undefined
    } : editedUser;

    onSave(userToSave);
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-lg w-full max-w-md">
        <div className="flex justify-between items-center p-4 border-b">
          <h3 className="text-lg font-semibold text-gray-900">
            {user ? 'Edit User' : 'Add New User'}
          </h3>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Email</label>
            <input
              type="email"
              value={editedUser.email}
              onChange={(e) => setEditedUser({ ...editedUser, email: e.target.value })}
              className="w-full bg-gray-50 border border-gray-300 rounded-lg px-3 py-2 text-xs"
              placeholder="user@example.com"
              disabled={!!user}
            />
          </div>

          {!user && (
            <>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Password</label>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    value={editedUser.password}
                    onChange={(e) => setEditedUser({ ...editedUser, password: e.target.value })}
                    className="w-full bg-gray-50 border border-gray-300 rounded-lg px-3 py-2 text-xs pr-10"
                    placeholder="••••••"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute inset-y-0 right-0 pr-3 flex items-center"
                  >
                    {showPassword ? (
                      <EyeOff className="h-4 w-4 text-gray-400" />
                    ) : (
                      <Eye className="h-4 w-4 text-gray-400" />
                    )}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Confirm Password</label>
                <input
                  type={showPassword ? "text" : "password"}
                  value={editedUser.confirmPassword}
                  onChange={(e) => setEditedUser({ ...editedUser, confirmPassword: e.target.value })}
                  className="w-full bg-gray-50 border border-gray-300 rounded-lg px-3 py-2 text-xs"
                  placeholder="••••••"
                />
              </div>

              {passwordError && (
                <p className="text-xs text-red-500">{passwordError}</p>
              )}
            </>
          )}

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Role</label>
            <div className="grid grid-cols-2 gap-2">
              {(Object.keys(ROLES) as Array<keyof typeof ROLES>).map((role) => {
                const roleInfo = ROLES[role];

                return (
                  <button
                    key={role}
                    onClick={() => handleRoleChange(role)}
                    className={`p-2 border rounded-lg text-xs font-medium ${editedUser.role === role ?
                      (role === 'ADMIN' ? 'border-purple-500 bg-purple-50 text-purple-700' :
                        role === 'REGIONAL' ? 'border-violet-500 bg-violet-50 text-violet-700' :
                          role === 'MANAGER' ? 'border-blue-500 bg-blue-50 text-blue-700' :
                            role === 'CHECKER' ? 'border-orange-500 bg-orange-50 text-orange-700' :
                              role === 'OPERATIONS' ? 'border-indigo-500 bg-indigo-50 text-indigo-700' :
                                role === 'STAFF' ? 'border-green-500 bg-green-50 text-green-700' :
                                  'border-gray-500 bg-gray-50 text-gray-700') :
                      'border-gray-200 hover:bg-gray-50'
                      }`}
                  >
                    {roleInfo.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="p-3 bg-gray-50 rounded-lg">
            <label className="block text-xs font-medium text-gray-900 mb-2">Account Status</label>
            <div className="grid grid-cols-3 gap-2">
              <button
                onClick={() => setEditedUser({ ...editedUser, account_status: 'ACTIVE' })}
                className={`p-2 border rounded-lg text-xs font-medium transition-colors ${editedUser.account_status === 'ACTIVE' ? 'border-green-500 bg-green-50 text-green-700' : 'border-gray-200 hover:bg-gray-50 text-gray-700'}`}
              >
                Active
              </button>
              <button
                onClick={() => setEditedUser({ ...editedUser, account_status: 'SUSPENDED' })}
                className={`p-2 border rounded-lg text-xs font-medium transition-colors ${editedUser.account_status === 'SUSPENDED' ? 'border-orange-500 bg-orange-50 text-orange-700' : 'border-gray-200 hover:bg-gray-50 text-gray-700'}`}
              >
                Suspended
              </button>
              <button
                onClick={() => setEditedUser({ ...editedUser, account_status: 'DEACTIVATED' })}
                className={`p-2 border rounded-lg text-xs font-medium transition-colors ${editedUser.account_status === 'DEACTIVATED' ? 'border-red-500 bg-red-50 text-red-700' : 'border-gray-200 hover:bg-gray-50 text-gray-700'}`}
              >
                Deactivated
              </button>
            </div>
            <p className="text-xs text-gray-500 mt-2">
              {editedUser.account_status === 'ACTIVE' ? 'User can sign in normally.' :
                editedUser.account_status === 'SUSPENDED' ? 'User is temporarily suspended and cannot sign in.' :
                  'User is permanently deactivated and cannot sign in.'}
            </p>
          </div>
        </div>

        <div className="p-4 border-t flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-xs"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="px-4 py-2 rounded-lg text-xs flex items-center gap-2 bg-primary hover:bg-primary/90 text-white"
          >
            <Check className="w-4 h-4" />
            {user ? 'Save Changes' : 'Create User'}
          </button>
        </div>
      </div>
    </div>
  );
};

const ResetPasswordModal = ({
  user,
  onClose,
  onReset
}: {
  user: any | null;
  onClose: () => void;
  onReset: (email: string) => void
}) => {
  const [resetMethod, setResetMethod] = useState<'email' | 'manual'>('email');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const validatePassword = () => {
    if (resetMethod === 'manual') {
      if (!newPassword) {
        setPasswordError('Password is required');
        return false;
      }

      if (newPassword.length < 6) {
        setPasswordError('Password must be at least 6 characters');
        return false;
      }

      if (newPassword !== confirmPassword) {
        setPasswordError('Passwords do not match');
        return false;
      }
    }

    setPasswordError('');
    return true;
  };

  const handleReset = () => {
    if (!validatePassword()) return;

    if (resetMethod === 'email') {
      // Send password reset email
      onReset(user.email);
    } else {
      // Set manual password
      onReset(newPassword);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-lg w-full max-w-md">
        <div className="flex justify-between items-center p-4 border-b">
          <h3 className="text-lg font-semibold text-gray-900">
            Reset Password for {user?.email}
          </h3>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
            <p className="text-xs text-blue-700">
              Choose how you want to reset the password for this user.
            </p>
          </div>

          <div className="space-y-3">
            <label className="flex items-center gap-3 p-3 border border-gray-200 rounded-lg cursor-pointer hover:bg-gray-50">
              <input
                type="radio"
                name="resetMethod"
                value="email"
                checked={resetMethod === 'email'}
                onChange={() => setResetMethod('email')}
                className="text-primary focus:ring-primary"
              />
              <div>
                <p className="text-xs font-medium text-gray-900">Send Reset Email</p>
                <p className="text-xs text-gray-500">
                  User will receive an email with password reset instructions
                </p>
              </div>
            </label>

            <label className="flex items-center gap-3 p-3 border border-gray-200 rounded-lg cursor-pointer hover:bg-gray-50">
              <input
                type="radio"
                name="resetMethod"
                value="manual"
                checked={resetMethod === 'manual'}
                onChange={() => setResetMethod('manual')}
                className="text-primary focus:ring-primary"
              />
              <div>
                <p className="text-xs font-medium text-gray-900">Set Manual Password</p>
                <p className="text-xs text-gray-500">
                  Set a new password directly for the user
                </p>
              </div>
            </label>
          </div>

          {resetMethod === 'manual' && (
            <>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">New Password</label>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="w-full bg-gray-50 border border-gray-300 rounded-lg px-3 py-2 text-xs pr-10"
                    placeholder="••••••"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute inset-y-0 right-0 pr-3 flex items-center"
                  >
                    {showPassword ? (
                      <EyeOff className="h-4 w-4 text-gray-400" />
                    ) : (
                      <Eye className="h-4 w-4 text-gray-400" />
                    )}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Confirm Password</label>
                <input
                  type={showPassword ? "text" : "password"}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full bg-gray-50 border border-gray-300 rounded-lg px-3 py-2 text-xs"
                  placeholder="••••••"
                />
              </div>

              {passwordError && (
                <p className="text-xs text-red-500">{passwordError}</p>
              )}
            </>
          )}
        </div>

        <div className="p-4 border-t flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-xs"
          >
            Cancel
          </button>
          <button
            onClick={handleReset}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs flex items-center gap-2"
          >
            <Key className="w-4 h-4" />
            Reset Password
          </button>
        </div>
      </div>
    </div>
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
  const [currentPage, setCurrentPage] = useState(1);
  const [usersPerPage] = useState(12);

  // MFA Settings
  const [mfaEnabled, setMfaEnabled] = useState(false);
  const [mfaLoading, setMfaLoading] = useState(false);
  const [mfaFetched, setMfaFetched] = useState(false);

  // Fetch MFA setting from DB
  useEffect(() => {
    const fetchMfaSetting = async () => {
      try {
        const { supabase } = await import('../../lib/supabase');
        const { data, error } = await supabase
          .from('system_settings')
          .select('mfa_enabled')
          .eq('id', 1)
          .single();
        if (!error && data) {
          setMfaEnabled(data.mfa_enabled ?? false);
        }
      } catch (e) {
        console.error('Failed to fetch MFA setting:', e);
      } finally {
        setMfaFetched(true);
      }
    };
    fetchMfaSetting();
  }, []);

  const handleMfaToggle = async () => {
    const newValue = !mfaEnabled;
    setMfaLoading(true);
    try {
      const { supabase } = await import('../../lib/supabase');
      const { error } = await supabase
        .from('system_settings')
        .update({ mfa_enabled: newValue })
        .eq('id', 1);
      if (error) throw error;
      setMfaEnabled(newValue);
      toast.success(`MFA verification ${newValue ? 'enabled' : 'disabled'} successfully.`);
    } catch (e: any) {
      toast.error('Failed to update MFA setting: ' + (e.message || 'Unknown error'));
    } finally {
      setMfaLoading(false);
    }
  };



  // Fetch users from Supabase - FIXED to get all users
  useEffect(() => {
    const fetchUsers = async () => {
      setLoading(true);
      try {
        const users = await adminApi.listUsers();

        setUsers(users ?? []);
      } catch (err: any) {
        console.error('Error fetching users:', err);
        toast.error(err.message || 'Failed to load users');
      } finally {
        setLoading(false);
      }
    };

    fetchUsers();
  }, []);

  // Filter users based on search and filters
  const filteredUsers = users.filter(user => {
    const matchesSearch = user.email.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesRole = selectedRole === 'ALL' || user.role === selectedRole;
    const matchesStatus = selectedStatus === 'ALL' || user.account_status === selectedStatus;

    return matchesSearch && matchesRole && matchesStatus;
  });

  // Pagination logic
  const indexOfLastUser = currentPage * usersPerPage;
  const indexOfFirstUser = indexOfLastUser - usersPerPage;
  const currentUsers = filteredUsers.slice(indexOfFirstUser, indexOfLastUser);
  const totalPages = Math.ceil(filteredUsers.length / usersPerPage);

  const handleDeleteUser = async (user: any) => {
    if (!window.confirm(`Are you sure you want to delete ${user.email}? This action cannot be undone.`)) {
      return;
    }

    try {
      setLoading(true);
      await adminApi.deleteUser(user.id);

      setUsers(users.filter(u => u.id !== user.id));
      toast.success(`User ${user.email} deleted successfully`);
    } catch (err: any) {
      console.error('Error deleting user:', err);
      toast.error(err.message || 'Failed to delete user');
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async (user: any, passwordOrEmail: string) => {
    try {
      setLoading(true);

      if (typeof passwordOrEmail === 'string' && passwordOrEmail.includes('@')) {
        // Send password reset email
        await adminApi.sendResetEmail(user.id, `${window.location.origin}/update-password`);

        toast.success(`Password reset email sent to ${user.email}`);
      } else {
        // Set manual password
        await adminApi.updateUser(user.id, { password: passwordOrEmail });

        toast.success(`Password updated successfully for ${user.email}`);
      }

      setResettingPasswordUser(null);
    } catch (err: any) {
      console.error('Error resetting password:', err);
      toast.error(err.message || 'Failed to reset password');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveUser = async (userData: any) => {
    try {
      const finalUserData = userData;

      if (editingUser) {
        // Update existing user
        await adminApi.updateUser(editingUser.id, {
          email: finalUserData.email,
          role: finalUserData.role,
          account_status: finalUserData.account_status,
          location: ROLES[finalUserData.role as keyof typeof ROLES]?.requiresLocation ? finalUserData.location || null : null
        });

        setUsers(users.map(u => u.id === editingUser.id ? {
          ...u,
          email: finalUserData.email,
          role: finalUserData.role,
          account_status: finalUserData.account_status,
          location: finalUserData.location || null
        } : u));
        setEditingUser(null);
        toast.success(`User ${finalUserData.email} updated successfully`);
      } else {
        // A STAFF login needs a matching employees row (see assertEmployeeForStaffLogin).
        await assertEmployeeForStaffLogin(supabase, finalUserData.role, finalUserData.email);

        // Create new user with password
        const created = await adminApi.createUser({
          email: finalUserData.email,
          password: finalUserData.password,
          role: finalUserData.role,
          account_status: finalUserData.account_status,
          location: ROLES[finalUserData.role as keyof typeof ROLES]?.requiresLocation ? finalUserData.location || null : null
        });

        setUsers([...users, {
          id: created.id,
          email: finalUserData.email,
          role: finalUserData.role,
          account_status: finalUserData.account_status || 'ACTIVE',
          last_sign_in_at: null,
          created_at: new Date().toISOString(),
          location: finalUserData.location || null
        }]);
        setShowAddUserModal(false);
        toast.success(`User ${finalUserData.email} created successfully`);
      }
    } catch (err: any) {
      console.error('Error saving user:', err);
      toast.error(err.message || `Failed to ${editingUser ? 'update' : 'create'} user`);
    }
  };

  // Reset to first page when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, selectedRole, selectedStatus]);

  return (
    <div>
      <div className="space-y-5">

        {/* MFA */}
        <Card className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className={`w-[38px] h-[38px] shrink-0 rounded-tile flex items-center justify-center transition-colors ${mfaEnabled ? 'bg-green-tint text-brand' : 'bg-secondary text-muted-foreground'}`}>
              <Lock className="w-[17px] h-[17px]" strokeWidth={1.8} />
            </div>
            <div>
              <h2 id="mfa-title" className="m-0 text-[13.5px] font-bold text-ink">Two-Factor Authentication (MFA)</h2>
              <p className="m-0 text-[11.5px] text-muted-foreground max-w-[520px]">
                When enabled, Admin and Checker users must verify their identity via SMS code on every login.
                Disable temporarily if you are experiencing SMS delivery issues.
              </p>
              <p className={`m-0 mt-1 text-[11px] font-semibold ${mfaEnabled ? 'text-brand' : 'text-subtle'}`} role="status">
                {mfaFetched ? (mfaEnabled ? 'Active: SMS verification required on login' : 'Inactive: users skip SMS verification') : 'Loading...'}
              </p>
            </div>
          </div>
          <button
            id="mfa-toggle-btn"
            type="button"
            onClick={handleMfaToggle}
            disabled={mfaLoading || !mfaFetched}
            role="switch"
            aria-checked={mfaEnabled}
            aria-labelledby="mfa-title"
            className={`relative inline-flex h-[22px] w-10 flex-shrink-0 cursor-pointer rounded-full transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed ${mfaEnabled ? 'bg-brand' : 'bg-border'}`}
          >
            <span className={`pointer-events-none absolute top-0.5 left-0.5 h-[18px] w-[18px] rounded-full bg-white shadow transition-transform duration-200 ${mfaEnabled ? 'translate-x-[18px]' : 'translate-x-0'}`} />
          </button>
        </Card>

        {/* Users */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="m-0 text-base font-bold text-ink">User Roles &amp; Permissions</h1>
            <p className="m-0 text-xs text-muted-foreground">
              Manage user access across your organization &middot; {users.length} users, {users.filter(u => u.account_status === 'ACTIVE').length} active
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link to="/invite-people">
              <Button variant="secondary" icon={<UserPlus className="w-3 h-3" strokeWidth={2.2} />}>
                Invite people
              </Button>
            </Link>
            <Button onClick={() => setShowAddUserModal(true)} icon={<UserPlus className="w-3 h-3" strokeWidth={2.2} />}>
              Add New User
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-[2fr_1fr_1fr] gap-2.5">
          <SearchInput
            placeholder="Search by email..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="!bg-white !border-border"
          />
          <label className="relative block">
            <select
              aria-label="Filter by role"
              value={selectedRole}
              onChange={(e) => setSelectedRole(e.target.value)}
              className="w-full appearance-none rounded-tile border border-border bg-white pl-3 pr-8 py-2 text-xs text-ink outline-none focus:border-brand"
            >
              <option value="ALL">All Roles</option>
              {(Object.keys(ROLES) as Array<keyof typeof ROLES>).map((role) => (
                <option key={role} value={role}>{ROLES[role].label}</option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-subtle" strokeWidth={2} />
          </label>
          <label className="relative block">
            <select
              aria-label="Filter by status"
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
              className="w-full appearance-none rounded-tile border border-border bg-white pl-3 pr-8 py-2 text-xs text-ink outline-none focus:border-brand"
            >
              <option value="ALL">All Statuses</option>
              <option value="ACTIVE">Active</option>
              <option value="SUSPENDED">Suspended</option>
              <option value="DEACTIVATED">Deactivated</option>
            </select>
            <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-subtle" strokeWidth={2} />
          </label>
        </div>

        {loading ? (
          <Card className="flex items-center justify-center !p-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand"></div>
          </Card>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3.5">
              {currentUsers.length > 0 ? (
                currentUsers.map(user => (
                  <UserCard
                    key={user.id}
                    user={user}
                    onEdit={setEditingUser}
                    onDelete={handleDeleteUser}
                    onResetPassword={setResettingPasswordUser}
                  />
                ))
              ) : (
                <Card className="col-span-full">
                  <EmptyState
                    className="py-8"
                    icon={<Users size={20} />}
                    title="No users found"
                    description="No users match your search or filters."
                  />
                </Card>
              )}
            </div>

            {filteredUsers.length > usersPerPage && (
              <Card padding="none" className="overflow-hidden">
                <Pagination
                  currentPage={currentPage}
                  totalPages={totalPages}
                  onPageChange={setCurrentPage}
                />
              </Card>
            )}
          </>
        )}
      </div>

      {/* Modals */}
      {showAddUserModal && (
        <UserEditModal
          user={null}
          onClose={() => setShowAddUserModal(false)}
          onSave={handleSaveUser}
        />
      )}

      {editingUser && (
        <UserEditModal
          user={editingUser}
          onClose={() => setEditingUser(null)}
          onSave={handleSaveUser}
        />
      )}

      {resettingPasswordUser && (
        <ResetPasswordModal
          user={resettingPasswordUser}
          onClose={() => setResettingPasswordUser(null)}
          onReset={(passwordOrEmail) => handleResetPassword(resettingPasswordUser, passwordOrEmail)}
        />
      )}
    </div>
  );
}
