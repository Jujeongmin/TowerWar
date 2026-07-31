/**
 * 봇 상대.
 *
 * 봇은 사람이 내는 것과 완전히 같은 Command만 내보낸다. 시뮬레이션은 이 명령이
 * 봇에서 왔는지 네트워크에서 왔는지 구분하지 못한다 — 나중에 이 자리에 원격
 * 플레이어의 입력 스트림을 그대로 끼워 넣으면 PVP가 된다.
 */
import { ROUTE_SLOT_MAX, defensePowerOf, routeSlotsFor } from '../sim/config';
import { dist, routeBlockedBy } from '../sim/sim';
import type { Command, MatchState, PlayerId, Tower } from '../sim/types';

export interface BotConfig {
  /** 판단 주기(초). 짧을수록 강하다. */
  interval: number;
  /** 이 거리 안의 타워만 경로 대상으로 본다. 맵 반대편까지 쏘지 않게 막는다. */
  routeRange: number;
  /** 후방 타워가 축적을 멈추고 보급을 시작하는 재고 기준. */
  feedThreshold: number;
}

export const BOT_NORMAL: BotConfig = { interval: 0.5, routeRange: 330, feedThreshold: 20 };

/** 이 거리 안에 적 타워가 있으면 최전선으로 본다. */
const FRONT_RADIUS = 300;

export class Bot {
  private cooldown: number;

  constructor(
    private readonly me: PlayerId,
    private readonly cfg: BotConfig = BOT_NORMAL,
    /**
     * 판이 시작된 뒤 이 시간(초)이 지나기 전에는 아무 명령도 내지 않는다.
     *
     * **시뮬레이션 시간이다** (벽시계가 아니다). `think` 가 받는 dt 로 재므로
     * 프레임레이트가 흔들려도 같은 틱에 풀린다.
     *
     * 기본값이 0인 이유: 측정·검증 코드가 봇을 직접 만들어 쓴다. 여기에 지연을
     * 기본으로 넣으면 기존 기준 수치가 통째로 흔들린다. 게임에 나가는 지연은
     * `app/command-source.ts` 의 `BOT_START_DELAY_SEC` 가 준다.
     */
    startDelaySec = 0,
  ) {
    this.cooldown = startDelaySec;
  }

  /** 매 틱 호출. 내부에서 판단 주기를 알아서 조절한다. */
  think(state: MatchState, dt: number): Command[] {
    this.cooldown -= dt;
    if (this.cooldown > 0 || state.winner !== null) return [];
    this.cooldown = this.cfg.interval;

    const mine = state.towers.filter((t) => t.owner === this.me);
    if (mine.length === 0) return [];

    // 강화 구매는 로비에서만 한다. 매치 안에서 봇이 살 것은 없다.
    // 레벨업이 사라진 뒤로 봇이 낼 수 있는 명령은 경로 하나뿐이다 (2026-07-30).
    return this.manageRoutes(state, mine);
  }

  /**
   * 경로 관리가 이 봇의 본체다.
   * 타워마다 "지금 열려 있어야 할 경로 집합"을 계산하고 현재 상태와의 차이만 토글한다.
   * 이렇게 해야 매 사이클 열고 닫기를 반복하는 진동이 생기지 않는다.
   */
  private manageRoutes(state: MatchState, mine: Tower[]): Command[] {
    const cmds: Command[] = [];

    for (const t of mine) {
      const allowed = routeSlotsFor(t.troops);
      const current = state.routes.filter((r) => r.fromId === t.id);
      const desired = this.desiredTargets(state, mine, t, allowed);

      for (const r of current) {
        if (!desired.includes(r.toId)) {
          cmds.push({ kind: 'toggleRoute', player: this.me, fromId: t.id, toId: r.toId });
        }
      }

      let open = current.filter((r) => desired.includes(r.toId)).length;
      for (const toId of desired) {
        if (open >= allowed) break;
        if (current.some((r) => r.toId === toId)) continue;
        cmds.push({ kind: 'toggleRoute', player: this.me, fromId: t.id, toId });
        open++;
      }
    }
    return cmds;
  }

  private desiredTargets(state: MatchState, mine: Tower[], t: Tower, allowed: number): number[] {
    // 막힌 경로를 후보에 두면 매 사이클 열려고 시도하다 거부당하기를 반복한다
    const targets = state.towers
      .filter(
        (o) =>
          o.owner !== this.me &&
          dist(o, t) <= this.cfg.routeRange &&
          !routeBlockedBy(state, t, o),
      )
      // 전에는 `- o.level * 4` 로 고레벨 타워를 우선했다. 레벨이 사라져 그 항도 없앴다 —
      // 남은 기준은 "지키는 병력이 적고 가까운 곳"이다.
      .map((o) => ({ id: o.id, cost: defensePowerOf(o) + dist(o, t) * 0.05 }))
      .sort((a, b) => a.cost - b.cost);

    if (targets.length > 0) return targets.slice(0, allowed).map((x) => x.id);

    // 사거리 안에 칠 곳이 없는 후방 타워. 재고가 충분해지면 최전선에 보급한다.
    // 그 전까지는 아무 경로도 열지 않고 쌓아서 슬롯을 늘린다.
    if (t.troops < this.cfg.feedThreshold && routeSlotsFor(t.troops) < ROUTE_SLOT_MAX) return [];

    const front = minBy(
      mine.filter((m) => m.id !== t.id && this.isFrontline(state, m) && !routeBlockedBy(state, t, m)),
      (m) => dist(m, t),
    );
    return front ? [front.id] : [];
  }

  private isFrontline(state: MatchState, t: Tower): boolean {
    return state.towers.some(
      (o) => o.owner !== this.me && o.owner !== 0 && dist(o, t) < FRONT_RADIUS,
    );
  }
}

function minBy<T>(items: T[], f: (t: T) => number): T | undefined {
  let best: T | undefined;
  let bestV = Infinity;
  for (const it of items) {
    const v = f(it);
    if (v < bestV) {
      bestV = v;
      best = it;
    }
  }
  return best;
}
