// components/RoleButtonWrapper.tsx
import React from 'react';
import { useUser } from './UserContext';

interface RoleButtonWrapperProps {
  children: React.ReactNode;
  allowedRoles?: string[];
}

const RoleButtonWrapper: React.FC<RoleButtonWrapperProps> = ({
  children,
  allowedRoles = []
}) => {
  const { user } = useUser();

  // If no user or user doesn't have required role, don't render
  if (!user || (allowedRoles.length > 0 && !allowedRoles.includes(user.role))) {
    return null;
  }

  // User has access - render the button
  return <>{children}</>;
};

export default RoleButtonWrapper;