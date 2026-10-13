import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const perms = vi.hoisted(() => ({ allowed: true }));
vi.mock('../../hooks/usePermissions', () => ({ usePermissions: () => ({ hasPermission: () => perms.allowed, loading: false }) }));
vi.mock('./AIAssistantPage', () => ({ AIAssistantPage: ({ widget }: { widget?: boolean }) => <div>assistant {widget ? 'widget' : 'page'}</div> }));

import AIAssistantWidget from './AIAssistantWidget';

const props = { selectedTown: '', selectedRegion: '', onTownChange: vi.fn(), onRegionChange: vi.fn() };
afterEach(() => { cleanup(); perms.allowed = true; });

describe('AIAssistantWidget', () => {
  it('opens the assistant as a chat from the corner button, and keeps it when closed', () => {
    render(<AIAssistantWidget {...props} />);
    expect(screen.queryByText('assistant widget')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Open the AI assistant' }));
    expect(screen.getByRole('dialog', { name: 'HR AI Assistant' }).className).toMatch(/\bflex\b/);
    fireEvent.click(screen.getByRole('button', { name: 'Close the assistant' }));
    expect(screen.getByText('assistant widget')).toBeTruthy(); // still there, so the conversation stays
    expect(screen.getByRole('dialog', { hidden: true }).className).toMatch(/\bhidden\b/);
  });

  it('is not shown to people without the AI Assistant permission', () => {
    perms.allowed = false;
    render(<AIAssistantWidget {...props} />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
