import { ADMIN_ONLY_MODULES, moduleAllowedForBase } from './roles';
import { moduleInfo } from './modules';
import { SCREENS, canOpenScreen, inMenu, isHiddenScreen, screenFor, usesStaffPortal } from './routeModules';
import { SIDEBAR_MENU, STAFF_PORTAL_MAIL, STAFF_PORTAL_MENU, STAFF_PORTAL_MY_TEAM, STAFF_PORTAL_MY_WORK } from './sidebarMenu';

// "Preview as this role" on the Roles screen: exactly what someone holding a role would see, worked out with the
// same rules the app uses (routeModules.ts for the admin app's menu and routes, usesStaffPortal for who gets the staff
// portal instead). Nobody is signed in as anyone: it is a list, worked out from the ticked modules, so it follows the
// ticks as they change, before they are saved.

export interface PreviewEntry {
  label: string;
  /** the admin app's path (none for the staff portal's entries) */
  path?: string;
  /** for an entry they would not see: what would show it */
  needs?: string;
  /** for an entry that shows only sometimes, whatever the role: when */
  when?: string;
}

export interface PreviewArea {
  title: string;
  shown: PreviewEntry[];
  hidden: PreviewEntry[];
}

export interface RolePreview {
  workspace: 'admin' | 'portal';
  /** the menu, area by area */
  areas: PreviewArea[];
  /** admin app: screens they can open that are not in their menu (the header search, a link or a notification) */
  alsoOpens: PreviewEntry[];
}

/**
 * Does a role with this base role and these ticked modules hold the module? As the app decides it: administrators hold
 * everything; anyone else what is ticked, and never what their base role may not hold (usePermissions drops those for
 * a company's own role, and the database refuses to save them).
 */
export const holdsModule = (base: string, modules: string[]) => (module: string) =>
  base === 'ADMIN' || (modules.includes(module) && moduleAllowedForBase(base, module));

const moduleName = (id: string) => moduleInfo(id)?.name ?? id;

/** "Payroll", "Payroll or Staff loans", "Payroll, Employees or Overtime" */
const orList = (names: string[]) =>
  names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`;

/** What would show a screen this role does not get: the modules to tick, or why it cannot have it at all. */
export function whatWouldShow(base: string, modules: string[]): string {
  const allowed = modules.filter((m) => moduleAllowedForBase(base, m));
  if (allowed.length > 0) return `Tick ${orList(allowed.map(moduleName))}`;
  return modules.some((m) => ADMIN_ONLY_MODULES.includes(m)) ? 'Only for roles based on Administrator' : 'Not for roles based on Staff';
}

function adminPreview(base: string, modules: string[]): RolePreview {
  const has = holdsModule(base, modules);
  const menuPaths = new Set<string>();
  const areas = SIDEBAR_MENU.map((group) => {
    const shown: PreviewEntry[] = [];
    const hidden: PreviewEntry[] = [];
    for (const item of group.items) {
      const screen = screenFor(item.path);
      // a screen switched off for every company (hiddenModules.ts) is not offered to anyone, so it is not listed
      if (!screen || isHiddenScreen(screen)) continue;
      menuPaths.add(item.path);
      if (inMenu(item.path, has)) shown.push({ label: item.label, path: item.path });
      else hidden.push({ label: item.label, path: item.path, needs: whatWouldShow(base, screen.menuModules ?? screen.modules) });
    }
    return { title: group.title, shown, hidden };
  }).filter((a) => a.shown.length + a.hidden.length > 0);

  // screens they may open though their menu does not list them
  const seen = new Set<string>();
  const alsoOpens: PreviewEntry[] = [];
  for (const s of SCREENS) {
    const inTheirMenu = menuPaths.has(s.path) && inMenu(s.path, has);
    const reachable = s.searchable || menuPaths.has(s.path);
    if (!reachable || inTheirMenu || !canOpenScreen(s.path, has) || seen.has(s.label)) continue;
    // the same screen under another path is already in their menu (e.g. "/" and "/dashboard")
    if (areas.some((a) => a.shown.some((e) => e.label === s.label))) continue;
    seen.add(s.label);
    alsoOpens.push({ label: s.label, path: s.path });
  }
  return { workspace: 'admin', areas, alsoOpens };
}

/** Inside the portal's Tasks: the extras a role's modules add. */
const PORTAL_TASK_EXTRAS: { module: string; label: string }[] = [
  { module: 'task-projects', label: 'Manage projects (create projects, assign tasks to teams)' },
  { module: 'task-oversight', label: 'See every task, read-only' },
];

function portalPreview(base: string, modules: string[]): RolePreview {
  const has = holdsModule(base, modules);
  const entries = (group: (typeof STAFF_PORTAL_MENU)[number]) =>
    group.items.flatMap((item) => (item.submenu ? item.submenu.map((sub) => ({ label: `${item.label}: ${sub.label}` })) : [{ label: item.label }]));

  const areas: PreviewArea[] = STAFF_PORTAL_MENU.map((group) => ({ title: group.title, shown: entries(group), hidden: [] }));
  // the extras inside Tasks follow the role's modules
  const work = areas.find((a) => a.title === 'Work & Development');
  if (work) {
    for (const x of PORTAL_TASK_EXTRAS) {
      if (has(x.module)) work.shown.push({ label: `Tasks: ${x.label}` });
      else work.hidden.push({ label: `Tasks: ${x.label}`, needs: whatWouldShow(base, [x.module]) });
    }
  }
  // Mail, their own mailbox, follows the My mailbox module
  const communication = areas.find((a) => a.title === 'Communication');
  if (communication) {
    const label = `Communication: ${STAFF_PORTAL_MAIL.label}`;
    if (has('mailbox')) communication.shown.unshift({ label });
    else communication.hidden.push({ label, needs: whatWouldShow(base, ['mailbox']) });
  }
  // two sections follow the person, not the role
  areas.splice(1, 0,
    { title: STAFF_PORTAL_MY_WORK.title, shown: [{ label: 'My work', when: 'Only for someone paid by work or given contract jobs' }], hidden: [] },
    { title: STAFF_PORTAL_MY_TEAM.title, shown: [{ label: 'My team', when: 'Only for someone who supervises at least one person' }], hidden: [] },
  );
  return { workspace: 'portal', areas, alsoOpens: [] };
}

/** What someone holding a role with this base role and these ticked modules would see. */
export function previewRole(base: string, modules: string[]): RolePreview {
  return usesStaffPortal(base) ? portalPreview(base, modules) : adminPreview(base, modules);
}
