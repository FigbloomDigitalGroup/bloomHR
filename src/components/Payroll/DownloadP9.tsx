import { useState } from 'react';
import toast from 'react-hot-toast';
import { FileDown, Loader2 } from 'lucide-react';
import { type P9, downloadP9Pdf } from '../../lib/p9';

// "Download P9" with a year: the P9 tax deduction card as a PDF, from that year's approved payslips.

const thisYear = new Date().getFullYear();
const YEARS = [thisYear, thisYear - 1, thisYear - 2];

export default function DownloadP9({ load }: { load: (year: number) => Promise<P9> }) {
  const [year, setYear] = useState(thisYear);
  const [busy, setBusy] = useState(false);

  const download = async () => {
    setBusy(true);
    try {
      const p9 = await load(year);
      if (p9.rows.every((r) => r.values.every((v) => v === 0))) {
        toast.error(`There are no approved payslips for ${year} yet`);
        return;
      }
      downloadP9Pdf(p9);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'The P9 could not be made');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <label className="sr-only" htmlFor="p9-year">P9 year</label>
      <select id="p9-year" value={year} onChange={(e) => setYear(Number(e.target.value))}
        className="rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs">
        {YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
      </select>
      <button type="button" onClick={() => void download()} disabled={busy}
        className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-800 hover:bg-gray-50 disabled:opacity-50">
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileDown className="h-3.5 w-3.5" />} Download P9
      </button>
    </div>
  );
}
