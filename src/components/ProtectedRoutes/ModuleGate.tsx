import React from 'react';
import { usePermissions } from '../../hooks/usePermissions';

interface ModuleGateProps {
  children: React.ReactNode;
  /** shown when the person holds ANY of these modules (administrators always) */
  anyOf?: string[];
  /** ...and ALL of these (use both to keep a check as narrow as it was, e.g. HR administration AND Payroll) */
  allOf?: string[];
  fallback?: React.ReactNode;
}

/**
 * Shows its children by the modules of the person's role (FIG-827), never by the role's name: a company's own roles
 * get what is ticked for them on the Roles screen. Nothing is shown while the permissions load.
 */
export default function ModuleGate({ children, anyOf, allOf, fallback = null }: ModuleGateProps) {
  const { hasAnyPermission, hasAllPermissions, loading } = usePermissions();
  if (loading) return null;
  const ok = (!anyOf?.length || hasAnyPermission(anyOf)) && (!allOf?.length || hasAllPermissions(allOf));
  return <>{ok ? children : fallback}</>;
}
