import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const api = vi.hoisted(() => ({ loadQuizToTake: vi.fn(), submitQuiz: vi.fn() }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../lib/supabase', () => ({ supabase: {} }));
vi.mock('../../lib/afterHiring', async (importOriginal) => ({ ...(await importOriginal<object>()), ...api }));

import toast from 'react-hot-toast';
import OrientationChecklist from './OrientationChecklist';
import QuizTaker from './QuizTaker';
import { quizError, type ChecklistItem } from '../../lib/afterHiring';

const item = (id: string, owner_role: ChecklistItem['owner_role'], done_at: string | null = null, due_date = '2099-01-01'): ChecklistItem => ({
  id, title: `Item ${id}`, description: null, owner_role, due_date, done_at,
});

beforeEach(() => {
  for (const f of Object.values(api)) f.mockReset();
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});
afterEach(() => cleanup());

describe('OrientationChecklist', () => {
  it('shows progress, and lets the viewer tick only the items they may', async () => {
    const onToggle = vi.fn().mockResolvedValue(undefined);
    render(<OrientationChecklist items={[item('1', 'hr', '2026-10-01T00:00:00Z'), item('2', 'employee'), item('3', 'manager', null, '2020-01-01')]}
      canTick={(i) => i.owner_role === 'employee'} onToggle={onToggle} />);
    expect(screen.getByText('1 of 3 done')).toBeTruthy();
    expect((screen.getByLabelText('Item 1') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText('Item 3') as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText('Overdue')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Item 2'));
    await waitFor(() => expect(onToggle).toHaveBeenCalledWith(expect.objectContaining({ id: '2' }), true));
  });

  it('reports a refused tick', async () => {
    render(<OrientationChecklist items={[item('2', 'employee')]} canTick={() => true} onToggle={vi.fn().mockRejectedValue(new Error('HR ticks this item'))} />);
    fireEvent.click(screen.getByLabelText('Item 2'));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('HR ticks this item'));
  });
});

describe('QuizTaker', () => {
  const quiz = {
    title: 'Policies quiz', description: null, pass_mark: 60,
    questions: [{ id: 'q1', question: 'Hours start at?', options: ['7am', '8am'] }, { id: 'q2', question: 'Report incidents to?', options: ['HR', 'Nobody'] }],
  };

  it('needs every question answered, then sends the chosen indexes and shows the score', async () => {
    api.loadQuizToTake.mockResolvedValue(quiz);
    api.submitQuiz.mockResolvedValue({ score: 50, passed: false, correct: 1, total: 2, pass_mark: 60 });
    const onFinished = vi.fn();
    render(<QuizTaker assignmentId="a1" onFinished={onFinished} onClose={vi.fn()} />);
    fireEvent.click(await screen.findByLabelText('8am'));
    fireEvent.click(screen.getByText('Send answers'));
    expect(screen.getByRole('alert').textContent).toMatch(/1 left/);
    expect(api.submitQuiz).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText('Nobody'));
    fireEvent.click(screen.getByText('Send answers'));
    expect(await screen.findByText('Not passed this time')).toBeTruthy();
    expect(screen.getByText(/You scored 50% \(1 of 2 right\)/)).toBeTruthy();
    expect(api.submitQuiz).toHaveBeenCalledWith('a1', [1, 1]);
    expect(onFinished).toHaveBeenCalled();
  });

  it('says when the test was already taken', async () => {
    api.loadQuizToTake.mockRejectedValue(new Error('You have already taken this test'));
    render(<QuizTaker assignmentId="a1" onFinished={vi.fn()} onClose={vi.fn()} />);
    expect(await screen.findByText('You have already taken this test')).toBeTruthy();
  });
});

describe('quizError', () => {
  it('checks title, pass mark and that each question has choices and a right answer', () => {
    const base = { title: 'T', pass_mark: 70, due_days: 14, questions: [{ question: 'Q', options: ['a', 'b'], correct_index: 1 }] };
    expect(quizError(base)).toBeNull();
    expect(quizError({ ...base, pass_mark: 120 })).toMatch(/0 to 100/);
    expect(quizError({ ...base, questions: [] })).toMatch(/at least one question/);
    expect(quizError({ ...base, questions: [{ question: 'Q', options: ['a', ' '], correct_index: 0 }] })).toMatch(/two filled-in choices/);
    expect(quizError({ ...base, questions: [{ question: 'Q', options: ['a', 'b'], correct_index: 2 }] })).toMatch(/right answer/);
  });
});
