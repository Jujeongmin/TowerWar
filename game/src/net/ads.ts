/**
 * 보상형 광고. **여기가 유일한 이음매다.**
 *
 * ── 지금은 붙어 있지 않다 ─────────────────────────────────────
 *
 * `@agent8/gameserver` 타입 선언에 광고 API가 **없다** (직접 확인했다). Verse8 쪽에서
 * 붙이기로 했으므로, 실제 SDK 호출이 들어갈 자리를 `provider` 하나로 몰아 뒀다.
 * **다른 파일은 이 모듈만 보면 된다** — 붙일 때 고칠 곳이 여기 하나여야 한다.
 *
 * ── 안 붙어 있으면 버튼이 안 보인다 ───────────────────────────
 *
 * `isAdReady()` 가 거짓이면 화면이 광고 버튼을 아예 안 그린다. 눌러도 아무 일이 없는
 * 버튼을 보여 주면 고장으로 읽힌다 — VX 상품이 없을 때 `준비 중` 으로 두는 것과 같은
 * 규칙이다 (`net/vx.ts`).
 *
 * ── 개발 중에는 흉내만 낸다 ───────────────────────────────────
 *
 * `import.meta.env.DEV` 에서만 가짜 제공자가 붙는다. 광고 없이 보상 흐름을 시험할 수
 * 있어야 하기 때문이고, **프로덕션 빌드에는 이 분기가 통째로 떨어져 나간다** —
 * 안 그러면 배포본에서 광고를 안 보고도 보상을 받는다.
 */

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
