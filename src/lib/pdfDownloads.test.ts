// @vitest-environment node
//
// The P9 and final-dues PDFs built with the real jsPDF and table plugin (other tests mock jsPDF away). Since
// jspdf-autotable 5, `import 'jspdf-autotable'` no longer adds doc.autoTable, so these downloads threw in the browser.
import { afterEach, describe, expect, it, vi } from 'vitest';

// the real jsPDF, with save() capturing the finished file instead of downloading it
const saved = vi.hoisted(() => [] as string[]);
vi.mock('jspdf', async (importOriginal) => {
  const real = await importOriginal<typeof import('jspdf')>();
  class CapturingPdf extends real.jsPDF {
    constructor(...args: ConstructorParameters<typeof real.jsPDF>) {
      super(...args);
      this.save = ((name: string) => {
        saved.push(`${name}\n${this.output()}`);
        return this;
      }) as unknown as typeof this.save;
    }
  }
  return { ...real, default: CapturingPdf, jsPDF: CapturingPdf };
});
vi.mock('./supabase', () => ({ supabase: {} }));

import { downloadP9Pdf, P9_COLUMNS } from './p9';
import { downloadStatementPdf } from './finalDues';

afterEach(() => {
  saved.length = 0;
});

describe('PDF downloads draw their tables', () => {
  it('P9 tax deduction card', () => {
    const zeros = Array(P9_COLUMNS.length - 1).fill(0);
    downloadP9Pdf({
      year: 2026,
      employer: { name: 'Acme Tech', pin: 'P051234567X' },
      employee: { name: 'Amina Wanjiru', pin: 'A012345678Z', payrollNumber: 'PR-00001', employeeNumber: 'MCL-000001' },
      rows: ['January', 'February'].map((month) => ({ month, values: [...zeros] })),
      totals: zeros,
    } as unknown as Parameters<typeof downloadP9Pdf>[0]);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toContain('P9 Tax Deduction Card 2026');
    expect(saved[0]).toContain('Taxable pay');
  });

  it('final dues statement', () => {
    downloadStatementPdf(
      { employeeName: 'Juma Otieno', employeeNumber: 'MCL-000002', lastWorkingDay: '2026-10-31', kind: 'Resignation' },
      [{ code: 'salary', label: 'Salary to last day', kind: 'earning', amount: 30000 } as Parameters<typeof downloadStatementPdf>[1][number]],
    );
    expect(saved).toHaveLength(1);
    expect(saved[0]).toContain('Final dues statement');
    expect(saved[0]).toContain('Salary to last day');
  });
});
