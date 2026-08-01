/**
 * 락스텝 검증. **배포 없이** 두 클라이언트를 한 프로세스에 붙여 전 구간을 대조한다.
 *
 * 게임 코드가 아니다 — 어디서도 import 하지 않으므로 빌드에 실리지 않는다.
 * dev 서버에서 동적 import 로 부른다 (HANDOFF §6의 헤드리스 검증 방식):
 *
 * ```js
 * const K = await import('/src/net/lockstep-check.ts?v=' + Date.now());
 * K.runAll();
 * ```
 *
 * 여기 있는 프레임 루프는 `MatchScene.frame` 을 그대로 옮긴 것이다.
 * **둘이 어긋나면 이 검증은 아무것도 증명하지 못한다.** `MatchScene` 을 고치면 여기도 고칠 것.
 *
 * 명령을 프레임이 아니라 **틱 루프 안에서** 내는 것이 중요하다. 프레임 단위로 내면
 * 따라잡기 구간에서 여러 틱을 건너뛰어, 락스텝이 아니라 하네스가 만든 차이를 보게 된다.
 */
import { DEFAULT_RATING } from '../account/account';
import { DEFAULT_PROFILE } from '../profiles';
import { DEFAULT_UNIT_KIND, unitPowerOf, type UnitKind } from '../units';
import { TICK_DT, speedMulFor } from '../sim/config';
import { generateMap } from '../sim/maps';
import { createMatch, step } from '../sim/sim';
import type { Command, MatchState, PlayerId } from '../sim/types';
import { hashState } from './hash';
import { Lockstep } from './lockstep';
import { LoopbackHub } from './loopback';
import type { MatchSetup, MatchTransport } from './types';

const FRAME_MS = 1000 / 60;

class FakeClient {
  state: MatchState;
  ls: Lockstep;
  private acc = 0;
  /** 틱 → 그 틱 직후의 상태 해시. 끝나고 전수 비교한다. */
  readonly perTick = new Map<number, string>();

  constructor(local: PlayerId, setup: Omit<MatchSetup, 'local'>, transport: MatchTransport) {
    // **`MatchScene.restart` 의 PVP 갈래와 같은 식이어야 한다.** 둘이 어긋나면
    // 이 검증은 실제로 도는 코드가 아니라 하네스를 검사하게 된다.
    this.state = createMatch(generateMap(setup.seed), {
      1: { speedMul: speedMulFor(setup.levels[1]), unitPower: unitPowerOf(setup.kinds[1]) },
      2: { speedMul: speedMulFor(setup.levels[2]), unitPower: unitPowerOf(setup.kinds[2]) },
    });
    this.ls = new Lockstep({ ...setup, local }, transport);
    this.local = local;
  }

  readonly local: PlayerId;

  /** 결정론적인 "사람 흉내". 자기 타워에서만 명령을 낸다. */
  private act(): void {
    const st = this.state;
    const mine = st.towers.filter((t) => t.owner === this.local);
    if (mine.length === 0) return;
    const from = mine[st.tick % mine.length];

    if (st.tick % 29 === 0) {
      const target = st.towers.filter((o) => o.owner !== this.local)[st.tick % 3];
      if (target) {
        this.ls.submit({
          kind: 'toggleRoute',
          player: this.local,
          fromId: from.id,
          toId: target.id,
        } as Command);
      }
    }
  }

  frame(dt: number): void {
    this.acc = Math.min(this.acc + dt, 0.5);
    while (this.acc >= TICK_DT) {
      this.ls.pump(this.state.tick, this.state);
      this.act();
      const cmds = this.ls.commandsFor(this.state.tick);
      if (cmds === null) break;
      step(this.state, cmds);
      this.perTick.set(this.state.tick, hashState(this.state));
      this.acc -= TICK_DT;
    }
    this.ls.pump(this.state.tick, this.state);
  }
}

export interface CheckResult {
  label: string;
  winners: string;
  finalTick: string;
  comparedTicks: number;
  /** 두 클라이언트의 해시가 처음 갈린 틱. `null` 이면 끝까지 같았다. */
  firstDiffTick: number | null;
  lateBatches: number;
  stallFrames: number;
  ok: boolean;
}

export function runCase(seed: number, latencyMs: number, inputDelayTicks: number): CheckResult {
  const hub = new LoopbackHub(latencyMs);
  // 강화 단계는 양쪽 0. 이 검증은 락스텝만 본다 — 보정이 갈리는 경우는
  // 애초에 서버가 같은 값을 내려주므로 여기서 흔들 이유가 없다.
  // 강화 단계는 양쪽 0, 이름은 검증에 안 쓴다. 이 검증은 락스텝만 본다 —
  // 보정이 갈리는 경우는 애초에 서버가 같은 값을 내려주므로 여기서 흔들 이유가 없다.
  const setup = {
    seed,
    inputDelayTicks,
    desyncCheckTicks: 30,
    levels: { 1: 0, 2: 0 },
    // 종류를 서로 다르게 준다. 힘이 갈린 상태에서도 락스텝이 어긋나지 않는지 봐야 한다 —
    // 양쪽 다 기본값이면 `unitPower` 경로가 한 번도 안 밟힌다.
    kinds: { 1: DEFAULT_UNIT_KIND, 2: 'beergang_purple' as UnitKind },
    names: { 1: 'A', 2: 'B' },
    // 카탈로그에서 읽는다. id를 손으로 박아 두면 아바타 목록을 고칠 때마다 여기가 깨진다.
    profiles: { 1: DEFAULT_PROFILE, 2: DEFAULT_PROFILE },
    // 점수도 검증에 안 쓴다 — HUD 표시용이라 시뮬레이션에 안 들어간다.
    ratings: { 1: DEFAULT_RATING, 2: DEFAULT_RATING },
  };
  const a = new FakeClient(1, setup, hub.port());
  const b = new FakeClient(2, setup, hub.port());

  let frames = 0;
  let stallFrames = 0;
  while ((a.state.winner === null || b.state.winner === null) && frames < 120000) {
    a.frame(FRAME_MS / 1000);
    b.frame(FRAME_MS / 1000);
    hub.advance(FRAME_MS);
    if (a.ls.stalled || b.ls.stalled) stallFrames++;
    frames++;
  }

  let firstDiffTick: number | null = null;
  let comparedTicks = 0;
  for (const [tick, ha] of a.perTick) {
    const hb = b.perTick.get(tick);
    if (hb === undefined) continue;
    comparedTicks++;
    if (ha !== hb && firstDiffTick === null) firstDiffTick = tick;
  }

  const lateBatches = a.ls.lateBatches + b.ls.lateBatches;
  return {
    label: `시드 ${seed} / 지연 ${latencyMs}ms / 입력지연 ${inputDelayTicks}틱`,
    winners: `${a.state.winner}/${b.state.winner}`,
    finalTick: `${a.state.tick}/${b.state.tick}`,
    comparedTicks,
    firstDiffTick,
    lateBatches,
    stallFrames,
    ok:
      firstDiffTick === null &&
      lateBatches === 0 &&
      comparedTicks > 0 &&
      a.state.winner === b.state.winner &&
      a.state.tick === b.state.tick,
  };
}

/** 지연이 입력 지연보다 큰 조합을 일부러 넣는다 — 대기(stall) 경로가 안 밟히면 검증이 헐겁다. */
export function runAll(): { results: CheckResult[]; passed: number; total: number } {
  const results = [
    runCase(1, 0, 12),
    runCase(2, 0, 12),
    runCase(3, 0, 12),
    runCase(4, 0, 12),
    runCase(5, 0, 12),
    runCase(1, 250, 12),
    runCase(1, 500, 12),
    runCase(1, 1000, 12),
    runCase(2, 300, 3),
    runCase(3, 700, 6),
  ];
  return { results, passed: results.filter((r) => r.ok).length, total: results.length };
}
