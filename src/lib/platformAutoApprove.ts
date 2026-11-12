import { apiRequest } from './adminApi';

// The Figbloom platform's auto-approve switch, per product, in the console (/platform/settings; the backend is
// platform_settings_routes.js). The platform has a platform-wide default, and each product may have its own switch,
// which decides whether a new organisation that product registers (an HR company, a school group, a Fleet company)
// starts active or waits for approval in the console. A product with no switch of its own follows the default.
// Anyone in the console sees them; Owner and Admin change them (the backend checks).

export type AutoApproveModule = 'hr' | 'schools' | 'fleet';

export interface ProductAutoApprove {
  module: AutoApproveModule;
  /** the product's name in the console, e.g. "Figbloom Fleet" */
  label: string;
  /** the product's own switch; null when it follows the platform default */
  own: boolean | null;
  /** what applies to a new organisation now */
  effective: boolean;
  /** whether it follows the platform default */
  inherited: boolean;
}

export interface AutoApproveSettings {
  /** the platform-wide default */
  default: boolean;
  products: ProductAutoApprove[];
  /** whether the signed-in person may change them (Owner, Admin) */
  can_change?: boolean;
}

/** As the backend allows. */
export const MAX_AUTO_APPROVE_REASON = 500;

function checked(result: AutoApproveSettings | null | undefined): AutoApproveSettings {
  if (!result || !Array.isArray(result.products)) throw new Error('The Figbloom platform sent something the console does not understand.');
  return result;
}

export async function getAutoApprove(): Promise<AutoApproveSettings> {
  return checked(await apiRequest<AutoApproveSettings>('GET', '/platform/settings/auto-approve'));
}

/** Switch one product on or off, or (null) back to following the platform default. Returns the settings now. */
export async function setProductAutoApprove(module: AutoApproveModule, enabled: boolean | null, reason = ''): Promise<AutoApproveSettings> {
  const trimmed = reason.trim();
  return checked(
    await apiRequest<AutoApproveSettings>('PUT', `/platform/settings/auto-approve/${encodeURIComponent(module)}`, {
      enabled,
      ...(trimmed ? { reason: trimmed } : {}),
    })
  );
}

/** In words, for a product's row. */
export function autoApproveText(p: ProductAutoApprove, platformDefault: boolean): string {
  const now = p.effective ? 'On: a new organisation starts active.' : 'Off: a new organisation waits for approval.';
  const source = p.inherited ? `Follows the platform default (${platformDefault ? 'on' : 'off'}).` : 'Set for this product.';
  return `${now} ${source}`;
}
