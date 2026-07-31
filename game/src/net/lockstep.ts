/**
 * 결정론적 락스텝.
 *
 * 양쪽 클라이언트가 같은 시드로 같은 `sim/` 을 돌리고, 오가는 것은 명령뿐이다.
 * 상태를 주고받지 않으므로 대역폭이 판 크기와 무관하고, `sim/` 을 손대지 않아도 된다.
 *
 * 대가는 **양쪽이 서로를 기다린다는 것**이다. 상대 배치가 안 오면 내 화면도 멈춘다.
 * 그래서 명령을 `inputDelayTicks` 만큼 미래에 예약해 왕복 시간을 미리 벌어 둔다.
 *
 * ── 왜 내 명령도 예약하는가 ────────────────────────────────────
 *
 * 내 명령을 즉시 적용하면 상대는 그 명령을 늦게 받아 **다른 틱에** 적용하게 된다.
 * 한 틱만 어긋나도 결정론이 깨진다. 그래서 내 명령도 상대와 똑같이 예약한다 —
 * 조작이 0.4초 굼떠 보이는 것이 이 방식의 값이다.
 *
 * ── 왜 서버 에코를 안 기다리는가 ───────────────────────────────
 *
 * 보낼 때 내 쪽에도 같이 예약하고, 돌아온 내 배치는 버린다. 에코를 기다리면 내 명령에도
 * 왕복이 붙어 입력 지연이 두 배가 된다. 순서가 갈릴 걱정은 없다 —
 * 한 틱의 명령을 항상 **플레이어 번호 순**으로 붙이기 때문에 도착 순서와 무관하게
 * 양쪽이 같은 배열을 만든다.
 */
import type { Command, MatchState, PlayerId } from '../sim/types';
import { hashState } from './hash';
import type { InputBatch, MatchSetup, MatchTransport } from './types';

/** 몇 틱마다 배치를 보내는가. 30Hz 기준 3틱 ≈ 100ms — remote function 초당 10회 제한에 맞춘 값. */
const BATCH_TICKS = 3;

interface Slot {
  1: Command[];
  2: Command[];
}

export class Lockstep {
  /** 실행 틱 → 플레이어별 명령. */
  private readonly scheduled = new Map<number, Slot>();
  /** 플레이어별 "이 틱까지는 내 명령이 없다"는 약속. */
  private readonly ackTick: Record<PlayerId, number>;
  /**
   * 플레이어별 마지막으로 받아들인 배치의 실행 틱.
   *
   * `ackTick` 과 따로 두는 이유: 첫 배치의 실행 틱이 초기 `ackTick`(= inputDelayTicks)과
   * 정확히 같아서, `ackTick` 으로 중복을 거르면 첫 배치가 통째로 버려진다.
   */
  private readonly lastPlaced: Record<PlayerId, number> = { 1: -1, 2: -1 };
  /** 다음 배치에 실릴 내 명령. */
  private outgoing: Command[] = [];
  private lastSentFor = -1;
  private readonly stop: () => void;

  /** 이미 지나간 틱으로 도착한 배치 수. 0이 아니면 입력 지연이 모자란 것이다. */
  lateBatches = 0;
  /** 마지막으로 상대를 기다린 적이 있는가. UI가 "대기 중"을 띄우는 데 쓴다. */
  stalled = false;

  constructor(
    private readonly setup: MatchSetup,
    private readonly transport: MatchTransport,
  ) {
    // 시작 구간은 아무도 명령을 낼 수 없다. 양쪽이 `inputDelayTicks` 까지는
    // 명령이 없다고 서로 약속한 상태로 출발해야 첫 틱부터 진행된다.
    const delay = setup.inputDelayTicks;
    this.ackTick = { 1: delay, 2: delay };
    this.stop = transport.onBatch((b) => this.receive(b));
  }

  dispose(): void {
    this.stop();
    this.transport.close?.();
  }

  /** 사람 입력. 다음 배치에 실려 나가고, 그때 내 쪽에도 예약된다. */
  submit(cmd: Command): void {
    this.outgoing.push(cmd);
  }

  /**
   * `tick` 을 돌려도 되는가. 상대 약속이 아직 이 틱에 못 미치면 `null` —
   * 호출부는 시뮬레이션을 멈추고 다음 프레임에 다시 물어야 한다.
   */
  commandsFor(tick: number): Command[] | null {
    const peer: PlayerId = this.setup.local === 1 ? 2 : 1;
    if (this.ackTick[peer] < tick) {
      this.stalled = true;
      return null;
    }
    this.stalled = false;

    const slot = this.scheduled.get(tick);
    if (!slot) return [];
    this.scheduled.delete(tick);
    // 항상 P1 → P2 순. 도착 순서에 기대면 양쪽 배열이 갈린다.
    return [...slot[1], ...slot[2]];
  }

  /**
   * 배치를 보낼 때가 됐으면 보낸다. **매 틱 부를 것** — 안 부르면 상대가 멈춘다.
   *
   * @param nextTick 다음에 돌릴 틱
   * @param state    해시를 뜨기 위한 현재 상태
   */
  pump(nextTick: number, state: MatchState): void {
    if (nextTick <= this.lastSentFor) return;
    if (nextTick % BATCH_TICKS !== 0) return;
    this.lastSentFor = nextTick;

    const batch: InputBatch = {
      player: this.setup.local,
      execTick: nextTick + this.setup.inputDelayTicks,
      commands: this.outgoing,
    };
    this.outgoing = [];

    const every = this.setup.desyncCheckTicks;
    if (every > 0 && state.tick % every === 0) {
      batch.hash = { tick: state.tick, value: hashState(state) };
    }

    // 보내면서 내 쪽에도 같이 예약한다. 돌아온 내 배치는 receive 에서 버린다.
    this.place(batch);
    this.transport.send(batch);
  }

  private receive(batch: InputBatch): void {
    // 서버가 모두에게 뿌리므로 내 것도 돌아온다. 이미 예약해 뒀으니 버린다.
    if (batch.player === this.setup.local) return;
    this.place(batch);
  }

  private place(batch: InputBatch): void {
    const tick = batch.execTick;
    if (tick <= this.lastPlaced[batch.player]) {
      // 이미 지나갔거나 중복된 배치다. 여기에 명령을 넣어 봐야 실행될 일이 없다 —
      // 조용히 버리면 양쪽 상태가 갈린 채로 계속 간다. 세어서 드러낸다.
      this.lateBatches++;
      return;
    }
    this.lastPlaced[batch.player] = tick;
    this.ackTick[batch.player] = tick;
    if (batch.commands.length === 0) return;

    let slot = this.scheduled.get(tick);
    if (!slot) {
      slot = { 1: [], 2: [] };
      this.scheduled.set(tick, slot);
    }
    slot[batch.player].push(...batch.commands);
  }
}
