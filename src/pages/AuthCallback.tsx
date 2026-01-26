import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import toast from 'react-hot-toast';

export default function AuthCallback() {
    const navigate = useNavigate();

    useEffect(() => {
        const handleAuthCallback = async () => {
            try {
                // 1. Check for errors in the URL first
                const url = new URL(window.location.href.replace('#', '?'));
                const error = url.searchParams.get('error') || url.searchParams.get('error_description');

                if (error) {
                    console.error('❌ Auth error detected:', error);
                    toast.error(error.replace(/\+/g, ' '));
                    navigate('/login', { replace: true });
                    return;
                }

                // 2. Parse tokens/codes
                const hashParams = new URLSearchParams(window.location.hash.substring(1));
                const queryParams = url.searchParams;

                const type = hashParams.get('type') || queryParams.get('type');
                const code = queryParams.get('code');
                const accessToken = hashParams.get('access_token');

                console.log('🔄 AuthCallback processing...', { type, hasCode: !!code, hasToken: !!accessToken });

                // 3. If we have a PKCE code, exchange it
                if (code) {
                    console.log('🔑 Exchanging code for session...');
                    const { data, error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
                    if (exchangeError) {
                        console.error('Code exchange failed:', exchangeError.message);
                        toast.error('Session expired or invalid link.');
                        navigate('/login', { replace: true });
                        return;
                    }
                }

                // 4. Handle Password Recovery
                if (type === 'recovery' || accessToken || window.location.href.includes('type=recovery')) {
                    console.log('🛠 Starting password reset flow');
                    sessionStorage.setItem('isPasswordRecovery', 'true');

                    // Small delay to ensure session is fully persistent
                    setTimeout(() => {
                        navigate('/update-password', { replace: true });
                    }, 800);
                } else {
                    // Normal redirect
                    navigate('/', { replace: true });
                }
            } catch (err) {
                console.error('Auth callback error:', err);
                navigate('/login', { replace: true });
            }
        };

        handleAuthCallback();
    }, [navigate]);

    return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
            <div className="max-w-md w-full text-center space-y-6">
                <div className="animate-spin rounded-full h-14 w-14 border-t-2 border-b-2 border-green-500 mx-auto"></div>
                <div>
                    <h2 className="text-2xl font-bold text-gray-900">Security Check</h2>
                    <p className="text-gray-500 mt-2">Connecting to secure authentication server...</p>
                </div>
            </div>
        </div>
    );
}
