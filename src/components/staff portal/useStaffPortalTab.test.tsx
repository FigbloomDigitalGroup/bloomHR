import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { BrowserRouter } from 'react-router-dom';

vi.mock('../../lib/supabase', () => ({
  supabase: { auth: { getUser: () => Promise.resolve({ data: { user: null } }), signOut: vi.fn() } },
}));
vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));

import { useStaffPortalTab } from './useStaffPortalTab';
import StaffMobileHeader from './StaffMobileHeader';
import Modal from '../UI/Modal';
import { resetBackToCloseForTests, useBackToClose } from '../../hooks/useBackToClose';

// The staff portal's section mechanism, with the real phone header, a dialog and the phone menu, on the browser's
// own history (jsdom), so the phone's Back is window.history.back().
function Portal() {
  const [activeTab, setActiveTab] = useStaffPortalTab();
  const [dialog, setDialog] = useState(false);
  const [menu, setMenu] = useState(false);
  useBackToClose(menu, () => setMenu(false));
  return (
    <div>
      <StaffMobileHeader
        userName="jane"
        hasUnread={false}
        onOpenNotifications={() => {}}
        onOpenMenu={() => setMenu(true)}
        onPasswordReset={() => {}}
        setActiveTab={setActiveTab}
        atHome={activeTab === 'home'}
      />
      <p data-testid="section">{activeTab}</p>
      <button onClick={() => setActiveTab('payslips')}>Payslips</button>
      <button onClick={() => setActiveTab('leave')}>Leave</button>
      <button onClick={() => setDialog(true)}>Open dialog</button>
      {menu && (
        <nav aria-label="Menu">
          <button
            onClick={() => {
              setActiveTab('training');
              setMenu(false);
            }}
          >
            Training
          </button>
        </nav>
      )}
      <Modal open={dialog} onClose={() => setDialog(false)} title="A dialog">
        <p>dialog body</p>
      </Modal>
    </div>
  );
}

const back = () =>
  act(async () => {
    const popped = new Promise((r) => window.addEventListener('popstate', r, { once: true }));
    window.history.back();
    await popped;
    await new Promise((r) => setTimeout(r, 20));
  });
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 60)); });
const section = () => screen.getByTestId('section').textContent;

const open = (url: string) => {
  // a fresh visit at this address: the router numbers it as the first entry
  window.history.replaceState(null, '', url);
  return render(
    <BrowserRouter>
      <Portal />
    </BrowserRouter>,
  );
};

beforeEach(() => resetBackToCloseForTests());
afterEach(() => cleanup());

describe('staff portal sections in the address', () => {
  it('changing section updates the address, and home has no parameter', () => {
    open('/staff');
    expect(section()).toBe('home');
    fireEvent.click(screen.getByText('Payslips'));
    expect(section()).toBe('payslips');
    expect(window.location.pathname + window.location.search).toBe('/staff?tab=payslips');
  });

  it('Back returns to the previous section', async () => {
    open('/staff');
    fireEvent.click(screen.getByText('Payslips'));
    fireEvent.click(screen.getByText('Leave'));
    await back();
    expect(section()).toBe('payslips');
    await back();
    expect(section()).toBe('home');
    expect(window.location.search).toBe('');
  });

  it('a link (or a refresh) opens the section in the address', () => {
    open('/staff?tab=leave-history');
    expect(section()).toBe('leave-history');
  });

  it('Back closes an open dialog before going to the previous section', async () => {
    open('/staff');
    fireEvent.click(screen.getByText('Payslips'));
    fireEvent.click(screen.getByText('Open dialog'));
    expect(screen.getByRole('dialog')).toBeTruthy();

    await back();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(section()).toBe('payslips');

    await back();
    expect(section()).toBe('home');
  });

  it('a section picked from the phone menu replaces the menu entry: Back goes to the section before', async () => {
    open('/staff');
    fireEvent.click(screen.getByText('Payslips'));
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    await settle();
    fireEvent.click(screen.getByText('Training'));
    await settle();
    expect(section()).toBe('training');
    expect(screen.queryByRole('navigation', { name: 'Menu' })).toBeNull();

    await back();
    expect(section()).toBe('payslips');
  });

  it('Back closes the phone menu first', async () => {
    open('/staff?tab=payslips');
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    expect(screen.getByRole('navigation', { name: 'Menu' })).toBeTruthy();
    await back();
    expect(screen.queryByRole('navigation', { name: 'Menu' })).toBeNull();
    expect(section()).toBe('payslips');
  });
});

describe('the phone Back button', () => {
  it('is not shown on home', () => {
    open('/staff');
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
  });

  it('goes to the previous section', async () => {
    open('/staff');
    fireEvent.click(screen.getByText('Payslips'));
    fireEvent.click(screen.getByText('Leave'));
    await act(async () => {
      const popped = new Promise((r) => window.addEventListener('popstate', r, { once: true }));
      fireEvent.click(screen.getByRole('button', { name: 'Back' }));
      await popped;
    });
    expect(section()).toBe('payslips');
  });

  it('goes home when the portal was opened on a section from a link', () => {
    open('/staff?tab=payslips');
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(section()).toBe('home');
    expect(window.location.search).toBe('');
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
  });
});
