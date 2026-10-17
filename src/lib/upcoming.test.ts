import { describe, expect, it } from 'vitest';
import {
  comingUp, holidayDates, inDaysLabel, leaveHints, myOpenTasks, nextHolidays, shortDay, tasksDuringLeave, type TaskRow,
} from './upcoming';

const today = new Date(2026, 9, 17); // Sat 17 Oct 2026

const task = (over: Partial<TaskRow>): TaskRow => ({
  id: 't1', key: 'OPS-1', title: 'Task', status: 'todo', due_date: '2026-10-20', assignee_number: 'E1', is_group: false, ...over,
});

describe('holidayDates', () => {
  it('repeats recurring holidays every year and keeps one-off ones on their own date', () => {
    const list = holidayDates(
      [
        { name: 'Mashujaa Day', date: '2019-10-20', recurring: true },
        { name: 'Election Day', date: '2026-10-27', recurring: false },
        { name: 'Old one-off', date: '2025-10-21', recurring: false },
      ],
      today,
      new Date(2026, 10, 30)
    );
    expect(list.map((h) => [h.name, shortDay(h.date)])).toEqual([
      ['Mashujaa Day', 'Tue 20 Oct'],
      ['Election Day', 'Tue 27 Oct'],
    ]);
  });

  it('crosses the year end', () => {
    const list = holidayDates(
      [
        { name: 'Christmas Day', date: '2020-12-25', recurring: true },
        { name: "New Year's Day", date: '2020-01-01', recurring: true },
      ],
      new Date(2026, 11, 20),
      new Date(2027, 0, 10)
    );
    expect(list.map((h) => [h.name, h.date.getFullYear(), h.date.getMonth(), h.date.getDate()])).toEqual([
      ['Christmas Day', 2026, 11, 25],
      ["New Year's Day", 2027, 0, 1],
    ]);
  });

  it('reads the date as a local day, not UTC', () => {
    const [h] = holidayDates([{ name: 'X', date: '2026-10-20', recurring: false }], today, new Date(2026, 9, 31));
    expect(h.date).toEqual(new Date(2026, 9, 20));
  });
});

describe('comingUp', () => {
  it('mixes events, holidays, my leave and my tasks, overdue tasks first, then soonest', () => {
    const list = comingUp(
      {
        events: [
          { id: 'e1', title: 'Town hall', date: '2026-10-22', description: 'Main hall' },
          { id: 'e2', title: 'Past party', date: '2026-10-01' },
          { id: 'e3', title: 'Far away', date: '2027-06-01' },
        ],
        holidays: [{ name: 'Mashujaa Day', date: '2019-10-20', recurring: true }],
        leave: [
          { type: 'Annual Leave', start: '2026-10-26', end: '2026-10-28', status: 'approved' },
          { type: 'Sick Leave', start: '2026-10-30', end: '2026-10-30', status: 'rejected' },
        ],
        tasks: [
          task({ id: 'late', title: 'Late report', due_date: '2026-10-10' }),
          task({ id: 'soon', title: 'Stock count', due_date: '2026-10-21' }),
          task({ id: 'done', title: 'Done one', due_date: '2026-10-19', status: 'done' }),
          task({ id: 'other', title: 'Not mine', due_date: '2026-10-19', assignee_number: 'E2' }),
        ],
        employeeNumber: 'E1',
      },
      today,
      90
    );
    expect(list.map((i) => [i.kind, i.title, i.daysAway])).toEqual([
      ['task', 'Late report', -7],
      ['holiday', 'Mashujaa Day', 3],
      ['task', 'Stock count', 4],
      ['event', 'Town hall', 5],
      ['leave', 'My Annual Leave', 9],
    ]);
    expect(list[0].overdue).toBe(true);
    expect(list[0].taskId).toBe('late');
    expect(list.find((i) => i.kind === 'event')?.detail).toBe('Main hall');
  });

  it('keeps a leave already under way, and wraps round the year end', () => {
    const dec = new Date(2026, 11, 28);
    const list = comingUp(
      {
        leave: [{ type: 'Annual Leave', start: '2026-12-21', end: '2027-01-04', status: 'pending' }],
        holidays: [{ name: "New Year's Day", date: '2000-01-01', recurring: true }],
      },
      dec,
      30
    );
    expect(list.map((i) => [i.kind, i.title, i.daysAway])).toEqual([
      ['leave', 'My Annual Leave (pending)', -7],
      ['holiday', "New Year's Day", 4],
    ]);
  });

  it('only looks as far ahead as asked', () => {
    const input = { events: [{ title: 'In 60 days', date: '2026-12-16' }] };
    expect(comingUp(input, today, 30)).toHaveLength(0);
    expect(comingUp(input, today, 90)).toHaveLength(1);
  });
});

describe('myOpenTasks', () => {
  it('leaves out done, cancelled, group and undated tasks and other people’s', () => {
    const list = myOpenTasks(
      [
        task({ id: 'a', due_date: '2026-10-25' }),
        task({ id: 'b', status: 'cancelled' }),
        task({ id: 'c', is_group: true }),
        task({ id: 'd', due_date: null }),
        task({ id: 'e', assignee_number: 'E9' }),
        task({ id: 'f', due_date: '2026-10-18', status: 'in_progress' }),
      ],
      'E1'
    );
    expect(list.map((t) => t.id)).toEqual(['f', 'a']);
  });
});

describe('leave planning', () => {
  const holidays = [{ name: 'Mashujaa Day', date: '2019-10-20', recurring: true }];
  const events = [
    { title: 'Town hall', date: '2026-10-22' },
    { title: 'Team lunch', date: '2026-10-24' },
    { title: 'Far event', date: '2026-11-15' },
  ];

  it('names holidays and events in the leave and on the days either side', () => {
    expect(leaveHints('2026-10-20', '2026-10-23', events, holidays).map((h) => h.text)).toEqual([
      'Mashujaa Day (Tue 20 Oct) is a public holiday, not counted',
      'Town hall on Thu 22 Oct during your leave',
      'Team lunch on Sat 24 Oct, the day after your leave ends',
    ]);
    expect(leaveHints('2026-10-21', '2026-10-21', [], holidays).map((h) => [h.relation, h.text])).toEqual([
      ['before', 'Mashujaa Day (Tue 20 Oct) is a public holiday the day before your leave starts'],
    ]);
  });

  it('says nothing for dates that do not make a range', () => {
    expect(leaveHints('', '', events, holidays)).toEqual([]);
    expect(leaveHints('2026-10-25', '2026-10-20', events, holidays)).toEqual([]);
  });

  it('finds my open tasks due during the leave', () => {
    const tasks = [
      task({ id: 'in', due_date: '2026-10-21' }),
      task({ id: 'last-day', due_date: '2026-10-23' }),
      task({ id: 'after', due_date: '2026-10-24' }),
      task({ id: 'done', due_date: '2026-10-22', status: 'done' }),
    ];
    expect(tasksDuringLeave('2026-10-20', '2026-10-23', tasks, 'E1').map((t) => t.id)).toEqual(['in', 'last-day']);
  });

  it('lists the next public holidays, across the year end', () => {
    const next = nextHolidays(
      [
        { name: 'Jamhuri Day', date: '2010-12-12', recurring: true },
        { name: 'Mashujaa Day', date: '2010-10-20', recurring: true },
        { name: 'Labour Day', date: '2010-05-01', recurring: true },
      ],
      new Date(2026, 10, 1),
      2
    );
    expect(next.map((h) => [h.name, h.date.getFullYear(), h.daysAway])).toEqual([
      ['Jamhuri Day', 2026, 41],
      ['Labour Day', 2027, 181],
    ]);
  });
});

describe('inDaysLabel', () => {
  it('words the gap', () => {
    expect([0, 1, 12, -1, -3].map(inDaysLabel)).toEqual(['Today', 'Tomorrow', 'in 12 days', 'Yesterday', '3 days ago']);
  });
});
