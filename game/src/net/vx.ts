/** Verse8 VXShop integration for the game's vanilla TypeScript client. */
import { VXShop, type VXShopItem } from '@verse8/platform/vanilla';
import type { UnitKind } from '../units';
import type { TowerKind } from '../towers';

// 타워 외형도 유료 상품이 될 수 있다 (`tower_prime`). 유닛과 같은 구조라 유닛과
// 나란히 유니언에 넣는다 — 갈라 두면 `isPremiumItem` 같은 판정 함수를 두 벌 유지해야 한다.
export type PremiumItem = UnitKind | TowerKind | 'tempo_boost';
export const TEMPO_ITEM = 'tempo_boost';

/**
 * Product IDs must exactly match the Verse8 VXShop dashboard.
 *
 * **대시보드가 진짜이고 이 값은 로딩 전 폴백일 뿐이다** (`vxPrice` 참고).
 * `tower_prime` 은 아직 대시보드에 상품으로 등록되지 않았다 — 그동안은 상점에
 * "준비 중"으로 뜬다 (`isPurchasable`), 그것이 맞는 동작이다.
 */
export const VX_PRODUCTS: Readonly<Record<'beergang_rainbow' | 'tower_prime' | 'tempo_boost', { price: number }>> = {
  beergang_rainbow: { price: 500 },
  tower_prime: { price: 500 },
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
