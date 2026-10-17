import { describe, expect, it, vi } from 'vitest';

vi.mock('./supabase', () => ({ supabase: {} }));

import { previewEmployees, targetOf, templateProblem, templateWeights, type KpiTemplateInput, type KpiTemplateRecord } from './kpiTemplates';

const tpl = (over: Partial<KpiTemplateRecord>): KpiTemplateRecord => ({
  id: 't', name: 'T', description: null, applies_to: 'everyone', department_id: null, job_title_id: null, job_group_id: null,
  active: true, created_at: '2026-10-01T00:00:00Z', items: [], ...over,
});
const input = (over: Partial<KpiTemplateInput>): KpiTemplateInput => ({
  name: 'Sales team', description: null, applies_to: 'department', target: 'd1', active: true,
  items: [{ kpi_id: 'k1', target: null, weight: 60 }, { kpi_id: 'k2', target: 5, weight: 40 }], ...over,
});

describe('templateWeights', () => {
  it('is fine at exactly 100', () => {
    expect(templateWeights([{ weight: 60 }, { weight: 40 }])).toEqual({ total: 100, ok: true, problem: null });
  });
  it('explains what is wrong otherwise', () => {
    expect(templateWeights([{ weight: 60 }, { weight: 30 }]).problem).toMatch(/total 90%; they must total 100%/);
    expect(templateWeights([]).problem).toMatch(/Add KPIs/);
    expect(templateWeights([{ weight: 33.3 }, { weight: 33.3 }, { weight: 33.4 }]).ok).toBe(true);
  });
});

describe('templateProblem', () => {
  it('accepts a complete template', () => expect(templateProblem(input({}))).toBeNull());
  it('needs a name, a target (except for everyone) and KPIs on every line, once each', () => {
    expect(templateProblem(input({ name: ' ' }))).toMatch(/name/);
    expect(templateProblem(input({ target: null }))).toMatch(/Choose who/);
    expect(templateProblem(input({ applies_to: 'everyone', target: null }))).toBeNull();
    expect(templateProblem(input({ items: [{ kpi_id: '', target: null, weight: 100 }] }))).toMatch(/every line/);
    expect(templateProblem(input({ items: [{ kpi_id: 'k1', target: null, weight: 50 }, { kpi_id: 'k1', target: null, weight: 50 }] }))).toMatch(/once/);
    expect(templateProblem(input({ items: [{ kpi_id: 'k1', target: null, weight: 120 }] }))).toMatch(/0 to 100/);
  });
  it('an active template must total 100; one turned off may be saved unfinished', () => {
    const half = [{ kpi_id: 'k1', target: null, weight: 50 }];
    expect(templateProblem(input({ items: half }))).toMatch(/must total 100%/);
    expect(templateProblem(input({ items: half, active: false }))).toBeNull();
  });
});

describe('targetOf', () => {
  it('is the id that goes with what the template applies to', () => {
    expect(targetOf(tpl({ applies_to: 'job_title', job_title_id: 'jt' }))).toBe('jt');
    expect(targetOf(tpl({ applies_to: 'everyone' }))).toBeNull();
  });
});

describe('previewEmployees', () => {
  const all = tpl({ id: 'all', items: [{ kpi_id: 'att', target: null, weight: 100 }] });
  const dept = tpl({ id: 'dept', applies_to: 'department', items: [{ kpi_id: 'rev', target: null, weight: 60 }, { kpi_id: 'att', target: null, weight: 40 }] });
  const parent = tpl({ id: 'parent', applies_to: 'department', items: [{ kpi_id: 'att', target: null, weight: 100 }] });
  const title = tpl({ id: 'title', applies_to: 'job_title', items: [{ kpi_id: 'rev', target: null, weight: 70 }, { kpi_id: 'calls', target: null, weight: 30 }] });
  const off = tpl({ id: 'off', active: false, items: [{ kpi_id: 'x', target: null, weight: 100 }] });

  it('gives each KPI once, from the highest priority template (job title > department > everyone)', () => {
    const [p] = previewEmployees(
      [
        { template_id: 'all', employee_number: 'E1', priority: 5, depth: 0 },
        { template_id: 'dept', employee_number: 'E1', priority: 4, depth: 0 },
        { template_id: 'title', employee_number: 'E1', priority: 2, depth: 0 },
        { template_id: 'off', employee_number: 'E1', priority: 5, depth: 0 },
      ],
      [all, dept, title, off]
    );
    const by = Object.fromEntries(p.kpis.map((k) => [k.kpi_id, k.template_id]));
    expect(by).toEqual({ att: 'dept', rev: 'title', calls: 'title' });
    expect(p.weightTotal).toBe(140);
  });

  it('the nearer department wins', () => {
    const [p] = previewEmployees(
      [
        { template_id: 'parent', employee_number: 'E1', priority: 4, depth: 1 },
        { template_id: 'dept', employee_number: 'E1', priority: 4, depth: 0 },
      ],
      [parent, dept]
    );
    expect(p.kpis.find((k) => k.kpi_id === 'att')?.template_id).toBe('dept');
  });

  it('one well-formed template gives 100', () => {
    expect(previewEmployees([{ template_id: 'all', employee_number: 'E2', priority: 5, depth: 0 }], [all])[0].weightTotal).toBe(100);
  });
});
