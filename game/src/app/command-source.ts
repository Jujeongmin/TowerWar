/**
 * 한 틱의 명령이 어디서 오는가.
 *
 * `MatchScene` 은 상대가 봇인지 사람인지 몰라야 한다. 시뮬레이션이 명령의 출처를
 * 구분하지 못하는 것과 같은 이유다 — 그 성질이 PVP를 가능하게 만든 전부다(§3).
 *
 * 봇과 네트워크의 차이는 **기다림** 하나뿐이다. 봇은 언제나 즉시 명령을 내놓지만
 * 네트워크는 상대 입력이 안 오면 `null` 을 돌려 시뮬레이션을 멈춘다.
 */
import { BOT_NORMAL, Bot } from '../ai/bot';
import type { Lockstep } from '../net/lockstep';
import { TICK_DT } from '../sim/config';
import type { Command, MatchState, PlayerId } from '../sim/types';

export interface CommandSource {
  /** 사람 입력. */
  submit(cmd: Command): void;
  /**
   * `tick` 에 적용할 전체 명령. `null` 이면 아직 못 돈다 —
   * 호출부는 시뮬레이션을 멈추고 다음 프레임에 다시 물어야 한다.
   */
  commandsFor(tick: number, state: MatchState): Command[] | null;
  /** 틱 사이마다 호출. 네트워크 배치 전송이 여기서 일어난다. */
  pump?(nextTick: number, state: MatchState): void;
  dispose?(): void;
  /** 상대를 기다리는 중인가. HUD가 "대기 중"을 띄우는 데 쓴다. */
  readonly waiting: boolean;
  /** 정지가 길어졌을 때 콘솔에 찍을 값들. 봇전에는 없다. */
  stats?(): Record<string, number>;
}

/**
 * 판이 시작된 뒤 봇이 손을 놓고 있는 시간(초).
 *
 * 사람이 판을 읽을 틈을 준다 — 첫 프레임부터 상대 유닛이 밀려오면
 * 어디가 내 타워인지 보기도 전에 전선이 생긴다.
 *
 * **매치 시간(90초)은 그대로 흐른다.** 즉 봇은 90초 중 5초를 스스로 버리는 셈이고,
 * 그만큼 봇이 약해진다. 그걸 감수한 값이다.
 */
export const BOT_START_DELAY_SEC = 5;

/** 봇전. 상대 입력을 기다리는 일이 없다. */
export class BotSource implements CommandSource {
  private queued: Command[] = [];
  readonly waiting = false;

  constructor(private readonly bot: Bot) {}

  static forPlayer(me: PlayerId, startDelaySec = BOT_START_DELAY_SEC): BotSource {
    return new BotSource(new Bot(me, BOT_NORMAL, startDelaySec));
  }

  submit(cmd: Command): void {
    this.queued.push(cmd);
  }

  commandsFor(_tick: number, state: MatchState): Command[] {
    // 사람 명령이 먼저, 봇 명령이 나중. 이 순서가 곧 명령 우선권이라
    // 바꾸면 밸런스 측정 결과가 흔들린다 (HANDOFF §6).
    const out = this.queued;
    this.queued = [];
    out.push(...this.bot.think(state, TICK_DT));
    return out;
  }
}

/** PVP. 락스텝에 그대로 위임한다. */
export class NetSource implements CommandSource {
  constructor(private readonly lockstep: Lockstep) {}

  get waiting(): boolean {
    return this.lockstep.stalled;
  }

  submit(cmd: Command): void {
    this.lockstep.submit(cmd);
  }

  commandsFor(tick: number): Command[] | null {
    return this.lockstep.commandsFor(tick);
  }

  pump(nextTick: number, state: MatchState): void {
    this.lockstep.pump(nextTick, state);
  }

  stats(): Record<string, number> {
    return this.lockstep.stats();
  }

  dispose(): void {
    this.lockstep.dispose();
  }
}
