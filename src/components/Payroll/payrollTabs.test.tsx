import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { TabBar } from '../UI';
import { PAYROLL_TABS, usePayrollTab } from './payrollTabs';

afterEach(cleanup);

// the payroll page's tab bar, as PayrollDashboard uses it, with the address shown
function Tabs() {
  const [tab, setTab] = usePayrollTab();
  const location = useLocation();
  return (
    <>
      <TabBar items={[...PAYROLL_TABS]} activeId={tab} onChange={setTab} />
      <p data-testid="open">{tab}</p>
      <p data-testid="search">{location.search}</p>
    </>
  );
}

const renderAt = (url: string) =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <Tabs />
    </MemoryRouter>,
  );

describe('payroll tabs', () => {
  it('lists Run, Employees\' pay, Deductions, Earnings, Pay items, Rates, Files and History', () => {
    renderAt('/payroll');
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Run', "Employees' pay", 'Deductions', 'Earnings', 'Pay items', 'Rates', 'Files', 'History']);
  });

  it('opens Run when the address names no tab, or one that does not exist', () => {
    renderAt('/payroll');
    expect(screen.getByTestId('open').textContent).toBe('run');
    cleanup();
    renderAt('/payroll?tab=nonsense');
    expect(screen.getByTestId('open').textContent).toBe('run');
  });

  it('opens the tab the address names', () => {
    renderAt('/payroll?tab=rates');
    expect(screen.getByTestId('open').textContent).toBe('rates');
  });

  it('puts the chosen tab in the address, keeping what else is there', () => {
    renderAt('/payroll?tab=run&x=1');
    fireEvent.click(screen.getByRole('button', { name: 'History' }));
    expect(screen.getByTestId('open').textContent).toBe('history');
    const params = new URLSearchParams(screen.getByTestId('search').textContent ?? '');
    expect(params.get('tab')).toBe('history');
    expect(params.get('x')).toBe('1');
  });
});
