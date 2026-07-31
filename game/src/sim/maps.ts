/**
 * 맵 생성. 시드만 같으면 어디서 돌려도 똑같은 맵이 나온다.
 *
 * **완전 대칭이다.** PVP에서 시작 위치 유불리는 그 자체로 게임을 죽이므로
 * "대충 균형 잡힌" 배치가 아니라 기하학적으로 동일한 배치를 강제한다.
 * 방법은 하나뿐이다: **내 쪽 절반만 만들고 상대 쪽은 거울로 찍는다.**
 * 중앙선 위의 타워는 자기 자신이 거울상이라 그대로 둔다.
 *
 * ── 좌표계: 생성은 (u, v), 출력은 (x, y) ────────────────────────
 *
 * **2026-07-31에 세로형으로 돌렸다** (사용자 지시). 진영이 좌우가 아니라 위아래로
 * 마주본다 — **P1이 아래, P2가 위**다.
 *
 * 배치를 다시 재지 않으려고 **생성은 옛 좌표계 그대로 두고 마지막에 한 번 돌린다.**
 *
 *   u = 긴 축 (진영이 마주보는 축). 0 = 내 진영 뒤, LONG = 상대 진영 뒤
 *   v = 짧은 축 (판의 폭)
 *   출력  x = v,  y = LONG - u        ← u가 클수록 화면 위
 *
 * `LONG`(1000)·`SHORT`(620)이 옛 `FIELD_W`·`FIELD_H`와 같은 값이라 아래 상수들
 * (`BASE_MARGIN` 105, `MIN_SPACING` 112, 유형별 좌표, `ring` 의 반지름)이
 * **전부 옛날에 실측으로 정한 그 의미 그대로다.** §-11의 유형별 수치도 그대로 산다.
 *
 * ── 배치 유형 ──────────────────────────────────────────────────
 *
 * 흩뿌리기 하나만 있으면 시드를 바꿔도 "같은 게임"이 된다 — 위치만 흔들릴 뿐
 * 어디를 먼저 먹고 어디서 막을지가 늘 같다. 그래서 판을 읽는 방식이 달라지는
 * 다섯 가지를 둔다. 유형도 시드가 정하므로 결정론은 그대로다.
 *
 * 유형을 늘릴 때 **반드시 지킬 것**:
 *   - 내 쪽 절반(u < LONG/2)에만 놓고 거울로 찍는다. 상대 쪽에 직접 놓지 말 것
 *   - 타워끼리 MIN_SPACING 이상 띄운다. 붙으면 경로가 서로를 막아 길이 사라진다
 *   - 본진에서 막히지 않은 목표가 최소 하나는 있어야 한다 (routeBlockedBy)
 * 셋 다 `maps-check.ts` 가 전 시드에서 검사한다.
 */
import { FIELD_H, FIELD_W } from './config';
import type { Tower } from './types';

/** mulberry32 — 짧고 결정론적이면 충분하다. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 진영이 마주보는 긴 축의 길이. 세로형이므로 화면 세로다. */
const LONG = FIELD_H;
/** 판의 폭. 세로형이므로 화면 가로다. */
const SHORT = FIELD_W;

const BASE_MARGIN = 105;
const EDGE_MARGIN = 70;
const MIN_SPACING = 112;

/** 내 쪽 절반에서 중립을 놓을 수 있는 범위(긴 축). */
const NEAR_MIN_U = BASE_MARGIN + 95;
const NEAR_MAX_U = LONG / 2 - 60;

export const MAP_LAYOUTS = ['scatter', 'lanes', 'choke', 'ring', 'outpost'] as const;
export type MapLayout = (typeof MAP_LAYOUTS)[number];

/** 한 판에 나올 수 있는 최대 타워 수. `server.js` 의 `MAX_TOWERS` 와 같아야 한다. */
export const MAX_MAP_TOWERS = 12;

/** 이 시드가 어떤 배치를 만드는가. 검증과 디버그에서 쓴다. */
export function layoutFor(seed: number): MapLayout {
  // 유형 추첨에만 쓰는 난수를 따로 뽑는다. 같은 스트림을 이어 쓰면
  // 유형을 하나 추가하는 것만으로 기존 모든 시드의 배치가 흔들린다.
  return MAP_LAYOUTS[Math.floor(rng(seed ^ 0x9e3779b9)() * MAP_LAYOUTS.length)];
}

interface Spot {
  /** 긴 축. 작을수록 내 진영 쪽. */
  u: number;
  /** 짧은 축(폭). */
  v: number;
  /** 안 주면 중앙과의 거리로 정한다. */
  troops?: number;
}

export function generateMap(seed: number): Tower[] {
  const rand = rng(seed);
  const layout = layoutFor(seed);
  const towers: Tower[] = [];
  let id = 0;

  // 생성 좌표 (u, v) → 화면 좌표 (x, y). **여기가 세로로 돌리는 유일한 지점이다.**
  const push = (u: number, v: number, owner: 0 | 1 | 2, troops: number): void => {
    towers.push({ id: id++, x: v, y: LONG - u, owner, troops, relayCursor: 0 });
  };

  // 양 진영 본진. 첫 턴에 바로 근처 중립을 하나 먹을 수 있는 병력으로 시작한다 —
  // 오프닝에 할 게 없으면 판이 늘어진다. P1이 아래(u 작음), P2가 위다.
  push(BASE_MARGIN, SHORT / 2, 1, 20);
  push(LONG - BASE_MARGIN, SHORT / 2, 2, 20);

  // 중앙선 타워를 **먼저 정한다.** 나중에 놓으면 흩뿌리기가 간격 검사에서 이걸 못 봐
  // 중앙 타워에 딱 붙은 중립이 생긴다 — 둘이 서로의 경로를 막아 길이 사라진다.
  const centers = centerSpots(layout);
  const reserved = [
    { u: BASE_MARGIN, v: SHORT / 2 },
    { u: LONG - BASE_MARGIN, v: SHORT / 2 },
    ...centers.map((s) => ({ u: LONG / 2, v: s.v })),
  ];

  // 내 쪽 절반을 만들고 상대 쪽으로 미러링. 여기가 대칭의 전부다.
  for (const s of nearSpots(layout, rand, reserved)) {
    const troops = valueOf(s, rand);
    push(s.u, s.v, 0, troops);
    push(LONG - s.u, s.v, 0, troops);
  }

  // 중앙선 타워 — 대칭축 위에 있어 양쪽에서 거리가 같다. 판의 승부처가 된다.
  for (const s of centers) {
    push(LONG / 2, s.v, 0, valueOf(s, rand));
  }

  return towers;
}

// ── 유형별 배치 ───────────────────────────────────────────────────

function nearSpots(
  layout: MapLayout,
  rand: () => number,
  reserved: { u: number; v: number }[],
): Spot[] {
  switch (layout) {
    case 'scatter':
      return scatterSpots(rand, reserved);

    // 양옆 두 갈래. 가운데가 비어 있어 전선이 둘로 갈린다 —
    // 한쪽을 밀면 다른 쪽이 빈다는 판단이 생긴다.
    case 'lanes': {
      const side1 = EDGE_MARGIN + 45;
      const side2 = SHORT - EDGE_MARGIN - 45;
      return [
        { u: jitter(210, 15, rand), v: side1 },
        { u: jitter(365, 15, rand), v: side1 },
        { u: jitter(210, 15, rand), v: side2 },
        { u: jitter(365, 15, rand), v: side2 },
      ];
    }

    // 가운데 큰 타워 하나가 길목. 돌아가려면 양옆으로 크게 벌어져야 한다.
    case 'choke':
      return [
        { u: jitter(240, 12, rand), v: 120 },
        { u: jitter(240, 12, rand), v: SHORT - 120 },
        { u: jitter(390, 12, rand), v: 190 },
        { u: jitter(390, 12, rand), v: SHORT - 190 },
      ];

    // 중앙의 큰 상을 고리가 둘러싼다. 고리를 먼저 먹을지 뚫고 들어갈지가 판단.
    case 'ring': {
      const cu = LONG / 2;
      const cv = SHORT / 2;
      const ru = 250;
      const rv = 230;
      // 내 쪽 절반만. 상대 쪽은 거울이 채운다.
      return [135, 165, 195, 225].map((deg) => {
        const a = (deg * Math.PI) / 180;
        return { u: cu + ru * Math.cos(a), v: cv + rv * Math.sin(a) };
      });
    }

    // 본진 옆 싼 것 둘 + 앞쪽 비싼 것 셋. 중앙선이 비어 보급선이 길어진다.
    case 'outpost':
      return [
        { u: jitter(215, 12, rand), v: 200 },
        { u: jitter(215, 12, rand), v: SHORT - 200 },
        { u: jitter(400, 12, rand), v: 130 },
        { u: jitter(400, 12, rand), v: SHORT - 130 },
        { u: jitter(430, 10, rand), v: SHORT / 2 },
      ];
  }
}

function centerSpots(layout: MapLayout): Spot[] {
  switch (layout) {
    case 'scatter':
      return [
        { u: 0, v: SHORT / 3, troops: 18 },
        { u: 0, v: (SHORT * 2) / 3, troops: 18 },
      ];
    // 중앙 타워를 통로 **사이**에 둔다. 통로와 같은 줄에 두면 각 통로가 1차원 줄이
    // 되어 전선이 한 지점에 고착되고, 뒤에서 재고가 상한까지 밀려 중계만 폭증한다
    // (실측: 점령 10.2 / 중계 190.8 → 아래 배치로 옮기고 정상 범위로 돌아왔다).
    case 'lanes':
      return [
        { u: 0, v: SHORT / 2 - 85, troops: 18 },
        { u: 0, v: SHORT / 2 + 85, troops: 18 },
      ];
    // 길목과 고리는 가운데 하나에 값을 몰아준다. 그게 이 배치의 전부다.
    // 레벨이 사라진 뒤로 그 "값"은 시작 재고 하나뿐이다 — 전에는 레벨 3까지 얹어 줬다.
    case 'choke':
      return [{ u: 0, v: SHORT / 2, troops: 30 }];
    case 'ring':
      return [{ u: 0, v: SHORT / 2, troops: 34 }];
    case 'outpost':
      return [];
  }
}

/**
 * 무작위 흩뿌리기. 최소 간격을 지킬 때까지 다시 뽑는다.
 *
 * `reserved` 에 본진과 **중앙선 타워가 모두 들어 있어야 한다.** 중앙 타워를 빼먹으면
 * 거기 딱 붙은 중립이 생기고, 둘이 서로의 경로를 막아 그 자리가 통째로 죽는다.
 *
 * 상대 쪽 거울상은 검사하지 않아도 된다 — `NEAR_MAX_U` 가 440이라 거울상은 560 이상,
 * 어떤 내 쪽 점과도 긴 축으로 120 이상 떨어진다.
 */
function scatterSpots(rand: () => number, reserved: { u: number; v: number }[]): Spot[] {
  const out: Spot[] = [];
  let guard = 0;
  while (out.length < 4 && guard++ < 800) {
    const u = lerp(NEAR_MIN_U, NEAR_MAX_U, rand());
    const v = lerp(EDGE_MARGIN, SHORT - EDGE_MARGIN, rand());
    const tooClose =
      out.some((p) => Math.hypot(p.u - u, p.v - v) < MIN_SPACING) ||
      reserved.some((p) => Math.hypot(p.u - u, p.v - v) < MIN_SPACING);
    if (!tooClose) out.push({ u, v });
  }
  return out;
}

/** 흔들림. 유형의 모양은 유지하면서 같은 유형이 매번 똑같이 보이지 않게 한다. */
function jitter(base: number, amount: number, rand: () => number): number {
  return base + (rand() * 2 - 1) * amount;
}

/**
 * 중앙에 가까울수록 비싸고 좋은 타워. 초반에 안전하게 먹을 곳과
 * 위험을 감수해야 먹을 곳을 나눠서 확장 순서에 판단이 개입하게 만든다.
 *
 * 유형이 값을 직접 정했으면 그걸 쓴다 — 길목·고리의 중앙 타워가 그렇다.
 */
function valueOf(s: Spot, rand: () => number): number {
  if (s.troops !== undefined) return s.troops;
  const centrality = clamp01((s.u - BASE_MARGIN) / (LONG / 2 - BASE_MARGIN));
  return Math.round(4 + centrality * 14 + rand() * 3);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
