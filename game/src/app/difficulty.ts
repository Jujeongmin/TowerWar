/**
 * PVE 난이도 — 사람의 영구 강화에 맞춰 봇을 얼마나 세게 할 것인가.
 *
 * 계정 데이터도 시뮬레이션 규칙도 아니고 "이 판을 어떤 조건으로 시작하는가"라서 app/에 둔다.
 * 스테이지 캠페인이 붙으면 스테이지 번호도 여기로 들어온다.
 */
import { canUseTempo, modsFor, towerKindOf, unitKindOf, type Account } from '../account/account';
import { stepDownKind, unitPowerOf, type UnitKind } from '../units';
import { stepDownTower, towerSpeedOf, type TowerKind } from '../towers';
import { SPEED_STEP } from '../sim/config';
import type { PlayerId, PlayerMods } from '../sim/types';

/**
 * 봇이 공속에서 몇 단계 뒤처지는가. **사람이 이기는 폭이 오직 여기서 나온다.**
 *
 * 정수가 아닌 이유: 한 단계(+4%)가 통째로 승부를 가른다. 시드 1~30 × 좌우 거울 = 60판:
 *
 *   지연 0    → 40%   (봇과 동등)
 *   지연 0.15 → 43~62% (판마다 널뛴다)
 *   **지연 0.5  → 66.7 / 68.3 / 68.3%** (사람 속1·속3·속5 각각 — 단계와 무관하게 평평)
 *   지연 0.75 → 81.7~90%
 *   지연 1    → 86.7~91.7%
 *
 * 0.5를 고른 것은 승률이 목표대(65~70%)에 들어오면서 **강화 단계가 올라가도 안 흔들리는**
 * 유일한 값이라서다. 봇 보정은 저장되는 값이 아니라 매치마다 계산되므로 소수여도 된다.
 */
const BOT_SPEED_LAG = 0.5;

/**
 * 봇의 실제 공속 배수. **사람은 항상 1.0 이므로 봇을 그 아래로 내려야 한다.**
 *
 * 전에는 `사람 강화 단계 − BOT_SPEED_LAG` 로 계산했는데, 상점의 공속 강화를 없애면서
 * (2026-08-06) 모두가 0단계가 됐다. 그 식은 `max(0, 0 − 0.5) = 0` 이라 **봇이 사람과
 * 동등**해지고, 위 실측표의 "지연 0 → 40%" 로 떨어진다 — 사람이 지는 판이 된다.
 *
 * 그래서 상대 기준이 아니라 **절대값**으로 박는다. `1 − 0.04×0.5 = 0.98` 은 옛 식이
 * 0단계 사람에게 주려 했던 값과 같아서, 실측해 둔 66.7~68.3% 가 그대로 유지된다.
 *
 * **지금은 바닥값이다.** 생산속도를 타워 외형이 이어받은 뒤로(`botModsFor`) 봇은 보통
 * `stepDownTower(내 외형)` 이 준 속도를 쓰고, 기본 타워(`tower_hut`)라 내려갈 곳이
 * 없을 때만 이 값으로 떨어진다 — "가장 낮은 타워를 쓴 사람과 붙는 봇"의 바닥이다.
 */
const BOT_SPEED_MUL = 1 - SPEED_STEP * BOT_SPEED_LAG;

/**
 * 봇에게 줄 보정. **유닛의 힘도 타워의 속도도 사람보다 한 단계 아래다.**
 *
 * 위 실측표가 이 값의 근거다. 다만 **바닥이 필요하다** — 기본 타워(`tower_hut`)를
 * 쓰면 아래가 없어 봇이 사람과 동등해지고, 표의 "지연 0 → 40%" 로 떨어진다.
 * 신규가 가장 많이 겪을 상태인데 거기서 가장 어려워진다. 그때만 `BOT_SPEED_MUL` 을 쓴다.
 */
export function botModsFor(a: Account): PlayerMods {
  const mine: TowerKind = towerKindOf(a);
  const down = stepDownTower(mine);
  return {
    speedMul: down === mine ? BOT_SPEED_MUL : towerSpeedOf(down),
    unitPower: unitPowerOf(botUnitKindFor(a)),
  };
}

/**
 * 봇이 입는 종류. **사람보다 한 단계 아래다** (2026-08-03 사용자 지시).
 *
 * ⚠ **이 한 줄이 난이도를 통째로 바꾼다.** 위 주석의 실측표가 그 이유다 — 충돌이
 * `Math.min(a.power, b.power)` 라 조금이라도 높은 쪽이 정면 교환에서 절대 먼저 안
 * 죽는다. 사람 전투력 2 기준으로 잰 사람 승률:
 *
 *   봇 1.85 → 95%   봇 1.95 → 95%   **봇 2.0 → 45%**
 *
 * 즉 한 단계만 낮춰도 사람 승률이 **95~100%** 로 올라간다. 전에 맞춰 둔 66~68%
 * (`BOT_SPEED_LAG`)와 그 위에 서 있는 점수 천장(§-29의 1123)은 **이 값과 함께 다시
 * 재야 한다.** 사용자가 직접 플레이해 정할 영역이다 (§8).
 *
 * 사람이 가장 약한 것을 입고 있으면 더 내려갈 곳이 없어 같은 것을 입는다.
 */
export function botUnitKindFor(a: Account): UnitKind {
  return stepDownKind(unitKindOf(a));
}

/** `createMatch`에 그대로 넘길 수 있는 형태. 사람은 P1, 봇은 P2. */
export function matchModsFor(a: Account): Partial<Record<PlayerId, PlayerMods>> {
  // **배속은 사람만 켠다.** 봇에게 주면 사람이 안 켰는데도 판이 빨라진다 —
  // 산 사람만 누리는 물건인데 봇이 대신 켜 주면 살 이유가 없다.
  return { 1: { ...modsFor(a), canTempo: canUseTempo(a) }, 2: botModsFor(a) };
}
