/**
 * 락스텝 **체감** 측정. 게임 코드가 아니다 — 어디서도 import 하지 않아 빌드에 안 실린다.
 *
 * ```bash
 * node tools/check-lockstep.mjs
 * ```
 *
 * `lockstep-check.ts` 는 "안 갈라지는가"를 본다. 이건 **"얼마나 매끄러운가"**를 본다 —
 * 실기에서 렉으로 보이던 것(멈칫거림·몰아 돌리기)이 실제 조건에서 얼마나 나는지 센다.
 *
 * 실기를 흉내 내는 것:
 *   - 가짜 시계 하나를 두 기기가 같이 쓴다 (Date.now 로 재면 하네스 속도에 따라 결과가 바뀐다)
 *   - 두 기기가 **다른 시각에 시작한다** (시작 신호 도착 차이)
 *   - 네트워크: SDK 묶음 대기 30ms + 편도 지연 + 흔들림, 보낸 사람 기준 순서 유지, 에코 포함
 *   - 모바일 프레임: 16.7ms 근처에서 흔들리고, 가끔 150~250ms 씩 튄다 (GC·그림 해독)
 *   - `main.ts` 의 dt 상한 0.25초, `MatchScene` 의 `MAX_ACCUMULATOR` 0.5초
 *
 * 프레임 루프는 `MatchScene.frame` 을 옮긴 것이다. **둘이 어긋나면 이 측정은 아무것도
 * 증명하지 못한다.** `MatchScene.frame` 을 고치면 여기도 고칠 것.
 */
import { DEFAULT_RATING } from '../account/account';
import { DEFAULT_PROFILE } from '../profiles';
import { DEFAULT_TOWER_KIND, towerSpeedOf } from '../towers';
import { DEFAULT_UNIT_KIND, unitPowerOf } from '../units';
import { TICK_DT } from '../sim/config';
import { generateMap } from '../sim/maps';
import { createMatch, step, tempoScaleOf } from '../sim/sim';
import type { Command, MatchState, PlayerId } from '../sim/types';
import { hashState } from './hash';
import { Lockstep } from './lockstep';
import { Pacer } from './pacing';
import type { InputBatch, MatchSetup, MatchTransport } from './types';

/** `match-scene.ts` 의 `MAX_ACCUMULATOR` 와 같아야 한다. */
const MAX_ACCUMULATOR_FOR_CHECK = 0.5;

/** mulberry32. 같은 시드면 같은 흔들림 — 전후 비교가 공정해야 한다. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface NetProfile {
  /** 편도 지연 평균(ms). SDK 묶음 대기 30ms 는 따로 더한다. */
  oneWayMs: number;
  /** 편도 지연 흔들림 폭(ms, 0~이 값을 더한다). */
  jitterMs: number;
  /** 두 번째 기기가 늦게 시작하는 시간(ms). */
  startOffsetMs: number;
  /** 프레임마다 크게 튈 확률. */
  hitchChance: number;
}

export interface Variant {
  label: string;
  pacing: boolean;
  /** 멈춘 동안 쌓인 시간을 버리는가 (`MatchScene.frame` 의 정지 처리). */
  dropStallTime: boolean;
  sendIntervalMs: number;
}

/** 지연·흔들림을 넣은 중계. 서버 `broadcastToRoom` 처럼 보낸 사람에게도 돌아온다. */
class JitterHub {
  private handlers = new Set<(b: InputBatch) => void>();
  private queue: { at: number; batch: InputBatch }[] = [];
  /** 보낸 사람별 마지막 도착 시각. 웹소켓은 순서를 지키므로 앞지르지 않게 한다. */
  private lastAt: Record<number, number> = { 1: 0, 2: 0 };

  constructor(
    private readonly net: NetProfile,
    private readonly rand: () => number,
    private readonly clock: () => number,
  ) {}

  port(): MatchTransport {
    return {
      send: (batch) => {
        const copy: InputBatch = JSON.parse(JSON.stringify(batch));
        // 올라가는 길 + 내려오는 길. 묶음 대기(30ms)는 보내는 쪽에서 한 번.
        const up = this.net.oneWayMs / 2 + this.rand() * this.net.jitterMs / 2;
        const down = this.net.oneWayMs / 2 + this.rand() * this.net.jitterMs / 2;
        const at = Math.max(this.clock() + 30 + up + down, this.lastAt[batch.player]);
        this.lastAt[batch.player] = at;
        this.queue.push({ at, batch: copy });
      },
      onBatch: (h) => {
        this.handlers.add(h);
        return () => this.handlers.delete(h);
      },
    };
  }

  deliver(): void {
    const now = this.clock();
    const due = this.queue.filter((q) => q.at <= now);
    if (due.length === 0) return;
    this.queue = this.queue.filter((q) => q.at > now);
    for (const { batch } of due) for (const h of this.handlers) h(batch);
  }
}

export interface ClientStats {
  stallFrames: number;
  frames: number;
  /** 400ms 미만 멈춤 횟수 — "대기 중" 표시 없이 버벅임으로만 보이던 것. */
  shortStalls: number;
  longStalls: number;
  longestStallMs: number;
  /** 한 프레임에 3틱 이상 몰아 돈 횟수 — 순간이동으로 보인다. */
  burstFrames: number;
  maxTicksPerFrame: number;
}

class Client {
  state: MatchState;
  ls: Lockstep;
  private acc = 0;
  private pacer = new Pacer();
  readonly perTick = new Map<number, string>();
  readonly stats: ClientStats = {
    stallFrames: 0, frames: 0, shortStalls: 0, longStalls: 0,
    longestStallMs: 0, burstFrames: 0, maxTicksPerFrame: 0,
  };
  private stallStart = -1;

  constructor(
    readonly local: PlayerId,
    setup: Omit<MatchSetup, 'local'>,
    transport: MatchTransport,
    private readonly clock: () => number,
    private readonly v: Variant,
  ) {
    this.state = createMatch(generateMap(setup.seed), {
      1: { speedMul: towerSpeedOf(setup.towerKinds[1]), unitPower: unitPowerOf(setup.kinds[1]) },
      2: { speedMul: towerSpeedOf(setup.towerKinds[2]), unitPower: unitPowerOf(setup.kinds[2]) },
    });
    this.ls = new Lockstep({ ...setup, local }, transport, clock, v.sendIntervalMs);
  }

  /** 결정론적 "사람 흉내". `lockstep-check.ts` 와 같다. */
  private act(): void {
    const st = this.state;
    const mine = st.towers.filter((t) => t.owner === this.local);
    if (mine.length === 0 || st.tick % 29 !== 0) return;
    const from = mine[st.tick % mine.length];
    const target = st.towers.filter((o) => o.owner !== this.local)[st.tick % 3];
    if (target) {
      this.ls.submit({ kind: 'toggleRoute', player: this.local, fromId: from.id, toId: target.id } as Command);
    }
  }

  /** `MatchScene.frame` 의 틱 루프. */
  frame(dt: number): void {
    const pace = this.v.pacing
      ? this.pacer.factor(this.ls.headroom(this.state.tick), this.ls.delayTicks(this.state), this.clock())
      : 1;
    this.acc = Math.min(this.acc + dt * tempoScaleOf(this.state) * pace, MAX_ACCUMULATOR_FOR_CHECK);
    let ran = 0;
    let stalled = false;
    while (this.acc >= TICK_DT) {
      this.ls.pump(this.state.tick, this.state);
      this.act();
      const cmds = this.ls.commandsFor(this.state.tick);
      if (cmds === null) {
        stalled = true;
        if (this.v.dropStallTime) this.acc = Math.min(this.acc, TICK_DT);
        break;
      }
      step(this.state, cmds);
      this.perTick.set(this.state.tick, hashState(this.state));
      this.acc -= TICK_DT;
      ran++;
    }
    this.ls.pump(this.state.tick, this.state);

    const s = this.stats;
    s.frames++;
    if (stalled) s.stallFrames++;
    if (ran >= 3) s.burstFrames++;
    if (ran > s.maxTicksPerFrame) s.maxTicksPerFrame = ran;
    const now = this.clock();
    if (stalled && this.stallStart < 0) this.stallStart = now;
    if (!stalled && this.stallStart >= 0) {
      const len = now - this.stallStart;
      if (len >= 400) s.longStalls++;
      else s.shortStalls++;
      if (len > s.longestStallMs) s.longestStallMs = len;
      this.stallStart = -1;
    }
  }
}

export interface SimResult {
  variant: string;
  net: string;
  desync: boolean;
  lateBatches: number;
  a: ClientStats;
  b: ClientStats;
  /** 판이 끝날 때까지 걸린 벽시계 초. */
  wallSec: number;
  /**
   * 실시간 대비 진행 속도(%). 100 이면 판이 제 속도로 돌았다. 멈춤·늦추기는 이걸 깎는다.
   * 판 길이는 명령이 걸리는 틱에 따라 승패 시점이 달라져 방식끼리 비교가 안 된다 — 이걸 본다.
   */
  speedPct: number;
}

export function simulate(seed: number, net: NetProfile, v: Variant): SimResult {
  let now = 0;
  const clock = () => now;
  const rand = rng(seed * 7919 + 1);
  const hub = new JitterHub(net, rand, clock);
  const setup = {
    seed,
    inputDelayTicks: 12,
    desyncCheckTicks: 30,
    kinds: { 1: DEFAULT_UNIT_KIND, 2: DEFAULT_UNIT_KIND },
    towerKinds: { 1: DEFAULT_TOWER_KIND, 2: DEFAULT_TOWER_KIND },
    names: { 1: 'A', 2: 'B' },
    profiles: { 1: DEFAULT_PROFILE, 2: DEFAULT_PROFILE },
    ratings: { 1: DEFAULT_RATING, 2: DEFAULT_RATING },
    tempo: { 1: false, 2: false },
    friendRoom: false,
  };
  const a = new Client(1, setup, hub.port(), clock, v);
  const b = new Client(2, setup, hub.port(), clock, v);
  const frameRand = rng(seed * 104729 + 3);
  const next = { a: 0, b: net.startOffsetMs };
  const last = { a: 0, b: net.startOffsetMs };

  const frameGap = () => {
    // 60fps 근처에서 흔들리고, 가끔 크게 튄다.
    const base = 1000 / 60 + (frameRand() - 0.5) * 6;
    return frameRand() < net.hitchChance ? 150 + frameRand() * 100 : base;
  };

  while ((a.state.winner === null || b.state.winner === null) && now < 400_000) {
    // 다음에 일어날 일(어느 쪽 프레임)로 시계를 옮긴다.
    const who = next.a <= next.b ? 'a' : 'b';
    now = next[who];
    hub.deliver();
    const c = who === 'a' ? a : b;
    if (c.state.winner === null) {
      // `main.ts` 의 dt 상한.
      const dt = Math.min(0.25, (now - last[who]) / 1000);
      c.frame(dt);
    }
    last[who] = now;
    next[who] = now + frameGap();
  }

  let desync = false;
  for (const [tick, ha] of a.perTick) {
    const hb = b.perTick.get(tick);
    if (hb !== undefined && hb !== ha) desync = true;
  }
  return {
    variant: v.label,
    net: `편도 ${net.oneWayMs}±${net.jitterMs}ms · 시작차 ${net.startOffsetMs}ms · 튐 ${net.hitchChance * 100}%`,
    desync: desync || a.state.tick !== b.state.tick || a.state.winner !== b.state.winner,
    lateBatches: a.ls.lateBatches + b.ls.lateBatches,
    a: a.stats,
    b: b.stats,
    wallSec: Math.round(now / 100) / 10,
    // 두 번째 기기는 늦게 시작했으므로 첫 기기 기준으로 잰다.
    speedPct: Math.round((a.state.tick / ((now / 1000) * 30)) * 1000) / 10,
  };
}

export const VARIANTS: Variant[] = [
  { label: '이전 (130ms·멈춤)', pacing: false, dropStallTime: false, sendIntervalMs: 130 },
  { label: '이후 (80ms·늦추기)', pacing: true, dropStallTime: true, sendIntervalMs: 80 },
];

export const NETS: NetProfile[] = [
  { oneWayMs: 60, jitterMs: 30, startOffsetMs: 80, hitchChance: 0 },
  { oneWayMs: 120, jitterMs: 80, startOffsetMs: 200, hitchChance: 0.01 },
  { oneWayMs: 180, jitterMs: 150, startOffsetMs: 300, hitchChance: 0.02 },
];

export function runAll(seeds = [1, 2, 3]): SimResult[] {
  const out: SimResult[] = [];
  for (const net of NETS) for (const v of VARIANTS) for (const s of seeds) out.push(simulate(s, net, v));
  return out;
}
