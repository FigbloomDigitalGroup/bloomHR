import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { X, Eye, EyeOff, Lock, CheckCircle2, AlertCircle } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import toast from 'react-hot-toast';

interface PasswordResetModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const PasswordResetModal: React.FC<PasswordResetModalProps> = ({ isOpen, onClose }) => {
  const [formData, setFormData] = useState({
    newPassword: '',
    confirmPassword: ''
  });
  const [showPasswords, setShowPasswords] = useState({
    new: false,
    confirm: false
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  if (!isOpen) return null;

  const validatePassword = (password: string) => {
    const errors = [];
    if (password.length < 8) errors.push('At least 8 characters');
    if (!/[A-Z]/.test(password)) errors.push('One uppercase letter');
    if (!/[a-z]/.test(password)) errors.push('One lowercase letter');
    if (!/\d/.test(password)) errors.push('One number');
    if (!/[!@#$%^&*(),.?":{}|<>]/.test(password)) errors.push('One special character');
    return errors;
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
    if (errors[name]) {
      setErrors(prev => ({ ...prev, [name]: '' }));
    }
  };

  const togglePasswordVisibility = (field: 'new' | 'confirm') => {
    setShowPasswords(prev => ({ ...prev, [field]: !prev[field] }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setErrors({});

    const newErrors: Record<string, string> = {};

    if (!formData.newPassword) {
      newErrors.newPassword = 'New password is required';
    } else {
      const passwordErrors = validatePassword(formData.newPassword);
      if (passwordErrors.length > 0) {
        newErrors.newPassword = passwordErrors.join(', ');
      }
    }
    if (!formData.confirmPassword) {
      newErrors.confirmPassword = 'Please confirm your new password';
    } else if (formData.newPassword !== formData.confirmPassword) {
      newErrors.confirmPassword = 'Passwords do not match';
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      setIsSubmitting(false);
      return;
    }

    try {
      const { error: updateError } = await supabase.auth.updateUser({
        password: formData.newPassword
      });
      if (updateError) {
        throw updateError;
      }
      toast.success('Password updated successfully!');
      setFormData({
        newPassword: '',
        confirmPassword: ''
      });
      onClose();
    } catch (error: any) {
      console.error('Error updating password:', error);
      toast.error(error.message || 'Failed to update password');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    setFormData({
      newPassword: '',
      confirmPassword: ''
    });
    setErrors({});
    setShowPasswords({
      new: false,
      confirm: false
    });
    onClose();
  };

  const passwordStrength = validatePassword(formData.newPassword);
  const isPasswordStrong = passwordStrength.length === 0 && formData.newPassword.length > 0;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-start justify-center z-50 p-4 overflow-y-auto">
      <div className="w-full max-w-md my-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.9 }}
          className="bg-white rounded-xl shadow-2xl w-full max-h-[calc(100vh-2rem)] overflow-y-auto"
        >
          {/* Header */}
          <div className="flex items-center justify-between p-4 sm:p-6 border-b border-gray-200">
            <div className="flex items-center space-x-3">
              <div className="w-8 h-8 sm:w-10 sm:h-10 bg-green-100 rounded-lg flex items-center justify-center">
                <Lock className="h-4 w-4 sm:h-5 sm:w-5 text-green-600" />
              </div>
              <div>
                <h3 className="text-base sm:text-lg font-semibold text-gray-900">Change Password</h3>
                <p className="text-xs sm:text-xs text-gray-500">Update your account password</p>
              </div>
            </div>
            <button
              onClick={handleClose}
              className="text-gray-400 hover:text-gray-600 transition-colors p-1"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="p-4 sm:p-6 space-y-4 sm:space-y-6">
            {/* New Password */}
            <div className="space-y-2">
              <label className="block text-xs font-medium text-gray-700">
                New Password
              </label>
              <div className="relative">
                <input
                  type={showPasswords.new ? 'text' : 'password'}
                  name="newPassword"
                  value={formData.newPassword}
                  onChange={handleInputChange}
                  className={`w-full px-3 py-2 sm:px-4 sm:py-3 pr-10 sm:pr-12 border rounded-lg focus:outline-none focus:ring-2 transition-colors text-xs sm:text-base ${errors.newPassword
                      ? 'border-red-300 focus:ring-red-500 focus:border-red-500'
                      : isPasswordStrong
                        ? 'border-green-300 focus:ring-green-500 focus:border-green-500'
                        : 'border-gray-300 focus:ring-green-500 focus:border-green-500'
                    }`}
                  placeholder="Enter your new password"
                  required
                />
                <button
                  type="button"
                  onClick={() => togglePasswordVisibility('new')}
                  className="absolute inset-y-0 right-0 pr-2 sm:pr-3 flex items-center text-gray-400 hover:text-gray-600"
                >
                  {showPasswords.new ? <EyeOff className="h-4 w-4 sm:h-5 sm:w-5" /> : <Eye className="h-4 w-4 sm:h-5 sm:w-5" />}
                </button>
              </div>

              {formData.newPassword && (
                <div className="space-y-2">
                  <div className="text-xs text-gray-600">Password requirements:</div>
                  <div className="grid grid-cols-1 gap-1">
                    {[
                      { check: formData.newPassword.length >= 8, text: 'At least 8 characters' },
                      { check: /[A-Z]/.test(formData.newPassword), text: 'One uppercase letter' },
                      { check: /[a-z]/.test(formData.newPassword), text: 'One lowercase letter' },
                      { check: /\d/.test(formData.newPassword), text: 'One number' },
                      { check: /[!@#$%^&*(),.?":{}|<>]/.test(formData.newPassword), text: 'One special character' }
                    ].map((req, index) => (
                      <div key={index} className="flex items-center space-x-2">
                        {req.check ? (
                          <CheckCircle2 className="h-3 w-3 text-green-500 flex-shrink-0" />
                        ) : (
                          <div className="h-3 w-3 rounded-full border border-gray-300 flex-shrink-0" />
                        )}
                        <span className={`text-xs ${req.check ? 'text-green-600' : 'text-gray-500'}`}>
                          {req.text}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {errors.newPassword && (
                <p className="text-xs sm:text-xs text-red-600 flex items-center">
                  <AlertCircle className="h-3 w-3 sm:h-4 sm:w-4 mr-1 flex-shrink-0" />
                  <span>{errors.newPassword}</span>
                </p>
              )}
            </div>

            {/* Confirm Password */}
            <div className="space-y-2">
              <label className="block text-xs font-medium text-gray-700">
                Confirm New Password
              </label>
              <div className="relative">
                <input
                  type={showPasswords.confirm ? 'text' : 'password'}
                  name="confirmPassword"
                  value={formData.confirmPassword}
                  onChange={handleInputChange}
                  className={`w-full px-3 py-2 sm:px-4 sm:py-3 pr-10 sm:pr-12 border rounded-lg focus:outline-none focus:ring-2 transition-colors text-xs sm:text-base ${errors.confirmPassword
                      ? 'border-red-300 focus:ring-red-500 focus:border-red-500'
                      : formData.confirmPassword && formData.newPassword === formData.confirmPassword
                        ? 'border-green-300 focus:ring-green-500 focus:border-green-500'
                        : 'border-gray-300 focus:ring-green-500 focus:border-green-500'
                    }`}
                  placeholder="Confirm your new password"
                  required
                />
                <button
                  type="button"
                  onClick={() => togglePasswordVisibility('confirm')}
                  className="absolute inset-y-0 right-0 pr-2 sm:pr-3 flex items-center text-gray-400 hover:text-gray-600"
                >
                  {showPasswords.confirm ? <EyeOff className="h-4 w-4 sm:h-5 sm:w-5" /> : <Eye className="h-4 w-4 sm:h-5 sm:w-5" />}
                </button>
              </div>

              {formData.confirmPassword && formData.newPassword === formData.confirmPassword && (
                <p className="text-xs sm:text-xs text-green-600 flex items-center">
                  <CheckCircle2 className="h-3 w-3 sm:h-4 sm:w-4 mr-1 flex-shrink-0" />
                  <span>Passwords match</span>
                </p>
              )}

              {errors.confirmPassword && (
                <p className="text-xs sm:text-xs text-red-600 flex items-center">
                  <AlertCircle className="h-3 w-3 sm:h-4 sm:w-4 mr-1 flex-shrink-0" />
                  <span>{errors.confirmPassword}</span>
                </p>
              )}
            </div>

            {/* Security Notice */}
            <div className="bg-blue-50 border-l-4 border-blue-500 p-3 sm:p-4 rounded-r-lg">
              <div className="flex">
                <div className="flex-shrink-0">
                  <Lock className="h-4 w-4 sm:h-5 sm:w-5 text-blue-500" />
                </div>
                <div className="ml-3">
                  <p className="text-xs sm:text-xs text-blue-700">
                    <strong>Security Notice:</strong> Choose a strong password that you haven't used before.
                    You'll need to sign in again after changing your password.
                  </p>
                </div>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex flex-col sm:flex-row space-y-3 sm:space-y-0 sm:space-x-3 pt-4">
              <button
                type="button"
                onClick={handleClose}
                className="w-full sm:flex-1 px-4 py-2 sm:py-3 border border-gray-300 rounded-lg text-xs font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                disabled={isSubmitting}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting || !isPasswordStrong || formData.newPassword !== formData.confirmPassword}
                className={`w-full sm:flex-1 px-4 py-2 sm:py-3 border border-transparent rounded-lg text-xs font-medium text-white transition-colors flex items-center justify-center ${isSubmitting || !isPasswordStrong || formData.newPassword !== formData.confirmPassword
                    ? 'bg-gray-400 cursor-not-allowed'
                    : 'bg-green-600 hover:bg-green-700'
                  }`}
              >
                {isSubmitting ? (
                  <>
                    <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Updating...
                  </>
                ) : (
                  <>
                    <Lock className="h-4 w-4 mr-2" />
                    Update Password
                  </>
                )}
              </button>
            </div>
          </form>
        </motion.div>
      </div>
    </div>
  );
};

export default PasswordResetModal;