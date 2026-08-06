/**
 * 밸런스 상수 전부. 튜닝은 이 파일 하나만 만진다.
 * sim/ 안의 다른 파일은 여기서 읽기만 하고 하드코딩된 숫자를 두지 않는다.
 */
import type { Tower } from './types';

/** 시뮬레이션 틱 레이트. 렌더 프레임과 무관하게 고정. */
export const TICK_RATE = 30;
export const TICK_DT = 1 / TICK_RATE;

/**
 * 논리 좌표계. 렌더러가 이 크기를 캔버스에 레터박스로 맞춘다.
 *
 * **2026-07-31에 세로형으로 돌렸다** (사용자 지시). 전에는 1000×620 가로였고
 * 진영이 좌우로 마주봤다. 지금은 **내가 아래, 상대가 위**다.
 *
 * 두 값을 맞바꾸기만 했다 — `maps.ts` 가 긴 축/짧은 축 길이를 그대로 쓰므로
 * 타워 간격·유형별 배치·`MIN_SPACING` 같은 실측으로 정한 값이 하나도 안 흔들린다.
 * 폭을 바꾸고 싶으면 `FIELD_W` 만 만지되, 620은 유형별 가로 배치(`lanes` 의 위아래
 * 통로, `ring` 의 반지름)가 기대는 값이라 §-11의 수치가 같이 흔들린다.
 */
export const FIELD_W = 620;
export const FIELD_H = 1000;

export const MATCH_TIME = 90;

/**
 * 재고 증가율(gen)과 경로 1개당 배출률(emit).
 *
 * **모든 타워가 같은 값이다. 레벨은 없다** (2026-07-30, 사용자 지시로 제거).
 * 전에는 레벨 1~5가 1.3 / 1.9 / 2.6 / 3.4 / 4.3 을 갖고 탭으로 올렸다.
 * 지금 값 1.9 는 옛 레벨 2 — 본진과 중앙 타워가 쓰던 값이라 초반 속도가 그대로 유지된다.
 *
 * gen과 emit이 같은 값인 것이 이 게임의 균형점이다: 경로를 하나 열면 성장분이
 * 고스란히 출력으로 전환되고(±0), 두 개째부터가 순이득이다. 대신 두 번째 경로는
 * 재고 10, 세 번째는 20이 필요한데 경로가 열려 있는 동안은 재고가 늘지 않는다.
 * **둘을 따로 움직이지 말 것.** 어긋나는 순간 이 균형점이 깨진다.
 *
 * 유닛 1기는 어디서 나왔든 똑같이 1을 낸다. 타워의 우위는 오직 위치와 재고뿐이다.
 */
export const TOWER_GEN = 1.9;
export const TOWER_EMIT = 1.9;

/**
 * 모든 타워의 재고 상한. 레벨과 무관하게 동일하다.
 *
 * 이 숫자가 두 가지를 동시에 결정한다:
 *   - 20이면 경로 슬롯이 최대치(3)에 도달한다 → 그 이상 쌓는 건 슬롯 때문이 아니다
 *   - 60(=상한)에 닿으면 그 타워는 중계기가 된다 (relayThrough 참고)
 * 그래서 "20까지만 쌓고 흘릴 것인가, 60까지 채워 중계 거점으로 쓸 것인가"가 선택이 된다.
 */
export const TOWER_CAP = 60;

/** 재고 몇 마다 경로 슬롯이 하나씩 열리는가. 1~9 → 1개, 10~19 → 2개, 20+ → 3개. */
export const ROUTE_SLOT_STEP = 10;
export const ROUTE_SLOT_MAX = 3;

/**
 * 유닛 하나가 거칠 수 있는 최대 중계 횟수.
 * 서로를 향한 중계기 둘이 유닛을 무한히 튕겨내는 것을 막는다.
 */
export const RELAY_MAX_HOPS = 3;

/** 수비측 기본 보정. 이게 없으면 계속 때리는 쪽이 항상 이겨 라인이 안 생긴다. */
export const DEFENSE_BONUS = 1.15;

export const UNIT_SPEED = 105;

/**
 * 로비 상점의 영구 강화. 계정에 쌓이고 매치 시작 시 PlayerMods로 주입된다.
 * 매치 안에는 강화를 사는 수단이 없다 — 재고는 경로 슬롯과 방어력에만 쓰인다.
 *
 * **축은 공속 하나뿐이다.** 전투력 축은 두 번 시도하고 두 번 다 제거했다
 * (매치 내 등급 상점 → 로비 영구 강화). 이유는 충돌이 `min(a.power, b.power)`라
 * 전투력이 조금이라도 높은 쪽 유닛이 정면 교환에서 절대 안 죽기 때문이다 —
 * 조절 가능한 축이 아니라 계단이다. 되살리지 말 것.
 */

/**
 * 공속 배수가 오르는 폭의 기준. **지금 이 값을 쓰는 곳은 봇 보정 하나뿐이다**
 * (`app/difficulty.ts` 의 `BOT_SPEED_MUL`).
 *
 * 상점의 공속 강화(`speedLevel`)는 2026-08-06에 제거했다 — 생산속도를 타워 외형이
 * 이어받기로 해서(사용자 지시), 단계 곱셈이 남아 있으면 두 축이 겹친다.
 * `PlayerMods.speedMul` 배관은 그대로 남겼다: 외형이 그 자리에 값을 넣는다.
 */
export const SPEED_STEP = 0.04;

/**
 * 정면으로 맞물린 통로에서 적 유닛이 이 거리 안으로 들어오면 전투력을 맞교환한다.
 * 상대가 나에게 그은 보급선에 나도 맞대응으로 그어야 싸움이 시작된다.
 */
export const COLLISION_RADIUS = 10;

// ── 파생 계산 헬퍼 ────────────────────────────────────────────────

/**
 * 타워 반경. 렌더링 크기이자 게임 규칙이다 — 경로가 이 원에 걸리면 개설할 수 없다.
 * 그래서 렌더러가 아니라 여기에 있다.
 *
 * **모든 타워가 같다.** 전에는 `16 + level * 3` 이라 19~31px 사이에서 변했다.
 * 22 는 옛 레벨 2 값이고, 맵의 최소 간격(`MIN_SPACING` 112)이 그 시절 기준으로
 * 잡혀 있어 그대로 두는 것이 안전하다. 인자를 남겨 둔 것은 호출부를 안 건드리려는 것이다.
 */
export function towerRadiusOf(_t: Tower): number {
  return 22;
}

/** 경로가 타워를 스쳐 지나갈 수 있는 여유. 시각적으로 겹쳐 보이면 막힌 것으로 친다. */
export const ROUTE_CLEARANCE = 6;

export function capacityOf(_t: Tower): number {
  return TOWER_CAP;
}

/** 상한에 닿았는가. 부동소수 누적 때문에 정확히 60이 되지 않을 수 있어 여유를 둔다. */
export function isFull(t: Tower): boolean {
  return t.troops >= TOWER_CAP - 0.5;
}

/** 재고가 결정하는 동시 경로 수. 재고가 줄면 경로도 강제로 닫힌다. */
export function routeSlotsFor(troops: number): number {
  return Math.min(ROUTE_SLOT_MAX, Math.floor(Math.max(0, troops) / ROUTE_SLOT_STEP) + 1);
}

/**
 * 경로 1개가 유닛 1기를 뱉는 간격(초).
 *
 * `speedMul`은 소유자의 영구 공속 강화다. gen에도 같은 배수를 곱해야
 * "경로 1개 = ±0"이라는 경제 균형점이 유지된다 (TOWER_GEN 주석 참고).
 */
export function emitIntervalOf(_t: Tower, speedMul = 1): number {
  const rate = TOWER_EMIT * speedMul;
  return rate > 0 ? 1 / rate : Infinity;
}

/**
 * 방어에 쓰이는 총 전투력. 유닛 1기 = 전투력 1이라 재고에 수비 보정만 곱하면 된다.
 * 중립은 보정을 받지 않는다.
 */
export function defensePowerOf(t: Tower): number {
  return t.troops * defenseMultiplierOf(t);
}

export function defenseMultiplierOf(t: Tower): number {
  return t.owner === 0 ? 1 : DEFENSE_BONUS;
}
