/**
 * PVP 점수(Elo) → 티어 이름.
 *
 * **구간은 여기에만 있다.** 서버(`server.js`)는 숫자만 알고 티어를 모른다 —
 * 구간이 순수 표시용이라 양쪽에 두면 한쪽만 바뀌었을 때 보이는 티어가 갈라진다.
 *
 * `sim/` 은 이 모듈을 몰라야 한다. 점수가 시뮬레이션에 흘러들면 서버 권위 PVP에서
 * 클라이언트마다 결과가 갈라진다 (`account/account.ts` 머리말과 같은 이유).
 */

/** 새 계정의 시작 점수. **`server.js` 의 `DEFAULT_RATING` 과 같아야 한다.** */
export const DEFAULT_RATING = 1000;

/**
 * 티어 하한. 내림차순이라 위에서부터 처음 걸리는 것이 답이다.
 *
 * 시작 점수 1000이 실버 한가운데 오게 잡았다 — 첫 판에 티어가 바로 움직이면
 * (한 판 최대 ±32) 점수가 무슨 뜻인지 읽히지 않는다.
 */
const TIERS: readonly { readonly min: number; readonly name: string }[] = [
  { min: 1500, name: '다이아' },
  { min: 1300, name: '플래티넘' },
  { min: 1100, name: '골드' },
  { min: 900, name: '실버' },
  { min: 0, name: '브론즈' },
];

export function tierOf(rating: number): string {
  const r = Number.isFinite(rating) ? rating : DEFAULT_RATING;
  return (TIERS.find((t) => r >= t.min) ?? TIERS[TIERS.length - 1]).name;
}
