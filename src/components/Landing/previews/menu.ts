import { SIDEBAR_MENU } from '../../../lib/sidebarMenu';

// The previews name screens with the app's own menu text (src/lib/sidebarMenu.ts), so a label cannot drift from the product.
const LABELS = new Map(SIDEBAR_MENU.flatMap((group) => group.items.map((item) => [item.id, item.label] as const)));

export const menuLabel = (id: string): string => LABELS.get(id) ?? id;
