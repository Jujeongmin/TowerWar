/**
 * 보상형 광고. **여기가 유일한 이음매다.**
 *
 * ── Verse8 실물 SDK를 붙였다 (2026-08-02) ──────────────────
 *
 * `@agent8/gameserver` 타입 선언에 광고 API가 **없다** (직접 확인했다). 대신
 * `@verse8/ads` 의 `Verse8Ads.showRewarded()` 가 실물 보상형 광고를 튼다
 * (`verse8AdProvider`). 실제 SDK 호출은 전부 이 provider 하나에 몰아 뒀다 —
 * **다른 파일은 이 모듈만 보면 된다.**
 *
 * ── 안 붙어 있으면 버튼이 안 보인다 ───────────────────────────
 *
 * `isAdReady()` 가 거짓이면 화면이 광고 버튼을 아예 안 그린다. 눌러도 아무 일이 없는
 * 버튼을 보여 주면 고장으로 읽힌다 — VX 상품이 없을 때 `준비 중` 으로 두는 것과 같은
 * 규칙이다 (`net/vx.ts`). `verse8AdProvider` 는 이 환경이 광고를 못 틀 때만
 * (`unsupported_env`) `ready()` 가 거짓이다.
 *
 * ── 개발 중에는 흉내만 낸다 ───────────────────────────────────
 *
 * `import.meta.env.DEV` 에서만 가짜 제공자가 붙는다 (`main.ts`). 광고 없이 보상
 * 흐름을 시험할 수 있어야 하기 때문이다 — 가짜는 광고를 안 봐도 `true` 를 주므로
 * **프로덕션 빌드에는 실리면 안 된다**.
 */

import { Verse8Ads } from '@verse8/ads';

/**
 * 이 게임의 보상형 광고 배치 id. Verse8 대시보드의 광고 배치에서 정한 값을 쓴다.
 * 두 쓰임(상점 +60, 결과 2배)이 같은 provider 를 공유하므로 배치도 하나다.
 */
const AD_PLACEMENT_ID = 'towerwar-rewarded';

/**
 * Verse8 실물 광고 제공자.
 *
 * `@verse8/ads` 의 `showRewarded` 를 그대로 감싼다. `status === 'rewarded'` 일 때만
 * `true` — 광고를 끝까지 본 경우에만 보상을 준다. 중간에 닫으면(`dismissed`) `false` 이고,
 * 실패해도 `false` 다. 광고를 안 봤는데 보상을 주는 길을 여기서 다 막는다.
 *
 * `ready()` 는 이 환경이 광고를 못 틀 때만 `false` 다. SDK는 "지금 틀 수 있나"를
 * 따로 묻는 API가 없어서, 최초에는 틀 수 있는 것으로 보고 첫 실패에서
 * `unsupported_env` 를 받으면 그 세션 동안 버튼을 숨긴다.
 */
export function verse8AdProvider(): AdProvider {
  let unsupported = false;
  return {
    ready: () => !unsupported,
    show: async () => {
      const result = await Verse8Ads.showRewarded({ placementId: AD_PLACEMENT_ID });
      if (result.status === 'failed' && result.error.code === 'unsupported_env') {
        unsupported = true;
      }
      return result.status === 'rewarded';
    },
  };
}

/** 광고를 트는 쪽. Verse8 SDK가 붙으면 여기에 실물을 끼운다. */
export interface AdProvider {
  /** 지금 틀 수 있는가. 로딩 중이거나 재고가 없으면 거짓. */
  ready(): boolean;
  /**
   * 보상형 광고를 끝까지 보여 준다.
   *
   * **끝까지 본 경우에만 `true`.** 중간에 닫았으면 `false` — 그때 보상을 주면
   * 광고를 볼 이유가 없어진다.
   */
  show(): Promise<boolean>;
}

let provider: AdProvider | null = null;

/** Verse8 쪽에서 실물을 끼울 때 부른다. **앱 시작에 한 번.** */
export function setAdProvider(p: AdProvider | null): void {
  provider = p;
}

export function isAdReady(): boolean {
  return provider?.ready() === true;
}

/**
 * 광고를 보여 주고 **끝까지 봤는지**를 돌려준다.
 *
 * 제공자가 없거나 던지면 `false` 다 — 보상은 안 준다. 광고가 실패했는데 보상을 주면
 * 그게 곧 "광고를 안 봐도 되는 길"이 된다.
 */
export async function watchRewardedAd(): Promise<boolean> {
  if (!provider) return false;
  try {
    return await provider.show();
  } catch {
    return false;
  }
}

/**
 * 개발용 가짜 제공자. **`import.meta.env.DEV` 에서만 붙인다** (`main.ts`).
 *
 * 실제 광고처럼 잠깐 기다렸다 성공을 돌려준다. 기다리는 이유: 즉시 돌려주면 화면이
 * "광고를 보는 동안" 상태를 한 번도 안 지나 그 경로가 검증되지 않는다.
 */
export function devAdProvider(): AdProvider {
  return {
    ready: () => true,
    show: () =>
      new Promise((resolve) => {
        setTimeout(() => resolve(true), 800);
      }),
  };
}
