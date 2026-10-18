import { Globe2 } from 'lucide-react';
import { Card } from '../UI';
import type { Branch } from '../../lib/branches';
import { paidWithKenyaRulesByCountry } from '../../lib/branches';

/**
 * The Run tab's notice (FIG-905): payroll for Tanzania and Uganda (and any other country but Kenya) comes in a later
 * stage. Until then those staff's payslips are worked out with Kenya's rules, so this says who they are before anyone
 * pays them by mistake. Nothing shows when everyone is in a Kenya branch.
 */
export default function BranchCountryNotice({ employees, branches }: { employees: Record<string, unknown>[]; branches: Branch[] }) {
  const byCountry = paidWithKenyaRulesByCountry(employees, branches);
  if (byCountry.size === 0) return null;
  const total = [...byCountry.values()].reduce((n, list) => n + list.length, 0);
  return (
    <Card padding="sm" className="!rounded-xl border-orange-text-alt" role="alert" aria-label="Staff outside Kenya">
      <div className="flex items-start gap-2 text-xs text-ink">
        <Globe2 className="w-4 h-4 text-orange-text-alt shrink-0 mt-0.5" />
        <div className="min-w-0">
          <p className="m-0 font-semibold">Payroll for Tanzania and Uganda staff comes next; their payslips are calculated with Kenya rules until then.</p>
          <p className="m-0 mt-1 text-muted-foreground">
            {total} {total === 1 ? 'person is' : 'people are'} in a branch outside Kenya (
            {[...byCountry.entries()].map(([country, list]) => `${list.length} in ${country}`).join(', ')}
            ). They are marked below: check their pay by hand before paying them.
          </p>
        </div>
      </div>
    </Card>
  );
}
