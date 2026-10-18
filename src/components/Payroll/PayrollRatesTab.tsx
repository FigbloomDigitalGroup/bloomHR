import { useCallback, useEffect, useState } from 'react';
import { Percent, Settings } from 'lucide-react';
import { Card, EmptyState, TableScroll } from '../UI';
import FigbloomLoader from '../UI/FigbloomLoader';
import { lastDayOf } from '../../lib/payrollExports';
import { RATE_LABELS, type RateRow, isPercentCode, rateLabel, ratesInForce } from '../../lib/statutoryRates';

// The Rates tab: the statutory rates payroll uses for the month (statutory_rates), read-only, each with the date it
// took effect and where it comes from. NSSF is shown as tier I and tier II, from the stored lower and upper earnings
// limits and rate, the same way lib/statutoryCalc works it out. "Edit rates" opens the existing editor.

interface Line {
  label: string;
  value: string;
  /** the rows the line is read from: its effective date and source come from them */
  from: (RateRow | undefined)[];
  note?: string;
}

interface Section {
  title: string;
  lines: Line[];
}

const ksh = (n: number) => `KSh ${n.toLocaleString('en-KE', { maximumFractionDigits: 2 })}`;
const tsh = (n: number) => `TSh ${n.toLocaleString('en-KE', { maximumFractionDigits: 2 })}`;
const pct = (n: number) => `${+(n * 100).toFixed(3)}%`;
const num = (r: RateRow | undefined) => (r && r.value !== null && Number.isFinite(Number(r.value)) ? Number(r.value) : null);

/** A row's own value as text (the editor shows the same). */
const valueText = (r: RateRow) => {
  const v = num(r);
  if (v === null) return '—';
  return isPercentCode(r.code) ? pct(v) : v.toLocaleString('en-KE');
};

/** The latest date any of the rows took effect, and who set them. */
const effective = (rows: (RateRow | undefined)[]) => {
  const present = rows.filter((r): r is RateRow => !!r);
  if (!present.length) return { from: '—', source: 'Not set' };
  const latest = present.reduce((a, b) => (b.effective_from > a.effective_from ? b : a));
  const company = present.find((r) => r.tenant_id);
  return {
    from: latest.effective_from,
    source: company ? `Your company${company.source && company.source !== 'Set by the company' ? ` (${company.source})` : ''}` : latest.source ?? 'Default',
  };
};

/** Tanzania's rates (FIG-905): PAYE bands and flat rates, NSSF, the employer's SDL and WCF, HESLB, contractors. */
function tanzaniaSections(rows: RateRow[]): Section[] {
  const byCode = new Map(rows.map((r) => [r.code, r]));
  const used = new Set<string>();
  const line = (code: string, note?: string): Line | null => {
    const r = byCode.get(code);
    used.add(code);
    return r ? { label: rateLabel(code, 'Tanzania'), value: valueText(r), from: [r], note } : null;
  };
  const present = (lines: (Line | null)[]) => lines.filter((l): l is Line => l !== null);
  const bandsRow = byCode.get('paye_bands');
  used.add('paye_bands');
  const bandLines: Line[] = (bandsRow?.bands ?? []).map((b, i, all) => {
    const lower = i === 0 ? 0 : all[i - 1].upto ?? 0;
    const label = b.upto === null ? `Above ${tsh(lower)}` : i === 0 ? `First ${tsh(b.upto)}` : `${tsh(lower + 1)} to ${tsh(b.upto)}`;
    return { label: `PAYE band: ${label}`, value: pct(Number(b.rate)), from: [bandsRow] };
  });
  const sdlMin = num(byCode.get('sdl_min_employees'));
  const sections: Section[] = [
    { title: 'PAYE (income tax)', lines: [...bandLines, ...present([line('nonresident_paye_rate'), line('secondary_paye_rate')])] },
    { title: 'NSSF', lines: present([line('nssf_rate'), line('nssf_employer_rate'), line('nssf_deductible')]) },
    {
      title: 'Employer levies (not taken from pay)',
      lines: present([
        line('sdl_rate', sdlMin !== null ? `Paid when the company has ${sdlMin} or more employees in Tanzania. An exempt employer sets it to 0.` : undefined),
        line('sdl_min_employees'),
        line('wcf_rate', 'Basic pay and fixed allowances; not overtime or one-off earnings'),
      ]),
    },
    { title: 'HESLB', lines: present([line('heslb_rate', 'For employees marked as HESLB borrowers, after tax')]) },
    { title: 'Contractors (withholding tax)', lines: present([line('wht_resident'), line('wht_nonresident')]) },
    { title: 'Other', lines: rows.filter((r) => !used.has(r.code)).map((r) => ({ label: rateLabel(r.code, 'Tanzania'), value: valueText(r), from: [r] })) },
  ];
  return sections.filter((s) => s.lines.length > 0);
}

/** Groups the month's rates the way finance reads them: PAYE, SHA, housing levy, NSSF tiers, then anything else. */
export function rateSections(rows: RateRow[], country = 'Kenya'): Section[] {
  if (country === 'Tanzania') return tanzaniaSections(rows);
  if (country === 'Uganda') return ugandaRateSections(rows);
  const byCode = new Map(rows.map((r) => [r.code, r]));
  const get = (code: string) => byCode.get(code);
  const used = new Set<string>();
  const take = (code: string) => {
    used.add(code);
    return get(code);
  };
  const line = (code: string, label = RATE_LABELS[code] ?? code): Line | null => {
    const r = take(code);
    return r ? { label, value: valueText(r), from: [r] } : null;
  };
  const present = (lines: (Line | null)[]) => lines.filter((l): l is Line => l !== null);

  // PAYE: one line per band
  const bandsRow = take('paye_bands');
  const bandLines: Line[] = (bandsRow?.bands ?? []).map((b, i, all) => {
    const lower = i === 0 ? 0 : all[i - 1].upto ?? 0;
    const label =
      b.upto === null
        ? `Above ${ksh(lower)}`
        : i === 0
          ? `First ${ksh(b.upto)}`
          : `${ksh(lower + 1)} to ${ksh(b.upto)}`;
    return { label: `PAYE band: ${label}`, value: pct(Number(b.rate ?? 0)), from: [bandsRow] };
  });
  const paye = [
    ...bandLines,
    line('personal_relief'),
    line('insurance_relief_rate'),
    line('insurance_relief_cap'),
  ];

  const sha = [line('shif_rate', 'SHA (SHIF) rate'), line('shif_minimum', 'SHA (SHIF) minimum (monthly)')];
  const housing = [line('ahl_rate'), line('ahl_employer_rate')];

  // NSSF: the same rate on pay up to the upper earnings limit (statutoryCalc), split at the lower limit into tiers
  const lowerRow = take('nssf_lower_limit');
  const upperRow = take('nssf_upper_limit');
  const rateRow = take('nssf_rate');
  const employerRow = take('nssf_employer_rate');
  const lower = num(lowerRow);
  const upper = num(upperRow);
  const rate = num(rateRow);
  const employerRate = num(employerRow);
  const nssf: Line[] = [];
  if (rate !== null && lower !== null) {
    nssf.push({
      label: 'NSSF tier I',
      value: `${pct(rate)} of pay up to ${ksh(lower)}`,
      note: `Up to ${ksh(lower * rate)} a month from the employee${employerRate !== null ? `, ${ksh(lower * employerRate)} from the employer` : ''}`,
      from: [lowerRow, rateRow],
    });
  }
  if (rate !== null && upper !== null) {
    const start = lower ?? 0;
    nssf.push({
      label: 'NSSF tier II',
      value: `${pct(rate)} of pay from ${ksh(start)} to ${ksh(upper)}`,
      note: `Up to ${ksh(Math.max(0, upper - start) * rate)} a month from the employee${employerRate !== null ? `, ${ksh(Math.max(0, upper - start) * employerRate)} from the employer` : ''}`,
      from: [lowerRow, upperRow, rateRow],
    });
  }
  if (!nssf.length && rateRow) nssf.push({ label: RATE_LABELS.nssf_rate, value: valueText(rateRow), from: [rateRow] });
  if (employerRow) nssf.push({ label: RATE_LABELS.nssf_employer_rate, value: valueText(employerRow), from: [employerRow] });

  // the NITA training levy: an employer cost per employee, never taken from pay (FIG-898)
  const nitaRow = take('nita_levy');
  const nita: Line[] = nitaRow
    ? [{ label: 'Training levy (employer)', value: num(nitaRow) !== null ? `${ksh(num(nitaRow) as number)} per employee a month` : '—',
         note: 'Paid by the employer for each employee on the payroll (not casual workers or contractors); not taken from pay', from: [nitaRow] }]
    : [];

  const other = rows.filter((r) => !used.has(r.code)).map((r) => ({ label: RATE_LABELS[r.code] ?? r.code, value: valueText(r), from: [r] }));

  return [
    { title: 'PAYE (income tax)', lines: present(paye) },
    { title: 'SHA (SHIF)', lines: present(sha) },
    { title: 'Housing levy', lines: present(housing) },
    { title: 'NSSF', lines: nssf },
    { title: 'NITA', lines: nita },
    { title: 'Other limits and reliefs', lines: other },
  ].filter((s) => s.lines.length > 0);
}

const ush = (n: number) => `USh ${Math.round(n).toLocaleString('en-UG')}`;

/** Bands as lines: "First USh 335,000", "USh 335,001 to USh 410,000", "Above USh 485,000". */
const bandLinesOf = (row: RateRow | undefined, prefix: string, value: (b: { rate?: number; amount?: number }) => string): Line[] =>
  (row?.bands ?? []).map((b, i, all) => {
    const lower = i === 0 ? 0 : all[i - 1].upto ?? 0;
    const label = b.upto === null ? `Above ${ush(lower)}` : i === 0 ? `Up to ${ush(b.upto)}` : `${ush(lower + 1)} to ${ush(b.upto)}`;
    return { label: `${prefix}: ${label}`, value: value(b), from: [row] };
  });

/** Uganda's rates (FIG-905): resident and non-resident PAYE with the extra 10%, NSSF, Local Service Tax, then the rest. */
export function ugandaRateSections(rows: RateRow[]): Section[] {
  const byCode = new Map(rows.map((r) => [r.code, r]));
  const used = new Set<string>();
  const take = (code: string) => {
    used.add(code);
    return byCode.get(code);
  };
  const line = (code: string, label = RATE_LABELS[code] ?? code, value?: (v: number) => string): Line | null => {
    const r = take(code);
    if (!r) return null;
    const v = num(r);
    return { label, value: value && v !== null ? value(v) : valueText(r), from: [r] };
  };
  const present = (lines: (Line | null)[]) => lines.filter((l): l is Line => l !== null);
  const rate = (b: { rate?: number }) => pct(Number(b.rate ?? 0));
  const threshold = take('paye_surcharge_threshold');
  const surcharge = take('paye_surcharge_rate');
  const extra: Line[] =
    threshold && surcharge && num(threshold) !== null && num(surcharge) !== null
      ? [{ label: 'Extra PAYE on high incomes', value: `${pct(num(surcharge) as number)} of income above ${ush(num(threshold) as number)} a month`, note: 'On top of the bands, residents and non-residents', from: [threshold, surcharge] }]
      : [];
  const paye = [...bandLinesOf(take('paye_bands'), 'Resident', rate), ...extra];
  const nonResident = bandLinesOf(take('paye_bands_non_resident'), 'Non-resident', rate);
  const nssf = present([
    line('nssf_rate', 'NSSF (employee)', (v) => `${pct(v)} of gross pay`),
    line('nssf_employer_rate', 'NSSF (employer)', (v) => `${pct(v)} of gross pay`),
    line('nssf_deductible', 'NSSF deducted before PAYE', (v) => (v ? 'Yes' : 'No: PAYE is on gross pay')),
  ]);
  const lst = [
    ...bandLinesOf(take('lst_bands'), 'Monthly gross pay', (b) => `${ush(Number(b.amount ?? 0))} a year`),
    ...present([
      line('lst_first_month', 'Collected from', (v) => new Date(2000, v - 1, 1).toLocaleString('en-GB', { month: 'long' })),
      line('lst_months', 'Collected over', (v) => `${v} months`),
      line('lst_deductible', 'LST deducted before PAYE', (v) => (v ? 'Yes, in the month it is taken' : 'No')),
    ]),
  ];
  const wht = present([line('wht_contractual', 'Contractors (services)'), line('wht_professional', 'Professional fees')]);
  const other = rows.filter((r) => !used.has(r.code)).map((r) => ({ label: RATE_LABELS[r.code] ?? r.code, value: r.bands ? `${r.bands.length} bands` : valueText(r), from: [r] }));
  return [
    { title: 'PAYE (resident)', lines: paye },
    { title: 'PAYE (non-resident)', lines: nonResident },
    { title: 'NSSF', lines: nssf },
    { title: 'Local service tax (LST)', lines: lst },
    { title: 'Withholding tax (contractors)', lines: wht },
    { title: 'Other', lines: other },
  ].filter((sec) => sec.lines.length > 0);
}

interface PayrollRatesTabProps {
  payPeriod: string;
  periodLabel: string;
  /** whether this person may change the company's rates (payroll access) */
  canEdit: boolean;
  onEdit: () => void;
  /** bumped after the editor saves, so the table reloads */
  version: number;
  /** the country whose rates these are (FIG-905): Kenya by default */
  country?: string;
}

const DESCRIPTIONS: Record<string, string> = {
  Kenya: 'What Kenya payroll uses this month for PAYE, SHA, the housing levy and NSSF, from when, and where each comes from. Each country has its own rates.',
  Tanzania: 'What Tanzania payroll uses this month for PAYE, NSSF, HESLB and the employer\u2019s SDL and WCF, in TZS, from when, and where each comes from.',
};

export default function PayrollRatesTab({ payPeriod, periodLabel, canEdit, onEdit, version, country = 'Kenya' }: PayrollRatesTabProps) {
  const [rows, setRows] = useState<RateRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setRows(null);
    setError(null);
    try {
      setRows(await ratesInForce(lastDayOf(payPeriod), country));
    } catch (err) {
      setRows([]);
      setError(err instanceof Error ? err.message : 'Could not load the statutory rates.');
    }
  }, [payPeriod, country]);

  useEffect(() => {
    void load();
  }, [load, version]);

  const sections = rows ? rateSections(rows, country) : [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-bold text-ink">{country} statutory rates for {periodLabel}</h2>
          <p className="text-[11.5px] text-muted-foreground">{DESCRIPTIONS[country] ?? `What ${country} payroll uses this month, from when, and where each comes from.`}</p>
        </div>
        {canEdit && (
          <button
            type="button"
            onClick={onEdit}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-tile border border-border bg-white text-[11.5px] font-semibold text-ink hover:bg-secondary transition-colors"
          >
            <Settings className="w-3.5 h-3.5" />
            {country === 'Kenya' ? 'Edit rates' : `Edit ${country} rates`}
          </button>
        )}
      </div>

      {!rows && <FigbloomLoader label="Loading rates" size={48} />}
      {rows && error && <div className="rounded-tile bg-orange-tint text-status-danger text-[11.5px] font-semibold px-3 py-2">{error}</div>}
      {rows && !error && sections.length === 0 && (
        <Card>
          <EmptyState icon={<Percent className="w-5 h-5" />} title="No rates for this month" description="Payroll can't be worked out until the statutory rates are set." />
        </Card>
      )}

      {sections.map((section) => (
        <Card key={section.title} padding="none" className="overflow-hidden">
          <div className="px-4 py-2.5 border-b border-border bg-gray-50 text-[10.5px] font-bold uppercase text-subtle">{section.title}</div>
          <TableScroll>
            <table className="min-w-full text-xs">
              <thead>
                <tr className="text-left text-[10px] font-bold uppercase text-subtle">
                  <th className="px-4 pt-2 pb-1 font-bold">Rate</th>
                  <th className="px-4 pt-2 pb-1 font-bold">Value</th>
                  <th className="px-4 pt-2 pb-1 font-bold whitespace-nowrap">In effect from</th>
                  <th className="px-4 pt-2 pb-1 font-bold">Source</th>
                </tr>
              </thead>
              <tbody>
                {section.lines.map((l) => {
                  const { from, source } = effective(l.from);
                  return (
                    <tr key={l.label} className="border-t border-[#F1F5F2] align-top text-ink">
                      <td className="px-4 py-2 font-semibold">{l.label}</td>
                      <td className="px-4 py-2">
                        {l.value}
                        {l.note && <div className="text-[10.5px] text-muted-foreground mt-0.5">{l.note}</div>}
                      </td>
                      <td className="px-4 py-2 whitespace-nowrap text-muted-foreground">{from}</td>
                      <td className="px-4 py-2 text-muted-foreground">{source}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableScroll>
        </Card>
      ))}

      {rows && country === 'Kenya' && sections.some((s) => s.title === 'NSSF') && (
        <p className="text-[11px] text-muted-foreground">
          NSSF tiers I and II are taken at the same rate, so together they come to the rate on pay up to the upper earnings limit.
        </p>
      )}
    </div>
  );
}
