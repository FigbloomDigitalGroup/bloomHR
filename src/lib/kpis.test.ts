import { describe, expect, it } from 'vitest';
import {
  MEASURE_FIXED,
  measureDetail,
  measuresFrom,
  ACHIEVEMENT_CAP,
  KPI_TEMPLATES,
  RATING_BANDS,
  achievement,
  checkWeights,
  currentQuarter,
  defaultPeriodId,
  formatValue,
  parseNumber,
  overallScore,
  ratingBand,
} from './kpis';

const hi = (target: number | null, actual: number | null) => achievement({ unit: 'number', direction: 'higher_is_better', target, actual });
const lo = (target: number | null, actual: number | null) => achievement({ unit: 'percent', direction: 'lower_is_better', target, actual });

describe('measures', () => {
  it('says what a calculated value came from', () => {
    expect(measureDetail('tasks_on_time', { on_time: 8, due: 10 })).toBe('8 of 10 due tasks done on time');
    expect(measureDetail('tasks_on_time', { due: 0 })).toBe('No tasks due yet');
    expect(measureDetail('tasks_late', { late: 1, due: 1 })).toBe('1 of 1 due task late');
    expect(measureDetail('tasks_completed', { done: 1 })).toBe('1 task done');
    expect(measureDetail('task_days', { done: 4 })).toBe('Median of 4 tasks done');
    expect(measureDetail('manual', { done: 4 })).toBe('');
    expect(measureDetail('tasks_completed', null)).toBe('');
    expect(measureDetail('attendance_rate', { present: 18, expected: 20 })).toBe('Clocked in 18 of 20 working days');
    expect(measureDetail('attendance_rate', { present: 0, expected: 0 })).toBe('No working days to count yet');
    expect(measureDetail('punctuality', { on_time: 1, present: 1 })).toBe('On time 1 of 1 day');
    expect(measureDetail('absent_days', { absent: 2, expected: 20 })).toBe('2 of 20 working days');
    expect(measureDetail('avg_hours', { days: 5 })).toBe('Over 5 days clocked in and out');
  });

  it('groups the calculated measures by where they come from', () => {
    expect(measuresFrom('tasks')).toEqual(['tasks_on_time', 'tasks_completed', 'tasks_late', 'task_days']);
    expect(measuresFrom('attendance')).toEqual(['attendance_rate', 'punctuality', 'absent_days', 'avg_hours']);
    expect(MEASURE_FIXED.absent_days).toEqual({ unit: 'number', direction: 'lower_is_better' });
  });

  it('fixes the unit and direction of each calculated measure', () => {
    expect(MEASURE_FIXED.tasks_on_time).toEqual({ unit: 'percent', direction: 'higher_is_better' });
    expect(MEASURE_FIXED.tasks_late.direction).toBe('lower_is_better');
  });
});

describe('achievement', () => {
  it('higher is better: actual / target, capped', () => {
    expect(hi(100, 80)).toBe(80);
    expect(hi(100, 100)).toBe(100);
    expect(hi(100, 120)).toBe(120);
    expect(hi(100, 400)).toBe(ACHIEVEMENT_CAP);
    expect(hi(100, -5)).toBe(0);
  });

  it('lower is better: target / actual, capped; zero errors against a target above zero is the cap', () => {
    expect(lo(2, 4)).toBe(50);
    expect(lo(2, 2)).toBe(100);
    expect(lo(2, 1)).toBe(ACHIEVEMENT_CAP);
    expect(lo(2, 0)).toBe(ACHIEVEMENT_CAP);
  });

  it('a target of zero', () => {
    expect(hi(0, 0)).toBe(100);
    expect(hi(0, 5)).toBe(100);
    expect(lo(0, 0)).toBe(100);
    expect(lo(0, 1)).toBe(0);
  });

  it('nothing to score without an actual, or without a target for a number', () => {
    expect(hi(100, null)).toBeNull();
    expect(hi(null, 10)).toBeNull();
  });

  it('yes/no is 0 or 100, reversed when lower is better', () => {
    expect(achievement({ unit: 'yes_no', direction: 'higher_is_better', target: 1, actual: 1 })).toBe(100);
    expect(achievement({ unit: 'yes_no', direction: 'higher_is_better', target: 1, actual: 0 })).toBe(0);
    expect(achievement({ unit: 'yes_no', direction: 'lower_is_better', target: 0, actual: 1 })).toBe(0);
    expect(achievement({ unit: 'yes_no', direction: 'lower_is_better', target: null, actual: 0 })).toBe(100);
  });

  it('a rating is rating / 5, whatever the target', () => {
    expect(achievement({ unit: 'rating_1_5', direction: 'higher_is_better', target: 4, actual: 4 })).toBe(80);
    expect(achievement({ unit: 'rating_1_5', direction: 'higher_is_better', target: null, actual: 5 })).toBe(100);
  });
});

describe('overallScore', () => {
  it('is the weighted average of the scored KPIs', () => {
    expect(overallScore([{ weight: 60, achievement: 100 }, { weight: 40, achievement: 50 }])).toEqual({ score: 80, scored: 2, total: 2 });
  });

  it('leaves out unscored KPIs and weight 0', () => {
    expect(overallScore([{ weight: 50, achievement: 120 }, { weight: 50, achievement: null }, { weight: 0, achievement: 10 }]))
      .toEqual({ score: 120, scored: 2, total: 3 });
  });

  it('has no score when nothing is scored', () => {
    expect(overallScore([{ weight: 100, achievement: null }]).score).toBeNull();
    expect(overallScore([]).score).toBeNull();
  });
});

describe('ratingBand', () => {
  it('Exceeds from 110, Meets from 90, else Below', () => {
    expect(ratingBand(110)?.id).toBe('exceeds');
    expect(ratingBand(109.9)?.id).toBe('meets');
    expect(ratingBand(90)?.id).toBe('meets');
    expect(ratingBand(89.9)?.id).toBe('below');
    expect(ratingBand(0)?.id).toBe('below');
    expect(ratingBand(null)).toBeNull();
    expect(RATING_BANDS.map((b) => b.label)).toEqual(['Exceeds', 'Meets', 'Below']);
  });
});

describe('checkWeights', () => {
  it('is fine at 100', () => {
    expect(checkWeights([60, 40])).toEqual({ total: 100, ok: true, warning: null });
    expect(checkWeights([33.3, 33.3, 33.4]).ok).toBe(true);
  });

  it('warns above or below', () => {
    const over = checkWeights([60, 60]);
    expect(over.ok).toBe(false);
    expect(over.warning).toMatch(/120%.*Lower/);
    const under = checkWeights([50, null]);
    expect(under.total).toBe(50);
    expect(under.warning).toMatch(/Raise/);
  });
});

describe('formatValue', () => {
  it('reads by unit', () => {
    expect(formatValue('currency_ksh', 1500)).toBe('KSh 1,500');
    expect(formatValue('percent', 2.5)).toBe('2.5%');
    expect(formatValue('yes_no', 1)).toBe('Yes');
    expect(formatValue('rating_1_5', 4)).toBe('4 / 5');
    expect(formatValue('number', null)).toBe('—');
  });
});

describe('form helpers', () => {
  it('parseNumber takes commas and refuses words', () => {
    expect(parseNumber('1,500.5')).toBe(1500.5);
    expect(parseNumber('  ')).toBeNull();
    expect(parseNumber('abc')).toBeNull();
  });

  it('currentQuarter and defaultPeriodId', () => {
    expect(currentQuarter(new Date(2026, 9, 15))).toEqual({ name: 'Q4 2026', starts_on: '2026-10-01', ends_on: '2026-12-31', status: 'draft' });
    expect(currentQuarter(new Date(2027, 1, 1)).ends_on).toBe('2027-03-31');
    expect(defaultPeriodId([{ id: 'a', status: 'closed' }, { id: 'b', status: 'open' }])).toBe('b');
    expect(defaultPeriodId([{ id: 'a', status: 'closed' }])).toBe('a');
    expect(defaultPeriodId([])).toBe('');
  });
});

it('the starter templates add up to 100', () => {
  expect(checkWeights(KPI_TEMPLATES.map((t) => t.default_weight)).ok).toBe(true);
});
