// src/pages/GmailCallback.tsx
import { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { Loader, CheckCircle, XCircle } from 'lucide-react';

const GmailCallback = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('');

  useEffect(() => {
    const handleCallback = async () => {
      const params = new URLSearchParams(location.search);
      const code = params.get('code');
      const error = params.get('error');

      if (error) {
        setStatus('error');
        setMessage('Authorization failed: ' + error);
        setTimeout(() => navigate('/employees'), 3000);
        return;
      }

      if (!code) {
        setStatus('error');
        setMessage('No authorization code received');
        setTimeout(() => navigate('/employees'), 3000);
        return;
      }

      try {
        // Exchange code for tokens
        const response = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            code,
            client_id: import.meta.env.VITE_GOOGLE_CLIENT_ID,
            client_secret: import.meta.env.VITE_GOOGLE_CLIENT_SECRET,
            redirect_uri: `${window.location.origin}/auth/gmail/callback`,
            grant_type: 'authorization_code',
          }),
        });

        if (!response.ok) throw new Error('Failed to exchange code for tokens');

        const data = await response.json();

        // Save tokens to Supabase
        const { error: supabaseError } = await supabase
          .from('system_settings')
          .upsert({
            id: 1,
            gmail_access_token: data.access_token,
            gmail_refresh_token: data.refresh_token,
            gmail_token_expiry: new Date(Date.now() + data.expires_in * 1000).toISOString(),
            updated_at: new Date().toISOString(),
          });

        if (supabaseError) throw supabaseError;

        setStatus('success');
        setMessage('Gmail authorization successful!');
        setTimeout(() => navigate('/employees'), 2000);
      } catch (err) {
        console.error('Callback error:', err);
        setStatus('error');
        setMessage('Failed to complete authorization');
        setTimeout(() => navigate('/employees'), 3000);
      }
    };

    handleCallback();
  }, [location, navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="bg-white p-8 rounded-lg shadow-md max-w-md w-full">
        {status === 'loading' && (
          <div className="text-center">
            <Loader className="w-12 h-12 text-blue-600 animate-spin mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-gray-800">Completing Gmail Authorization...</h2>
            <p className="text-gray-600 mt-2">Please wait while we connect your Gmail account.</p>
          </div>
        )}
        
        {status === 'success' && (
          <div className="text-center">
            <CheckCircle className="w-12 h-12 text-green-600 mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-gray-800">Authorization Successful!</h2>
            <p className="text-gray-600 mt-2">{message}</p>
            <p className="text-sm text-gray-500 mt-4">Redirecting to employee list...</p>
          </div>
        )}
        
        {status === 'error' && (
          <div className="text-center">
            <XCircle className="w-12 h-12 text-red-600 mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-gray-800">Authorization Failed</h2>
            <p className="text-gray-600 mt-2">{message}</p>
            <button
              onClick={() => navigate('/employees')}
              className="mt-6 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
            >
              Go Back
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default GmailCallback;