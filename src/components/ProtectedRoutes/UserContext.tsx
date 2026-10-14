// context/UserContext.tsx
import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { fetchTrustedRole } from '../../lib/trustedRole';

interface User {
  email: string | undefined;
  role: string;
  id: string;
  town: string;
}

interface UserContextType {
  user: User | null;
  loading: boolean;
}

const UserContext = createContext<UserContextType | undefined>(undefined);

// Companies make their own roles (FIG-827), so any role key is valid; what it may do comes from its modules.
// Someone with no role (or a malformed one) is treated as staff, as before.
const roleOrStaff = (role: string | null) => (role && /^[A-Z][A-Z0-9_]{1,39}$/.test(role) ? role : 'STAFF');

interface UserProviderProps {
  children: React.ReactNode;
}

export const UserProvider: React.FC<UserProviderProps> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Get initial session
    const getSession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        // The role in the company the person is working in (user_metadata is editable and not per company)
        const userRole = await fetchTrustedRole(session.user.id);

        const role = roleOrStaff(userRole);

        setUser({
          email: session.user.email,
          role: role,
          id: session.user.id,
          town: session.user.user_metadata?.town || '' // Add town if needed
        });
      }
      setLoading(false);
    };

    getSession();

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (session?.user) {
          const authUser = session.user;
          // Look the role up outside this callback: calling supabase from inside it can deadlock the client
          setTimeout(async () => {
            const userRole = await fetchTrustedRole(authUser.id);
            const role = roleOrStaff(userRole);

            setUser({
              email: authUser.email,
              role: role,
              id: authUser.id,
              town: authUser.user_metadata?.town || ''
            });
            setLoading(false);
          }, 0);
        } else {
          setUser(null);
          setLoading(false);
        }
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  return (
    <UserContext.Provider value={{ user, loading }}>
      {children}
    </UserContext.Provider>
  );
};

export const useUser = () => {
  const context = useContext(UserContext);
  if (context === undefined) {
    throw new Error('useUser must be used within a UserProvider');
  }
  return context;
};