import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import FigbloomLoader from '../UI/FigbloomLoader';

export const ProtectedRoute = ({ children }: { children: JSX.Element }) => {
  const { session, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return <FigbloomLoader fullScreen label="Loading" />;
  }

  if (!session) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return children;
};