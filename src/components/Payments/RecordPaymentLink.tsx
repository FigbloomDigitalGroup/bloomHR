import { useNavigate } from 'react-router-dom';
import { WalletCards } from 'lucide-react';
import { Button } from '../UI';
import { usePermissions } from '../../hooks/usePermissions';

// An approved advance or loan is paid from Payments to make: finance pays it outside the app (bank, M-Pesa, cash) and
// records it there with its reference, which marks the item paid and starts payroll's deductions. Finance (the
// 'payments' module) gets the button; everyone else is told who pays it.

export default function RecordPaymentLink() {
  const navigate = useNavigate();
  const { hasPermission, loading } = usePermissions();
  if (loading) return null;
  if (!hasPermission('payments')) {
    return <span className="text-[11.5px] text-muted-foreground">Waiting for finance to pay it (Payments to make).</span>;
  }
  return (
    <Button onClick={() => navigate('/payments')} icon={<WalletCards className="w-3.5 h-3.5" />} title="Record the payment once finance has paid it">
      Record payment
    </Button>
  );
}
