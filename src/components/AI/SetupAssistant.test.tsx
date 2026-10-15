import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { SetupState } from '../../lib/setupAssistant';

const state = vi.hoisted(() => ({ canUse: true }));
const askSetup = vi.hoisted(() => vi.fn());
const applyProposal = vi.hoisted(() => vi.fn());
const loadSetupState = vi.hoisted(() => vi.fn());

vi.mock('../../hooks/usePermissions', () => ({
  usePermissions: () => ({ loading: false, hasPermission: () => state.canUse }),
}));
vi.mock('../../services/ai', () => ({ askSetup }));
vi.mock('../../lib/setupAssistant', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/setupAssistant')>()),
  loadSetupState,
  applyProposal,
}));

import SetupAssistant from './SetupAssistant';

const setup = (over: Partial<SetupState> = {}): SetupState => ({
  companyName: 'Bloom Farm',
  profile: null,
  departments: [{ id: 'd1', name: 'Finance', parent_id: null, head_employee_id: null, active: true }],
  jobGroups: [],
  numbering: null,
  invitations: [],
  employeeCount: 0,
  ...over,
});

const show = () =>
  render(
    <MemoryRouter>
      <SetupAssistant />
    </MemoryRouter>
  );

const say = async (text: string) => {
  fireEvent.change(await screen.findByLabelText('Message'), { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
};

beforeEach(() => {
  state.canUse = true;
  askSetup.mockReset();
  applyProposal.mockReset();
  loadSetupState.mockReset().mockResolvedValue(setup());
});
afterEach(() => cleanup());

describe('Set up with AI', () => {
  it('greets the company and sends the conversation with what is set up', async () => {
    askSetup.mockResolvedValue({ reply: 'Great. What departments do you have?', proposals: [] });
    show();
    expect(await screen.findByText(/I'll help you set up Bloom Farm/)).toBeTruthy();
    await say('We grow flowers.');
    expect(await screen.findByText('Great. What departments do you have?')).toBeTruthy();
    const [messages, company] = askSetup.mock.calls[0];
    expect(messages.map((m: { role: string }) => m.role)).toEqual(['assistant', 'user']);
    expect(JSON.parse(messages[0].content)).toMatchObject({ reply: expect.stringContaining('Bloom Farm'), proposals: [] });
    expect(messages[1]).toEqual({ role: 'user', content: 'We grow flowers.' });
    expect(company).toMatchObject({ company_name: 'Bloom Farm', departments: ['Finance'] });
  });

  it('shows only what is new, applies it on a click, and tells the AI what became of it', async () => {
    askSetup.mockResolvedValueOnce({
      reply: 'Here are your departments.',
      proposals: [{ type: 'departments', items: [{ name: 'Finance', parent: null }, { name: 'Farm', parent: null }] }],
    });
    applyProposal.mockResolvedValue('Added 1 department.');
    show();
    await say('Finance and Farm.');
    expect(await screen.findByText('1 department')).toBeTruthy(); // Finance exists already
    expect(screen.getByText('Farm')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Add departments' }));
    expect(await screen.findByText('Added 1 department.')).toBeTruthy();
    expect(applyProposal).toHaveBeenCalledWith({ type: 'departments', items: [{ name: 'Farm', parent: null }] }, expect.anything());
    expect(screen.getByText('Applied')).toBeTruthy();
    await waitFor(() => expect(loadSetupState).toHaveBeenCalledTimes(2)); // looks again after applying

    askSetup.mockResolvedValueOnce({ reply: 'Next: job groups.', proposals: [] });
    fireEvent.click(screen.getByRole('button', { name: "Done with those. What's next?" }));
    await screen.findByText('Next: job groups.');
    const turn = JSON.parse(askSetup.mock.calls[1][0][2].content);
    expect(turn.proposals[0].status).toBe('applied');
  });

  it('says why a change was refused and lets the person try again or skip', async () => {
    askSetup.mockResolvedValue({ reply: 'Shall I?', proposals: [{ type: 'job_groups', items: [{ code: 'JG1', name: 'Management' }] }] });
    applyProposal.mockRejectedValue(new Error('Only payroll can change job groups'));
    show();
    await say('Yes');
    fireEvent.click(await screen.findByRole('button', { name: 'Add job groups' }));
    expect(await screen.findByText('Only payroll can change job groups')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
    expect(screen.getByText('Skipped')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it('shows an AI error without losing the conversation', async () => {
    askSetup.mockRejectedValue(new Error('AI limit reached for now. Try again later.'));
    show();
    await say('Hello');
    expect(await screen.findByText('AI limit reached for now. Try again later.')).toBeTruthy();
    expect(screen.getByText('Hello')).toBeTruthy();
  });

  it('is only for people with Settings', async () => {
    state.canUse = false;
    show();
    expect(screen.getByText(/Only administrators and people with Settings/)).toBeTruthy();
    expect(loadSetupState).not.toHaveBeenCalled();
  });
});
