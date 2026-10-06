import { ReactNode, useState } from 'react';
import { useMyCompanies } from '../../hooks/useMyCompanies';
import { hasChosenCompany } from '../../lib/companyChoice';
import CompanyPicker from './CompanyPicker';

interface CompanyGateProps {
  userId: string;
  children: ReactNode;
}

/**
 * After sign-in, a person who belongs to several companies chooses which one to work in before seeing anything.
 * Everyone else (one company) passes straight through, and so does anyone whose companies cannot be loaded:
 * the database already limits them to the company they are currently in.
 */
export default function CompanyGate({ userId, children }: CompanyGateProps) {
  const { data: companies, isLoading } = useMyCompanies();
  const [chosen, setChosen] = useState(() => hasChosenCompany(userId));

  if (isLoading) {
    return <div className="min-h-screen flex items-center justify-center text-sm text-gray-500">Loading your workspace…</div>;
  }
  if (companies && companies.length > 1 && !chosen) {
    return <CompanyPicker userId={userId} companies={companies} onChosen={() => setChosen(true)} />;
  }
  return <>{children}</>;
}
