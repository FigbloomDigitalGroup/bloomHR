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
  Search,
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
import { adminApi } from '../../lib/adminApi';
import toast from 'react-hot-toast';

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

const StatusBadge = ({ status }: { status: string }) => {
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${status === 'ACTIVE' ? 'bg-green-100 text-green-800' :
      status === 'SUSPENDED' ? 'bg-orange-100 text-orange-800' :
        'bg-red-100 text-red-800'
      }`}>
      {status === 'ACTIVE' ? 'Active' : status === 'SUSPENDED' ? 'Suspended' : 'Deactivated'}
    </span>
  );
};

const RoleBadge = ({ role }: { role: keyof typeof ROLES }) => {
  const roleInfo = ROLES[role] || ROLES.STAFF;

  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium ${role === 'ADMIN' ? 'bg-purple-100 text-purple-800' :
      role === 'REGIONAL' ? 'bg-violet-100 text-violet-800' :
        role === 'MANAGER' ? 'bg-blue-100 text-blue-800' :
          role === 'CHECKER' ? 'bg-orange-100 text-orange-800' :
            role === 'OPERATIONS' ? 'bg-indigo-100 text-indigo-800' :
              role === 'STAFF' ? 'bg-green-100 text-green-800' :
                'bg-gray-100 text-gray-800'
      }`}>
      {roleInfo.icon}
      {roleInfo.label}
    </span>
  );
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
    <div className="bg-white rounded-lg border p-4 shadow-sm hover:shadow-md transition-shadow border-gray-200">
      <div className="flex justify-between items-start">
        <div className="flex items-center gap-3 min-w-0">
          <div className="bg-gray-100 rounded-full w-10 h-10 flex items-center justify-center flex-shrink-0">
            <User className="w-5 h-5 text-gray-500" />
          </div>
          <div className="min-w-0">
            <h3 className="font-medium text-gray-900 text-xs truncate">
              {user.email}
            </h3>
            <p className="text-xs text-gray-500 truncate">
              {user.last_sign_in_at ? `Last active: ${new Date(user.last_sign_in_at).toLocaleDateString()}` : 'Never active'}
            </p>
          </div>
        </div>

        <div className="relative flex-shrink-0">
          <button
            onClick={() => setShowDropdown(!showDropdown)}
            className="text-gray-400 hover:text-gray-500 p-1"
          >
            <MoreVertical className="w-5 h-5" />
          </button>

          {showDropdown && (
            <div className="absolute right-0 mt-2 w-48 bg-white rounded-md shadow-lg z-10 border border-gray-200">
              <div className="py-1">
                <button
                  onClick={() => {
                    onEdit(user);
                    setShowDropdown(false);
                  }}
                  className="flex items-center gap-2 px-4 py-2 text-xs text-gray-700 hover:bg-gray-100 w-full text-left"
                >
                  <Edit className="w-4 h-4" />
                  Edit User
                </button>
                <button
                  onClick={() => {
                    onResetPassword(user);
                    setShowDropdown(false);
                  }}
                  className="flex items-center gap-2 px-4 py-2 text-xs text-blue-600 hover:bg-blue-50 w-full text-left"
                >
                  <Key className="w-4 h-4" />
                  Reset Password
                </button>
                <button
                  onClick={() => {
                    onDelete(user);
                    setShowDropdown(false);
                  }}
                  className="flex items-center gap-2 px-4 py-2 text-xs text-red-600 hover:bg-red-50 w-full text-left"
                >
                  <Trash2 className="w-4 h-4" />
                  Delete User
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="mt-3 pt-3 border-t border-gray-200 grid grid-cols-2 gap-3">
        <div>
          <p className="text-xs text-gray-500 mb-1">Status</p>
          <StatusBadge status={user.account_status} />
        </div>
        <div>
          <p className="text-xs text-gray-500 mb-1">Role</p>
          <RoleBadge role={user.role || 'STAFF'} />
        </div>
      </div>

      <div className="mt-3 pt-3 border-t border-gray-200">
        <p className="text-xs text-gray-500 mb-1">Created</p>
        <p className="text-xs text-gray-700">
          {new Date(user.created_at).toLocaleDateString()}
        </p>
      </div>
    </div>
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
    <div className="flex items-center justify-between border-t border-gray-200 px-4 py-3 sm:px-6">
      <div className="flex flex-1 justify-between sm:hidden">
        <button
          onClick={() => onPageChange(Math.max(1, currentPage - 1))}
          disabled={currentPage === 1}
          className="relative inline-flex items-center rounded-md border border-gray-300 bg-white px-4 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50"
        >
          Previous
        </button>
        <button
          onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
          disabled={currentPage === totalPages}
          className="relative ml-3 inline-flex items-center rounded-md border border-gray-300 bg-white px-4 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50"
        >
          Next
        </button>
      </div>
      <div className="hidden sm:flex sm:flex-1 sm:items-center sm:justify-between">
        <div>
          <p className="text-xs text-gray-700">
            Showing page <span className="font-medium">{currentPage}</span> of <span className="font-medium">{totalPages}</span>
          </p>
        </div>
        <div>
          <nav className="isolate inline-flex -space-x-px rounded-md shadow-sm" aria-label="Pagination">
            <button
              onClick={() => onPageChange(Math.max(1, currentPage - 1))}
              disabled={currentPage === 1}
              className="relative inline-flex items-center rounded-l-md px-2 py-2 text-gray-400 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 focus:z-20 focus:outline-offset-0"
            >
              <span className="sr-only">Previous</span>
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            </button>

            {pages.map((page) => (
              <button
                key={page}
                onClick={() => onPageChange(page)}
                className={`relative inline-flex items-center px-3 py-1.5 text-xs font-semibold ${currentPage === page
                  ? 'bg-primary text-white focus:z-20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary'
                  : 'text-gray-900 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 focus:z-20 focus:outline-offset-0'
                  }`}
              >
                {page}
              </button>
            ))}

            <button
              onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
              disabled={currentPage === totalPages}
              className="relative inline-flex items-center rounded-r-md px-2 py-2 text-gray-400 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 focus:z-20 focus:outline-offset-0"
            >
              <span className="sr-only">Next</span>
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </button>
          </nav>
        </div>
      </div>
    </div>
  );
};

const RoleToggle = ({
  role,
  active,
  onChange
}: {
  role: keyof typeof ROLES;
  active: boolean;
  onChange: (role: keyof typeof ROLES, active: boolean) => void
}) => {
  const roleInfo = ROLES[role];

  return (
    <div className="flex items-center justify-between p-3 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
      <div className="flex items-center gap-3">
        <div className={`p-2 rounded-lg ${role === 'ADMIN' ? 'bg-purple-100 text-purple-600' :
          role === 'REGIONAL' ? 'bg-violet-100 text-violet-600' :
            role === 'MANAGER' ? 'bg-blue-100 text-blue-600' :
              role === 'CHECKER' ? 'bg-orange-100 text-orange-600' :
                role === 'OPERATIONS' ? 'bg-indigo-100 text-indigo-600' :
                  role === 'STAFF' ? 'bg-green-100 text-green-600' :
                    'bg-gray-100 text-gray-600'
          }`}>
          {roleInfo.icon}
        </div>
        <div>
          <h4 className="font-medium text-gray-900 text-xs">{roleInfo.label}</h4>
          <p className="text-xs text-gray-500">{roleInfo.description}</p>
        </div>
      </div>

      <label className="relative inline-flex items-center cursor-pointer">
        <input
          type="checkbox"
          checked={active}
          onChange={() => onChange(role, !active)}
          className="sr-only peer"
        />
        <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary"></div>
      </label>
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
      toast.error(null);
      try {
        const users = await adminApi.listUsers();

        setUsers(users);
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
        // The Staff Portal resolves the employee by matching "Work Email", so a STAFF
        // login without a matching employees row can never load its data.
        if (finalUserData.role === 'STAFF') {
          const { data: employee, error: employeeError } = await supabase
            .from('employees')
            .select('"Employee Number"')
            .ilike('"Work Email"', finalUserData.email)
            .maybeSingle();

          if (employeeError) throw employeeError;
          if (!employee) {
            throw new Error(
              `No employee has the Work Email ${finalUserData.email}. Add the employee first, then create their login.`
            );
          }
        }

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
    <div className="p-6 bg-gray-50 min-h-screen">
      <div className="max-w-screen-2xl mx-auto space-y-6">

        {/* MFA Security Settings Card */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-3">
            <div className="p-2 bg-primary/10 rounded-lg">
              <Lock className="w-4 h-4 text-primary" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-gray-900">Security Settings</h2>
              <p className="text-xs text-gray-500">Control authentication requirements for admin and checker accounts</p>
            </div>
          </div>
          <div className="px-6 py-5">
            <div className="flex items-center justify-between">
              <div className="flex items-start gap-4">
                <div className={`mt-0.5 p-2 rounded-lg transition-colors ${mfaEnabled ? 'bg-green-100' : 'bg-gray-100'
                  }`}>
                  <Shield className={`w-5 h-5 transition-colors ${mfaEnabled ? 'text-green-600' : 'text-gray-400'
                    }`} />
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-900">Two-Factor Authentication (MFA)</p>
                  <p className="text-xs text-gray-500 mt-0.5 max-w-lg">
                    When enabled, Admin and Checker users must verify their identity via SMS code on every login.
                    Disable temporarily if you are experiencing SMS delivery issues.
                  </p>
                  <div className={`mt-2 inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${mfaEnabled
                    ? 'bg-green-100 text-green-700'
                    : 'bg-gray-100 text-gray-500'
                    }`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${mfaEnabled ? 'bg-green-500' : 'bg-gray-400'
                      }`} />
                    {mfaFetched ? (mfaEnabled ? 'Active — SMS verification required on login' : 'Inactive — Users skip SMS verification') : 'Loading...'}
                  </div>
                </div>
              </div>
              <button
                id="mfa-toggle-btn"
                onClick={handleMfaToggle}
                disabled={mfaLoading || !mfaFetched}
                className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed ${mfaEnabled ? 'bg-primary' : 'bg-gray-200'
                  }`}
                role="switch"
                aria-checked={mfaEnabled}
              >
                <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${mfaEnabled ? 'translate-x-5' : 'translate-x-0'
                  }`} />
              </button>
            </div>
          </div>
        </div>

        {/* Header */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">User Roles & Permissions</h1>
            <p className="text-gray-600 text-xs">Manage user access and permissions across your organization</p>
          </div>

          <div className="flex flex-col sm:flex-row gap-2">
            <button
              onClick={() => setShowAddUserModal(true)}
              className="inline-flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary/90 text-white rounded-lg text-xs font-medium"
            >
              <UserPlus className="w-4 h-4" />
              Add New User
            </button>
          </div>
        </div>



        {/* Filters */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Search */}
            <div className="md:col-span-1">
              <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wide mb-1">Search Users</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Search className="h-4 w-4 text-gray-400" />
                </div>
                <input
                  type="text"
                  placeholder="Search by email..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="block w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg bg-gray-50 focus:ring-2 focus:ring-primary/20 focus:border-primary text-xs"
                />
              </div>
            </div>

            {/* Role Filter */}
            <div>
              <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wide mb-1">Filter by Role</label>
              <div className="relative">
                <select
                  value={selectedRole}
                  onChange={(e) => setSelectedRole(e.target.value)}
                  className="block w-full pl-3 pr-10 py-2 border border-gray-300 rounded-lg bg-gray-50 focus:ring-2 focus:ring-primary/20 focus:border-primary text-xs appearance-none"
                >
                  <option value="ALL">All Roles</option>
                  {(Object.keys(ROLES) as Array<keyof typeof ROLES>).map((role) => (
                    <option key={role} value={role}>{ROLES[role].label}</option>
                  ))}
                </select>
                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-gray-700">
                  <ChevronDown className="w-4 h-4" />
                </div>
              </div>
            </div>

            {/* Status Filter */}
            <div>
              <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wide mb-1">Filter by Status</label>
              <div className="relative">
                <select
                  value={selectedStatus}
                  onChange={(e) => setSelectedStatus(e.target.value)}
                  className="block w-full pl-3 pr-10 py-2 border border-gray-300 rounded-lg bg-gray-50 focus:ring-2 focus:ring-primary/20 focus:border-primary text-xs appearance-none"
                >
                  <option value="ALL">All Statuses</option>
                  <option value="ACTIVE">Active</option>
                  <option value="SUSPENDED">Suspended</option>
                  <option value="DEACTIVATED">Deactivated</option>
                </select>
                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-gray-700">
                  <ChevronDown className="w-4 h-4" />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Total Users</p>
                <p className="text-xl font-bold text-gray-900">{users.length}</p>
              </div>
              <div className="p-2 rounded-lg bg-gray-100 text-gray-600">
                <Users className="w-5 h-5" />
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Active Users</p>
                <p className="text-xl font-bold text-gray-900">{users.filter(u => u.account_status === 'ACTIVE').length}</p>
              </div>
              <div className="p-2 rounded-lg bg-green-100 text-green-600">
                <Eye className="w-5 h-5" />
              </div>
            </div>
          </div>
        </div>

        {/* Users Grid */}
        {loading ? (
          <div className="bg-white rounded-xl border border-gray-200 p-8 flex items-center justify-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
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
                <div className="col-span-full bg-white rounded-xl border border-gray-200 p-8 text-center">
                  <p className="text-gray-500 text-xs">No users found matching your criteria</p>
                </div>
              )}
            </div>

            {/* Pagination */}
            {filteredUsers.length > usersPerPage && (
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <Pagination
                  currentPage={currentPage}
                  totalPages={totalPages}
                  onPageChange={setCurrentPage}
                />
              </div>
            )}
          </>
        )}

        {/* Role Permissions Section */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Role Permissions</h2>
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {(Object.keys(ROLES) as Array<keyof typeof ROLES>).map((role) => (
                <RoleToggle
                  key={role}
                  role={role}
                  active={true} // This would come from your permissions config
                  onChange={(r, a) => console.log(`Role ${r} active: ${a}`)}
                />
              ))}
            </div>
          </div>
        </div>
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