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

        // Validate that the role is one of your expected roles
        const validRoles = ['ADMIN', 'MANAGER', 'STAFF', 'HR', 'OPERATIONS', 'REGIONAL', 'CHECKER'];
        const role = validRoles.includes(userRole ?? '') ? (userRole as string) : 'STAFF';

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
            const validRoles = ['ADMIN', 'MANAGER', 'STAFF', 'HR', 'OPERATIONS', 'REGIONAL', 'CHECKER'];
            const role = validRoles.includes(userRole ?? '') ? (userRole as string) : 'STAFF';

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