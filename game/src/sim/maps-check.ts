/**
 * 맵 검증. 게임 코드가 아니다 — 어디서도 import 하지 않으므로 빌드에 안 실린다.
 *
 * ```js
 * const K = await import('/src/sim/maps-check.ts?v=' + Date.now()); K.runAll(2000);
 * ```
 *
 * 배치 유형을 추가하면 **여기 통과부터 확인할 것.** 여기서 잡는 것은 밸런스가 아니라
 * 지켜지지 않으면 게임이 성립하지 않는 성질들이다:
 *
 * - **결정론**: 같은 시드가 언제나 같은 맵. 깨지면 PVP 락스텝이 첫 틱부터 갈라진다
 * - **완전 대칭**: 왼쪽 타워마다 정확히 거울상이 있어야 한다. 시작 유불리는 게임을 죽인다
 * - **최소 간격**: 타워가 붙으면 서로의 경로를 막아 길이 사라진다
 * - **길이 있음**: 본진에서 막히지 않은 목표가 최소 하나. 없으면 아무것도 못 한다
 * - **판 안**: 타워가 화면 밖으로 나가면 만질 수가 없다
 */
import { FIELD_H, FIELD_W } from './config';
import { MAP_LAYOUTS, MAX_MAP_TOWERS, generateMap, layoutFor, type MapLayout } from './maps';
import { createMatch, routeBlockedBy } from './sim';
import type { Tower } from './types';

/** `maps.ts` 의 값과 같아야 한다. 여기서 직접 들고 있어야 그 파일이 몰래 낮춰도 잡힌다. */
const MIN_SPACING = 112;
/** 타워가 이보다 화면 가장자리에 붙으면 손가락으로 짚기 어렵다. */
const EDGE_SLACK = 40;

export interface MapProblem {
  seed: number;
  layout: MapLayout;
  what: string;
  detail?: unknown;
}

function fingerprint(towers: Tower[]): string {
  return towers.map((t) => `${t.id}:${t.x.toFixed(6)},${t.y.toFixed(6)},${t.owner},${t.troops}`).join('|');
}

/**
 * 타워마다 **y가 정확히 뒤집힌** 짝이 있는가. 중앙선 위 타워는 자기 자신이 짝이다.
 *
 * **2026-07-31에 세로형이 되면서 축이 x → y로 바뀌었다.** 여기를 안 돌리면
 * 이 검사가 통째로 거짓말이 된다 — 세로 대칭인 맵을 가로 대칭으로 검사하게 된다.
 */
function mirrorProblem(towers: Tower[]): string | null {
  const mid = FIELD_H / 2;
  for (const t of towers) {
    const wantY = FIELD_H - t.y;
    const twin = towers.find(
      (o) =>
        Math.abs(o.y - wantY) < 1e-6 &&
        Math.abs(o.x - t.x) < 1e-6 &&
        o.troops === t.troops,
    );
    if (!twin) return `거울상 없음 (${t.x.toFixed(1)}, ${t.y.toFixed(1)})`;
    // 중앙선 위가 아닌데 자기 자신을 짝으로 골랐다면 대칭이 아니다.
    if (twin.id === t.id && Math.abs(t.y - mid) > 1e-6) {
      return `중앙선 밖인데 자기 자신이 짝 (${t.y.toFixed(1)})`;
    }
    // 진영이 뒤집혀 있어야 한다 (중립은 중립끼리).
    const wantOwner = t.owner === 0 ? 0 : t.owner === 1 ? 2 : 1;
    if (twin.owner !== wantOwner) return `짝의 진영이 다름 (${t.owner} vs ${twin.owner})`;
  }
  return null;
}

export function checkSeed(seed: number): MapProblem[] {
  const layout = layoutFor(seed);
  const towers = generateMap(seed);
  const problems: MapProblem[] = [];
  const add = (what: string, detail?: unknown) => problems.push({ seed, layout, what, detail });

  if (fingerprint(towers) !== fingerprint(generateMap(seed))) add('결정론 깨짐');
  if (towers.length > MAX_MAP_TOWERS) add('타워가 상한보다 많음', towers.length);
  if (towers.length < 6) add('타워가 너무 적음', towers.length);

  const m = mirrorProblem(towers);
  if (m) add(m);

  for (const t of towers) {
    if (t.x < EDGE_SLACK || t.x > FIELD_W - EDGE_SLACK || t.y < EDGE_SLACK || t.y > FIELD_H - EDGE_SLACK) {
      add('판 밖으로 나감', { x: t.x, y: t.y });
    }
  }

  for (let i = 0; i < towers.length; i++) {
    for (let j = i + 1; j < towers.length; j++) {
      const d = Math.hypot(towers[i].x - towers[j].x, towers[i].y - towers[j].y);
      if (d < MIN_SPACING) add('너무 가까움', { d: +d.toFixed(1), a: towers[i].id, b: towers[j].id });
    }
  }

  // 본진에서 갈 수 있는 곳이 하나라도 있는가. routeBlockedBy 를 실제로 태운다.
  const state = createMatch(towers);
  for (const base of towers.filter((t) => t.owner !== 0)) {
    const reachable = towers.filter((o) => o.id !== base.id && !routeBlockedBy(state, base, o));
    if (reachable.length === 0) add('본진에서 열 수 있는 경로가 없음', base.owner);
  }

  // 전에는 "만렙 반지름(31px)에서도 안 갇히는가"를 따로 봤다. 레벨이 사라져 반지름이
  // 22로 고정이라(config.towerRadiusOf) 위 검사 하나가 모든 경우를 덮는다.

  return problems;
}

export function runAll(seeds = 2000): {
  seeds: number;
  problems: MapProblem[];
  byLayout: Record<string, { count: number; towers: number }>;
} {
  const problems: MapProblem[] = [];
  const byLayout: Record<string, { count: number; towers: number }> = {};
  for (const l of MAP_LAYOUTS) byLayout[l] = { count: 0, towers: 0 };

  for (let seed = 1; seed <= seeds; seed++) {
    problems.push(...checkSeed(seed));
    const l = layoutFor(seed);
    byLayout[l].count++;
    byLayout[l].towers = generateMap(seed).length;
  }
  return { seeds, problems, byLayout };
}
