import { motion } from "framer-motion";
import { LockKeyhole, X } from "lucide-react";
import toast from "react-hot-toast";
import { supabase } from "../../lib/supabase";
import { useEffect, useState } from "react";

const PasswordResetModal = ({ isOpen, onClose }: { isOpen: boolean, onClose: () => void }) => {
  const [email, setEmail] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState({ text: '', type: '' });

  useEffect(() => {
    const fetchUserEmail = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user?.email) {
        setEmail(user.email);
      }
    };
    fetchUserEmail();
  }, []);

  const handleResetPassword = async () => {
    if (!email) {
      setMessage({ text: 'Please enter your email', type: 'error' });
      return;
    }

    setIsSubmitting(true);
    setMessage({ text: '', type: '' });

    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/update-password`,
      });

      if (error) throw error;

      setMessage({ 
        text: 'Password reset link sent to your email!', 
        type: 'success' 
      });
      toast.success('Password reset link sent successfully');
    } catch (error) {
      console.error('Error sending reset link:', error);
      setMessage({ 
        text: 'Failed to send reset link. Please try again.', 
        type: 'error' 
      });
      toast.error('Error sending password reset link');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <motion.div 
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md"
      >
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-medium text-gray-900 flex items-center">
            <LockKeyhole className="h-5 w-5 mr-2 text-green-600" />
            Reset Password
          </h3>
          <button 
            onClick={onClose}
            className="text-gray-400 hover:text-gray-500"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4">
          <p className="text-xs text-gray-600">
            Enter your email address and we'll send you a link to reset your password.
          </p>

          <div>
            <label htmlFor="email" className="block text-xs font-medium text-gray-700 mb-1">
              Email address
            </label>
            <input
              type="email"
              id="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-green-500 focus:border-green-500"
              placeholder="your@email.com"
              readOnly
            />
          </div>

          {message.text && (
            <div className={`text-xs ${message.type === 'success' ? 'text-green-600' : 'text-red-600'}`}>
              {message.text}
            </div>
          )}

          <div className="flex justify-end space-x-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border border-gray-300 rounded-md text-xs font-medium text-gray-700 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleResetPassword}
              disabled={isSubmitting}
              className={`px-4 py-2 border border-transparent rounded-md text-xs font-medium text-white bg-green-600 hover:bg-green-700 ${
                isSubmitting ? 'opacity-70 cursor-not-allowed' : ''
              }`}
            >
              {isSubmitting ? 'Sending...' : 'Send Reset Link'}
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
};export default PasswordResetModal;