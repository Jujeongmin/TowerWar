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
 * ── `requestId` 를 서버로 실어 나른다 (2026-08-04) ─────────────
 *
 * `docs.verse8.io/ko/docs/ads/intro` 를 보면 서버가 `ads-verifier.verse8.io` 로
 * `requestId` 를 물어봐 **실제로 광고를 끝까지 봤는지 확인할 수 있다.** 전에는 이걸
 * 모르고 "서버는 광고를 봤는지 확인할 수 없다"고 적어 뒀다 — 틀린 전제였다
 * (`server.js` 의 §-46 주석도 같이 틀렸었다).
 *
 * 그래서 `show()` 가 이제 `boolean` 이 아니라 `{ watched, requestId }` 를 돌려준다.
 * `requestId` 가 없으면(빈 문자열) 서버가 검증할 것이 없다는 뜻이고, **개발용 가짜
 * 제공자가 정확히 그 경우다** (아래 `devAdProvider`).
 *
 * ── 개발 중에는 흉내만 낸다 — 단, 서버 보상까지는 못 받는다 ─────
 *
 * `import.meta.env.DEV` 에서만 가짜 제공자가 붙는다 (`main.ts`). **`requestId` 가
 * `''`(빈 문자열)이라 서버가 검증에서 거절한다** — 실제 광고가 아니므로 이게 맞는
 * 동작이다. 클라이언트 쪽 흐름(버튼 잠금·문구·재활성화)은 그대로 시험되지만,
 * "코인이 실제로 늘어나는지"는 이제 `npm run test:server` 가 본다 (가짜 검증 응답으로
 * `verifyAdRequest` 를 결정론적으로 돌린다 — 진짜 네트워크를 안 탄다).
 */

import { Verse8Ads } from '@verse8/ads';

/**
 * 이 게임의 보상형 광고 배치 id. Verse8 대시보드의 광고 배치에서 정한 값을 쓴다.
 * 두 쓰임(상점 +60, 결과 2배)이 같은 provider 를 공유하므로 배치도 하나다.
 */
const AD_PLACEMENT_ID = 'towerwar-rewarded';

/** 광고를 한 번 튼 결과. `requestId` 가 빈 문자열이면 서버가 검증할 실물 요청이 없다. */
export interface AdWatch {
  /** 끝까지 봤는가. `false` 면 `requestId` 도 의미가 없다 — 보상을 청구하지 않는다. */
  watched: boolean;
  /** 서버의 `claimAdCoins`/`claimDoubleReward` 에 그대로 실어 보낼 값. */
  requestId: string;
}

/**
 * Verse8 실물 광고 제공자.
 *
 * `@verse8/ads` 의 `showRewarded` 를 그대로 감싼다. `status === 'rewarded'` 일 때만
 * `watched: true` — 광고를 끝까지 본 경우에만 보상을 청구할 수 있다. 중간에 닫으면
 * (`dismissed`) `false`, 실패해도 `false` 다.
 *
 * **`watched` 가 참이라고 보상이 확정되는 게 아니다.** 이건 "SDK가 끝까지 봤다고
 * 보고했다"일 뿐이고, 진짜 판정은 서버가 `requestId` 로 `ads-verifier.verse8.io` 에
 * 물어봐서 한다 — 클라이언트 판정만 믿으면 이 함수를 그냥 `true` 를 돌려주게 바꾸는
 * 것만으로 무한 광고 보상이 된다.
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
      return { watched: result.status === 'rewarded', requestId: result.requestId };
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
   * `watched` 가 참이어도 서버가 `requestId` 를 검증해야 실제로 보상이 나간다 —
   * 여기서 참을 주는 것은 "봤다고 보고할 자격"이지 보상 확정이 아니다.
   */
  show(): Promise<AdWatch>;
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
 * 광고를 보여 주고 결과를 돌려준다.
 *
 * 제공자가 없거나 던지면 `{ watched: false, requestId: '' }` 다 — 보상 청구로
 * 안 넘어간다. 광고가 실패했는데 보상을 청구할 길을 열면 그게 곧
 * "광고를 안 봐도 되는 길"이 된다. (최종 방어는 서버의 `requestId` 검증이지만
 * 여기서도 막을 수 있는 것은 막는다.)
 */
export async function watchRewardedAd(): Promise<AdWatch> {
  if (!provider) return { watched: false, requestId: '' };
  try {
    return await provider.show();
  } catch {
    return { watched: false, requestId: '' };
  }
}

/**
 * 개발용 가짜 제공자. **`import.meta.env.DEV` 에서만 붙인다** (`main.ts`).
 *
 * 실제 광고처럼 잠깐 기다렸다 성공을 돌려준다. 기다리는 이유: 즉시 돌려주면 화면이
 * "광고를 보는 동안" 상태를 한 번도 안 지나 그 경로가 검증되지 않는다.
 *
 * **`requestId` 는 빈 문자열이다.** 진짜 광고가 아니므로 서버에 검증받을 것이 없다 —
 * `claimAdCoins`/`claimDoubleReward` 를 불러도 서버가 `ad_invalid` 로 거절한다.
 * 이 제공자는 **클라이언트 쪽 흐름**(버튼 잠금·문구·재활성화)을 시험하는 용도이고,
 * "코인이 실제로 늘어나는가"는 `npm run test:server` 가 가짜 검증 응답으로 본다.
 */
export function devAdProvider(): AdProvider {
  return {
    ready: () => true,
    show: () =>
      new Promise((resolve) => {
        setTimeout(() => resolve({ watched: true, requestId: '' }), 800);
      }),
  };
}
