import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

const flag = vi.hoisted(() => ({ on: false }));
vi.mock('../../lib/inAppPayments', () => ({
  get IN_APP_PAYMENTS() {
    return flag.on;
  },
}));
vi.mock('./RunPaymentsPanel', () => ({ default: () => <div>Pay staff panel</div> }));
vi.mock('./PayrollExportsPanel', () => ({ default: () => <div>Downloads panel</div> }));

import { ApprovedRunPanels, BulkPayButton } from './RunPayActions';
import { IN_APP_PAYMENTS } from '../../lib/inAppPayments';

const approved = { id: 'r1', pay_period: '2026-10', status: 'approved' } as never;
const draft = { id: 'r1', pay_period: '2026-10', status: 'draft' } as never;

afterEach(() => {
  cleanup();
  flag.on = false;
});

describe('with in-app paying off (finance pays by bank upload)', () => {
  it('has no bulk pay button', () => {
    render(<BulkPayButton label="Make Bulk Pay" onClick={() => {}} disabled={false} />);
    expect(screen.queryByRole('button', { name: /Bulk Pay/ })).toBeNull();
  });

  it('shows only the downloads for an approved run, not the payments panel', () => {
    render(<ApprovedRunPanels run={approved} />);
    expect(screen.getByText('Downloads panel')).toBeTruthy();
    expect(screen.queryByText('Pay staff panel')).toBeNull();
  });
});

describe('with in-app paying on', () => {
  it('shows the bulk pay button and the payments panel', () => {
    flag.on = true;
    render(
      <>
        <BulkPayButton label="Make Bulk Pay" onClick={() => {}} disabled={false} />
        <ApprovedRunPanels run={approved} />
      </>,
    );
    expect(screen.getByRole('button', { name: /Make Bulk Pay/ })).toBeTruthy();
    expect(screen.getByText('Pay staff panel')).toBeTruthy();
    expect(screen.getByText('Downloads panel')).toBeTruthy();
  });
});

it('shows nothing for a draft run', () => {
  render(<ApprovedRunPanels run={draft} />);
  expect(screen.queryByText('Downloads panel')).toBeNull();
});

it('ships with in-app paying off', async () => {
  const actual = await vi.importActual<typeof import('../../lib/inAppPayments')>('../../lib/inAppPayments');
  expect(actual.IN_APP_PAYMENTS).toBe(false);
  expect(IN_APP_PAYMENTS).toBe(false);
});
