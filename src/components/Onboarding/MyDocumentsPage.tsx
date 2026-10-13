import { useEffect, useState } from 'react';
import { Card } from '../UI';
import DocumentsSection from './DocumentsSection';
import RefereesSection from './RefereesSection';
import { errorMessage, loadMyOnboarding } from '../../lib/onboarding';
import FigbloomLoader from '../UI/FigbloomLoader';

// The staff portal's Documents tab: the same documents and referees as the Onboarding tab, on their own.

export default function MyDocumentsPage() {
  const [employeeId, setEmployeeId] = useState<string | null | undefined>(undefined);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    loadMyOnboarding().then(
      (r) => setEmployeeId(r ? String(r.employee['id']) : null),
      (err) => setProblem(errorMessage(err, 'Could not load your record.'))
    );
  }, []);

  if (problem) return <p className="p-6 text-sm text-status-danger">{problem}</p>;
  if (employeeId === undefined) return <div className="flex justify-center py-16"><FigbloomLoader label="Loading your documents" /></div>;
  if (employeeId === null) {
    return (
      <Card className="m-6 text-sm text-ink">
        Your login is not linked to an employee record yet. Ask HR to check that the work email on your record is the email
        you sign in with.
      </Card>
    );
  }
  return (
    <div className="p-4 sm:p-6 max-w-4xl space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-ink">Documents</h2>
        <p className="text-sm text-muted-foreground">Your documents for HR. Fields marked * are required.</p>
      </div>
      <Card><DocumentsSection employeeId={employeeId} /></Card>
      <Card>
        <h3 className="text-sm font-semibold text-ink mb-3">Referees</h3>
        <RefereesSection employeeId={employeeId} />
      </Card>
    </div>
  );
}
