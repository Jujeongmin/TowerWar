/**
 * 캠페인 맵 검증. 게임 코드가 아니다 — 어디서도 import 하지 않으므로 빌드에 안 실린다.
 *
 * ```bash
 * node tools/check-stages.mjs
 * ```
 *
 * `sim/maps-check.ts` 와 같은 성질을 본다. **밸런스는 안 본다** (사람이 직접 플레이해
 * 정한다 — HANDOFF §8). 여기서 잡는 것은 어기면 판이 성립하지 않는 것들이다:
 *
 * - 최소 간격 · 판 안 · 타워 상한
 * - 양쪽 다 타워가 있다
 * - 내 타워마다 막히지 않은 경로가 최소 하나 (없으면 그 타워는 아무것도 못 한다)
 * - 봇 타워 중 하나는 봇의 사거리(`routeRange`) 안에 목표가 있다 (없으면 봇이 손을 놓는다)
 * - 봇끼리 끝까지 돌려도 예외 없이 끝난다
 */
import { BOT_NORMAL, Bot } from '../ai/bot';
import { FIELD_H, FIELD_W, TICK_DT } from '../sim/config';
import { MAX_MAP_TOWERS } from '../sim/maps';
import { createMatch, dist, routeBlockedBy, step } from '../sim/sim';
import { CAMPAIGN_REPLAY_WIN, CAMPAIGN_STAGES, STAGES, stageTowers } from './stages';

/** `tools/check-stages.mjs` 가 `server.js` 의 금액표와 맞춰 보는 데 쓴다. */
export const STAGES_FOR_CHECK = STAGES;
export const REPLAY_FOR_CHECK = CAMPAIGN_REPLAY_WIN;

/** `maps.ts` 의 값과 같다. 여기서 따로 들고 있어야 그쪽이 몰래 낮춰도 잡힌다. */
const MIN_SPACING = 112;
const EDGE_SLACK = 40;

export function checkStages(): string[] {
  const out: string[] = [];
  if (CAMPAIGN_STAGES !== 20) out.push(`스테이지 수 ${CAMPAIGN_STAGES} (설계는 20)`);

  for (const st of STAGES) {
    const tag = `#${st.n}`;
    if (st.n !== STAGES.indexOf(st) + 1) out.push(`${tag} 번호가 순서와 다름`);
    const towers = stageTowers(st);
    if (towers.length > MAX_MAP_TOWERS) out.push(`${tag} 타워 ${towers.length}개 (상한 ${MAX_MAP_TOWERS})`);
    if (!towers.some((t) => t.owner === 1)) out.push(`${tag} 사람 타워 없음`);
    if (!towers.some((t) => t.owner === 2)) out.push(`${tag} 봇 타워 없음`);

    for (const t of towers) {
      if (t.x < EDGE_SLACK || t.x > FIELD_W - EDGE_SLACK || t.y < EDGE_SLACK || t.y > FIELD_H - EDGE_SLACK) {
        out.push(`${tag} 판 밖 (${t.x}, ${t.y})`);
      }
    }
    for (let i = 0; i < towers.length; i++) {
      for (let j = i + 1; j < towers.length; j++) {
        const d = dist(towers[i], towers[j]);
        if (d < MIN_SPACING) out.push(`${tag} 너무 가까움 ${i}↔${j} (${d.toFixed(0)})`);
      }
    }

    const state = createMatch(towers);
    for (const t of towers.filter((x) => x.owner !== 0)) {
      const open = towers.filter((o) => o.id !== t.id && !routeBlockedBy(state, t, o));
      if (open.length === 0) out.push(`${tag} 타워 ${t.id}(주인 ${t.owner})에서 열 경로가 없음`);
    }
    const botReach = towers
      .filter((t) => t.owner === 2)
      .some((t) =>
        towers.some(
          (o) => o.owner !== 2 && dist(t, o) <= BOT_NORMAL.routeRange && !routeBlockedBy(state, t, o),
        ),
      );
    if (!botReach) out.push(`${tag} 봇 사거리(${BOT_NORMAL.routeRange}) 안에 목표가 없음`);

    // 끝까지 돌려 본다. 승패는 안 본다 — 예외 없이 끝나는지만.
    try {
      const s = createMatch(stageTowers(st));
      const a = new Bot(1);
      const b = new Bot(2);
      let guard = 0;
      while (s.winner === null && guard++ < 200 * 30) {
        step(s, [...a.think(s, TICK_DT), ...b.think(s, TICK_DT)]);
      }
      if (s.winner === null) out.push(`${tag} 판이 안 끝남`);
    } catch (e) {
      out.push(`${tag} 시뮬레이션 예외: ${String(e)}`);
    }
  }
  return out;
}
