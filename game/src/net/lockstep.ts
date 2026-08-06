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
import { TICK_RATE } from '../sim/config';
import { tempoScaleOf } from '../sim/sim';
import type { Command, MatchState, PlayerId } from '../sim/types';
import { hashState } from './hash';
import type { InputBatch, MatchSetup, MatchTransport } from './types';

/**
 * 배치를 보내는 최소 간격(ms). **벽시계로 잰다.**
 *
 * `pump` 는 매 틱(달릴 땐 30Hz, 멈췄을 땐 프레임마다) 불린다. 틱 수(`state.tick`)로
 * 빈도를 재면 두 함정에 빠진다: 시뮬레이션이 멈추면 틱이 안 늘어 **영영 안 보내고**
 * (교착), 반대로 매 틱 보내면 **초당 30회**라 remote function 한도(10회)를 넘겨
 * 서버가 배치를 버린다 — 그러면 시간은 상대 배치로 흐르는데 **내 조작(항복·경로)만
 * 유실**된다. 벽시계로 이 간격마다 한 번만 보내면 둘 다 안 생긴다 (2026-08-06).
 *
 * **한도는 롤링 1초에 10회**다 (`@agent8/gameserver` 의 `remoteFunction`). 100ms
 * (정확히 10회/초)는 롤링 윈도우 경계라 가끔 11번째가 `Too many calls` 로 던져진다
 * (실제로 났다, 1.5배속에서). **130ms(≈7.7회/초)로 여유를 둔다.** 그 위에
 * `agent8.ts` 의 sendInputs 가 SDK throttle 옵션까지 걸어 어떤 경우에도 안 던지게 한다.
 */
const SEND_INTERVAL_MS = 130;

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
  /** 마지막으로 보낸 배치의 실행 틱. `state.tick` 이 아니라 **execTick** 기준이다. */
  private lastSentFor = -1;
  /** 마지막으로 배치를 보낸 벽시계 시각(ms). 전송 빈도를 `SEND_INTERVAL_MS` 로 묶는다. */
  private lastSendAt = 0;
  private readonly stop: () => void;

  /** 이미 지나간 틱으로 도착한 배치 수. 0이 아니면 입력 지연이 모자란 것이다. */
  lateBatches = 0;
  /** 마지막으로 상대를 기다린 적이 있는가. UI가 "대기 중"을 띄우는 데 쓴다. */
  stalled = false;
  /** 보낸 배치 수. 정지 진단용. */
  private sent = 0;
  /** 상대에게서 받은 배치 수. 정지 진단용 — 0에서 안 늘면 채널이 죽은 것이다. */
  private received = 0;
  /** 마지막으로 상대 배치를 받은 벽시계 시각(ms). */
  private lastRecvAt = 0;

  /**
   * 정지 원인을 가르는 값들. **화면에는 안 쓴다** — 멈췄을 때 콘솔에 한 번 찍는 용도다.
   *
   * `peerAck` 이 `tick` 을 못 따라오는데 `received` 가 안 늘면 채널이 죽은 것이고,
   * `received` 는 느는데 `peerAck` 이 굼뜨면 상대의 전송률 문제다. 이 둘을 못 가르면
   * 로그를 봐도 어느 쪽을 고쳐야 하는지 알 수 없다.
   */
  stats(): Record<string, number> {
    const peer: PlayerId = this.setup.local === 1 ? 2 : 1;
    return {
      peerAck: this.ackTick[peer],
      myAck: this.ackTick[this.setup.local],
      lastSentFor: this.lastSentFor,
      sent: this.sent,
      received: this.received,
      msSinceRecv: this.lastRecvAt === 0 ? -1 : Date.now() - this.lastRecvAt,
      lateBatches: this.lateBatches,
    };
  }

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
    // **전송 빈도는 벽시계로 묶는다** (`SEND_INTERVAL_MS`). `pump` 는 매 틱 불리므로
    // 그대로 보내면 초당 30회라 remote function 한도를 넘겨 내 조작이 유실된다.
    // 아직 간격이 안 됐으면 `outgoing` 을 그대로 쌓아 두고 다음 기회에 함께 보낸다 —
    // 명령은 버려지지 않고 최대 100ms 늦게 나갈 뿐이다.
    const now = Date.now();
    const since = now - this.lastSendAt;
    if (since < SEND_INTERVAL_MS) return;
    this.lastSendAt = now;

    // **`state.tick` 이 멈춰도 배치를 계속 보내야 한다.**
    //
    // 상대 배치가 늦게 와서(`commandsFor` → `stalled`) 시뮬레이션이 멈추면
    // `state.tick` 이 그 자리에 고정된다. `execTick` 을 `state.tick` 에서 계산하면
    // 그 값도 고정이라 교착이 된다 — 상대는 내 배치를, 나는 상대를 기다린다.
    // 그래서 `lastSentFor`(마지막으로 보낸 execTick)보다 앞선 execTick 으로 계속
    // 예약한다. 멈춰 있어도 빈 배치가 상대의 `ackTick` 을 올려 양쪽이 풀린다.
    //
    // **얼마나 앞서느냐가 복구를 가른다.** 고정 3틱은 100ms 전송 시절의 값이었다.
    // 지금은 130ms 마다 보내므로 3틱 = 23틱/초인데 시뮬레이션은 30틱/초(배속이면 45·60)를
    // 요구한다 — 약속이 수요보다 느려서 한 번 멈추면 **영영 못 풀린다** (2026-08-06 신고).
    // 그래서 실제로 흐른 시간이 요구하는 틱 수만큼 올린다. 더 올리면 정지가 끝난 뒤에도
    // 약속이 앞서 남아 입력 지연이 영구히 늘고, 덜 올리면 지금처럼 못 푼다.
    let execTick = nextTick + this.setup.inputDelayTicks;
    if (execTick <= this.lastSentFor) {
      const owed = Math.round((since / 1000) * TICK_RATE * tempoScaleOf(state));
      execTick = this.lastSentFor + Math.max(1, owed);
    }
    this.lastSentFor = execTick;

    const batch: InputBatch = {
      player: this.setup.local,
      execTick,
      commands: this.outgoing,
    };
    this.outgoing = [];

    const every = this.setup.desyncCheckTicks;
    if (every > 0 && state.tick % every === 0) {
      batch.hash = { tick: state.tick, value: hashState(state) };
    }

    // 보내면서 내 쪽에도 같이 예약한다. 돌아온 내 배치는 receive 에서 버린다.
    this.place(batch);
    this.sent++;
    this.transport.send(batch);
  }

  private receive(batch: InputBatch): void {
    // 서버가 모두에게 뿌리므로 내 것도 돌아온다. 이미 예약해 뒀으니 버린다.
    if (batch.player === this.setup.local) return;
    this.received++;
    this.lastRecvAt = Date.now();
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
