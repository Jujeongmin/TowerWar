/** Verse8 VXShop integration for the game's vanilla TypeScript client. */
import { VXShop, type VXShopItem } from '@verse8/platform/vanilla';
import type { UnitKind } from '../units';

export type PremiumItem = UnitKind | 'tempo_boost';
export const TEMPO_ITEM = 'tempo_boost';

/** Product IDs must exactly match the Verse8 VXShop dashboard. */
export const VX_PRODUCTS: Readonly<Record<'beergang_rainbow' | 'tempo_boost', { price: number }>> = {
  beergang_rainbow: { price: 500 },
  tempo_boost: { price: 300 },
};

export function isPremiumItem(item: string): item is keyof typeof VX_PRODUCTS {
  return Object.prototype.hasOwnProperty.call(VX_PRODUCTS, item);
}

export function initVxShop(): void {
  VXShop.init();
}

export function vxShopItem(item: PremiumItem): VXShopItem | undefined {
  return isPremiumItem(item) ? VXShop.getItem(item) : undefined;
}

/** Dashboard price is authoritative after loading; configured price is the loading fallback. */
export function vxPrice(item: PremiumItem): number | null {
  if (!isPremiumItem(item)) return null;
  const live = VXShop.getItem(item)?.price;
  return typeof live === 'number' && live >= 0 ? live : VX_PRODUCTS[item].price;
}

export function isPurchasable(item: PremiumItem): boolean {
  if (!isPremiumItem(item)) return false;
  const live = VXShop.getItem(item);
  return live ? live.purchasable && !live.purchaseLimitReached : true;
}

/** Opens the Verse8-hosted purchase dialog for one exact product. */
export function buyVxItem(item: PremiumItem): boolean {
  if (!isPremiumItem(item)) return false;
  try {
    VXShop.buyItem(item);
    return true;
  } catch (error) {
    console.warn('[vx] VXShop dialog could not be opened:', error);
    return false;
  }
}

/** Re-render on catalog changes and refresh server state after dialog close. */
export function watchVxShop(onChange: (purchased: boolean) => void): () => void {
  initVxShop();
  const offState = VXShop.subscribe(() => onChange(false));
  const offClose = VXShop.onClose((payload) => {
    void VXShop.refresh().finally(() => onChange(payload.purchased));
  });
  return () => {
    offState();
    offClose();
  };
}
