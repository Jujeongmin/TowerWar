/**
 * Verse8 유료 결제(VX) 연결.
 *
 * ── 무엇이 확인된 것이고 무엇이 아닌가 ─────────────────────────
 *
 * **확인됨** (`node_modules/@agent8/gameserver` 의 타입 선언에서 직접 읽음):
 *
 *   getCrossRampShopUrl(lang?): Promise<string>     결제 창 URL
 *   getCrossRampForgeUrl(lang?): Promise<string>    DEX 거래 URL (안 쓴다)
 *   subscribeAsset(account, cb: (assets: Record<string, number>) => void)
 *
 * 즉 **결제는 우리 코드 밖에서 일어난다.** 우리가 하는 것은 두 가지뿐이다 —
 * 결제 창을 열어 주고, 그 결과로 늘어난 자산을 읽는 것.
 *
 * **확인 안 됨**: 자산 id. 어떤 문자열이 "무지개 비어갱"인지는 Verse8 쪽에 상품을
 * 등록해야 정해진다. `ASSET_IDS` 가 그 자리이고, 배포 전에는 채울 수가 없다.
 *
 * **확인 안 됨(중요)**: `server.js` 샌드박스에서 자산을 읽는 방법. $global/$room/
 * $sender/$lock 어디에도 없고 SDK 타입에도 없다. 그래서 지금은 **클라이언트가
 * "샀다"고 말하면 서버가 믿는다** (`server.js` 의 `grantEntitlement` 주석 참고).
 */
import type { UnitKind } from '../units';

/**
 * 유료 항목 → Verse8 자산 id.
 *
 * **비어 있으면 그 항목은 영영 안 열린다.** 값을 지어내면 실제로 산 사람이 못 받거나,
 * 아무나 받게 된다 — 둘 다 배포 전에는 확인할 방법이 없어서 비워 뒀다.
 *
 * 배포 후 할 일:
 *   1. Verse8 대시보드에 상품을 등록하고 자산 id를 받는다
 *   2. 아래 표를 채운다
 *   3. `subscribeAsset` 이 그 id를 실제로 내려주는지 콘솔에서 확인한다
 */
export const ASSET_IDS: Partial<Record<UnitKind, string>> = {
  // beergang_rainbow: '<Verse8 자산 id>',
};

/** 이 항목을 살 수 있는가. 자산 id가 아직 없으면 상점에 "준비 중"으로 나간다. */
export function isPurchasable(item: UnitKind): boolean {
  return typeof ASSET_IDS[item] === 'string' && ASSET_IDS[item]!.length > 0;
}

/**
 * 지금 보유한 자산으로 열려 있어야 할 항목들.
 *
 * 수량이 1 이상이면 가진 것으로 본다. **소모품이 아니다** — 한 번 사면 계속 쓰는
 * 물건이라 수량을 세지 않는다.
 */
export function entitlementsFromAssets(assets: Record<string, number>): UnitKind[] {
  const out: UnitKind[] = [];
  for (const [item, assetId] of Object.entries(ASSET_IDS) as [UnitKind, string][]) {
    if (assetId && (assets[assetId] ?? 0) > 0) out.push(item);
  }
  return out;
}

/**
 * 결제 창을 연다. **새 탭이다** — 같은 탭에서 이동하면 판이 통째로 날아간다.
 *
 * 팝업 차단에 걸릴 수 있어 `null` 이 올 수 있다. 그때는 화면이 "다시 눌러 주세요"를
 * 말해야 한다 — 조용히 실패하면 눌렀는데 아무 일도 안 일어난 것으로 보인다.
 */
export function openShopWindow(url: string): boolean {
  const w = window.open(url, '_blank', 'noopener,noreferrer');
  return w !== null;
}
