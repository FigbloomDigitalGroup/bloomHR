// The ids that tie a tab to its panel (Tabs.tsx makes the tabs; the page that uses them makes the panel).
export const tabId = (prefix: string, id: string) => `${prefix}-tab-${id}`;
export const panelId = (prefix: string, id: string) => `${prefix}-panel-${id}`;
