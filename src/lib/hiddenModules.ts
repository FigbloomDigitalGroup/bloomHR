// Modules switched off for every company. Their pages, tables and data stay; taking an id out of this list brings
// the module back. Expenses is hidden until it can pay approved claims back through payroll (FIG-815).
export const HIDDEN_MODULES: ReadonlySet<string> = new Set(['expenses']);

export const isHiddenModule = (moduleId?: string | null) => !!moduleId && HIDDEN_MODULES.has(moduleId);
