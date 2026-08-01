/**
 * 한 판. 고정 타임스텝 루프와 매치 상태를 통째로 들고 있다.
 *
 * 렌더 프레임레이트가 흔들려도 시뮬레이션은 항상 TICK_DT씩만 전진한다 —
 * 이게 깨지면 서버와 클라이언트의 결과가 갈라져 PVP가 성립하지 않는다.
 *
 * **상대가 봇인지 사람인지 이 파일은 모른다.** 차이는 `CommandSource` 하나에 갇혀 있다.
 */
import { rewardFor, type Reward } from '../account/account';
import type { RatingChange } from '../account/store';
import { Lockstep } from '../net/lockstep';
import { TICK_DT, speedMulFor } from '../sim/config';
import { generateMap } from '../sim/maps';
import { createMatch, step } from '../sim/sim';
import type { MatchState, PlayerId, PlayerMods } from '../sim/types';
import { InputController } from '../render/input';
import type { Renderer } from '../render/renderer';
import { unitPowerOf, type UnitKind } from '../units';
import type { ProfileId } from '../profiles';
import { botName, botProfile, botRating } from './bot-name';
import { BotSource, NetSource, type CommandSource } from './command-source';
import type { MatchPlan, Scene } from './scene';

/**
 * 누산기 상한(초). 탭이 백그라운드였거나 상대를 오래 기다린 뒤 한 프레임에
 * 수백 틱을 몰아 돌면 화면이 얼어붙는다. 밀린 시간은 버린다 —
 * 락스텝은 틱 번호로 맞추므로 벽시계가 밀려도 결과는 안 갈라진다.
 */
const MAX_ACCUMULATOR = 0.5;

export class MatchScene implements Scene {
  private state: MatchState = createMatch([]);
  private source: CommandSource = BotSource.forPlayer(2);
  private input: InputController | null = null;
  private accumulator = 0;
  /** 결과창을 이미 띄웠는가. 매 프레임 다시 띄우지 않기 위한 것. */
  private resultShown = false;
  /**
   * 결과 화면을 몇 번째 띄웠는가. 점수 변동은 서버 왕복이라 늦게 오는데, 그 사이에
   * 다음 판이 끝나면 앞 판의 점수가 새 결과 화면에 얹힌다 — 번호가 다르면 버린다.
   */
  private resultRound = 0;
  /** 이 판이 PVP인가. 결과 화면의 [다시 하기]를 가리는 데 쓴다. */
  private pvp = false;
  /**
   * 내가 항복했는가. **보상을 막는 데만 쓴다** (사용자 결정: 항복은 0코인).
   *
   * 시뮬레이션이 아니라 여기 있는 이유: 항복해도 `state.winner` 는 그냥 상대 승리라
   * 시간 종료 패배와 구분이 안 되는데, **구분은 내 화면과 내 보상에만 필요하다.**
   * `MatchState` 에 넣으면 순수 표시용 값이 서버 권위 PVP의 검증 대상이 된다.
   *
   * 이걸로 남의 보상을 막을 수는 없다 — PVP 상대는 자기 클라이언트에서 정상 승리로
   * 보고하고 승리 보상을 그대로 받는다.
   */
  private resigned = false;
  /**
   * 설정을 열어 판이 멈춰 있는가. **봇전에서만 참이 된다.**
   *
   * PVP에서는 멈출 수가 없다 — 상대는 계속 두고, 무엇보다 `pump()` 가 멈추면
   * 내 `ackTick` 이 안 나가 **상대까지 교착에 빠진다** (§-6).
   */

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly renderer: Renderer,
    private readonly resultRoot: HTMLElement,
    private readonly resultTitle: HTMLElement,
    private readonly resultReward: HTMLElement,
    private readonly resultRating: HTMLElement,
    /**
     * 판이 끝났다. 보상을 실제로 주는 곳은 계정을 든 쪽(main.ts)이다 —
     * 서버 방이면 서버가 주고, 오프라인 봇전이면 로컬에 준다.
     *
     * 점수 변동을 돌려준다. **서버 왕복이라 결과 화면보다 늦게 온다** — 보상 줄을
     * 먼저 띄우고 점수 줄은 도착하면 채운다. 안 움직였으면 `null` 이라 줄이 안 뜬다.
     */
    private readonly grantReward: (
      reward: Reward,
      winnerSlot: number,
    ) => Promise<RatingChange | null>,
    private readonly toLobby: () => void,
    /**
     * 양쪽 플레이어의 보정. 매 판 시작할 때 새로 읽는다 — 로비에서 사고 바로 시작할 수 있다.
     * 봇 몫도 여기 들어 있다 (app/difficulty.ts).
     */
    private readonly getMods: () => Partial<Record<PlayerId, PlayerMods>>,
    /**
     * 사람이 착용한 유닛 종류. **순수 외형이 아니다** (2026-07-31~) — 종류가 힘을 정한다.
     * 다만 힘 자체는 `getMods()` 를 통해 이미 들어오므로 여기서는 **그리는 데만** 쓴다.
     * 두 값이 같은 계정에서 나오므로 어긋날 일이 없다.
     */
    private readonly getUnitKind: () => UnitKind,
    /** 내 닉네임. PVP에서는 서버가 내려준 값이 이걸 덮는다. */
    private readonly getPlayerName: () => string,
    /** 내 프로필 아바타. 이름과 같은 규칙이다. */
    private readonly getProfile: () => ProfileId,
    /** 내 PVP 점수. 봇전에서만 쓴다 — PVP는 서버가 찍어 준 스냅샷이 이걸 덮는다. */
    private readonly getRating: () => number,
    /** 이 판의 조건. 씬에 들어올 때마다 새로 읽는다. */
    private readonly getPlan: () => MatchPlan,
    /** 캔버스 위 [항복] 버튼. 매치 중에만 보인다. */
    private readonly resignBtn: HTMLButtonElement,
  ) {
    const again = resultRoot.querySelector<HTMLButtonElement>('#btn-again');
    const lobby = resultRoot.querySelector<HTMLButtonElement>('#btn-lobby');
    if (!again || !lobby) throw new Error('결과 화면에 버튼이 없습니다');
    // 봇전은 서버가 준 시드로 시작하지만, [다시 하기]까지 그 시드를 쓰면
    // 같은 맵만 반복된다. 다시 할 때는 새로 뽑는다.
    again.addEventListener('click', () => this.restart(true));
    lobby.addEventListener('click', () => this.toLobby());

    // **재확인도 설정 창도 없다.** 한 번 누르면 바로 항복이다 (§-23 사용자 지시).
    // 되돌릴 수 없고 보상도 0이라는 것은 버튼 글자 자체가 알린다.
    this.resignBtn.addEventListener('click', () => this.resign());
  }

  enter(): void {
    this.canvas.hidden = false;
    this.resignBtn.hidden = false;
    // 숨겨져 있는 동안 레이아웃 크기가 0이 된다. 안 부르면 첫 프레임이 찌그러진다.
    this.renderer.resize();
    this.restart();
  }

  exit(): void {
    this.teardown();
    this.canvas.hidden = true;
    // 매치 밖에서 남아 있으면 로비 위에 떠서 아무 데도 안 걸린다.
    this.resignBtn.hidden = true;
    this.hideResult();
  }

  /**
   * 항복. **커맨드로 낸다** — 씬에서 직접 `winner` 를 박으면 PVP에서 상대 시뮬레이션과
   * 갈라진다. 여기서 판이 끝나는 것이 아니라, 이 명령이 `inputDelayTicks` 뒤에 적용될 때
   * **양쪽에서 동시에** 끝난다. 그래서 판을 멈추면 안 된다 — 멈추면 명령이 적용될 틱까지
   * 시뮬레이션이 안 굴러 아무 일도 안 일어난다.
   */
  private resign(): void {
    const local = this.input?.ui.local;
    if (local === undefined || this.state.winner !== null) return;
    this.resigned = true;
    this.source.submit({ kind: 'resign', player: local });
  }

  /**
   * 판을 새로 시작한다. 렌더러는 재사용한다 (스프라이트를 다시 로드하지 않으려고).
   *
   * PVP에서는 [다시 하기]가 없으므로 여기 두 번째로 들어올 일이 없다.
   */
  restart(reroll = false): void {
    this.teardown();
    const plan = this.getPlan();
    this.pvp = plan.mode === 'pvp';

    const planSeed = plan.mode === 'pvp' ? plan.setup.seed : reroll ? undefined : plan.seed;
    const seed = (planSeed ?? Date.now()) & 0xffff;
    const local: PlayerId = plan.mode === 'pvp' ? plan.setup.local : 1;

    const other: PlayerId = local === 1 ? 2 : 1;
    // 화면에 그릴 종류. 아래 두 갈래가 각자 채운다 — **sim 에 들어간 힘과 반드시 같은
    // 종류여야 한다.** 색이 곧 세기라, 어긋나면 화면이 거짓말을 한다.
    let shownKinds: Record<PlayerId, UnitKind>;

    if (plan.mode === 'pvp') {
      // **보정은 서버가 내려준 값으로만 만든다.** 각자 자기 계정을 읽으면 두 쪽이
      // 다른 배수로 시뮬레이션해 첫 틱부터 갈라진다 (net/types.ts MatchSetup 참고).
      const { levels, kinds } = plan.setup;
      this.state = createMatch(generateMap(seed), {
        1: { speedMul: speedMulFor(levels[1]), unitPower: unitPowerOf(kinds[1]) },
        2: { speedMul: speedMulFor(levels[2]), unitPower: unitPowerOf(kinds[2]) },
      });
      this.source = new NetSource(new Lockstep(plan.setup, plan.transport));
      shownKinds = { 1: kinds[1], 2: kinds[2] };
    } else {
      // 봇도 사람의 강화 단계를 따라 세진다 (app/difficulty.ts). 안 그러면 강화를 살수록
      // 봇전이 쉬워지기만 한다.
      this.state = createMatch(generateMap(seed), this.getMods());
      this.source = BotSource.forPlayer(2);
      // **봇을 내 종류로 그린다.** 전에는 상대가 항상 기본 생김새였는데, 종류가 힘을
      // 정하게 된 뒤로 그러면 화면이 거짓말이 된다 — 봇은 `botModsFor` 로 나와 정확히
      // 같은 힘을 갖는데 기본 생김새로 그리면 약해 보인다.
      const mine = this.getUnitKind();
      shownKinds = { [local]: mine, [other]: mine } as Record<PlayerId, UnitKind>;
    }

    // 종류와 이름은 매치 상태가 아니라 렌더러가 든다 — 서버 권위로 갈 때 검증 대상을
    // 늘리지 않으려는 것이다. 힘은 위에서 이미 `PlayerMods` 로 들어갔다.
    this.renderer.setUnitKinds(shownKinds);
    if (plan.mode === 'pvp') {
      // 서버가 내려준 것만 쓴다. 클라이언트가 보내면 남의 이름·아바타를 자칭할 수 있다.
      this.renderer.setNames({ 1: plan.setup.names[1], 2: plan.setup.names[2] });
      this.renderer.setProfiles({ 1: plan.setup.profiles[1], 2: plan.setup.profiles[2] });
      this.renderer.setRatings({ 1: plan.setup.ratings[1], 2: plan.setup.ratings[2] });
    } else {
      // 봇 이름·아바타는 클라이언트가 만든다 — 봇이라는 것을 화면에 안 알리기로 했다
      // (app/bot-name.ts).
      this.renderer.setNames({ [local]: this.getPlayerName(), [other]: botName(seed) });
      this.renderer.setProfiles({ [local]: this.getProfile(), [other]: botProfile(seed) });
      // 내 점수는 계정에서, 봇 점수는 내 점수 근처에서 만든다 (app/bot-name.ts).
      const myRating = this.getRating();
      this.renderer.setRatings({ [local]: myRating, [other]: botRating(seed, myRating) });
    }

    this.input = new InputController(
      this.canvas,
      this.renderer,
      () => this.state,
      (cmd) => this.source.submit(cmd),
      local,
    );

    // 로비에 머문 시간이 dt로 흘러들어오지 않게 누산기를 비운다.
    // 안 그러면 시작하자마자 여러 틱이 한 프레임에 몰려 화면이 튄다.
    this.accumulator = 0;
    // [다시 하기]로 들어온 판이면 앞 판의 항복 상태가 남아 있다. 안 지우면
    // 새 판을 이기고도 '항복 — 보상 없음'이 뜬다.
    this.resigned = false;
    this.resignBtn.hidden = false;
    this.hideResult();
  }

  frame(dt: number): void {
    // **판을 멈추는 경로가 없다.** 설정 창이 있던 시절에는 봇전에서만 멈췄는데,
    // 그것이 곧 "상대가 봇이다"를 알려 주는 신호였다 (§-7은 안 알리기로 했다).
    this.accumulator = Math.min(this.accumulator + dt, MAX_ACCUMULATOR);

    while (this.accumulator >= TICK_DT) {
      // 배치를 먼저 보낸다. 내가 멈춰 있어도 이건 계속 나가야 상대가 진행한다.
      this.source.pump?.(this.state.tick, this.state);

      const commands = this.source.commandsFor(this.state.tick, this.state);
      // null = 상대 입력이 아직 안 왔다. 시간을 누산기에 남겨 두고 다음 프레임에 다시 본다.
      if (commands === null) break;

      const events = step(this.state, commands);
      this.renderer.ingest(this.state, events);
      this.accumulator -= TICK_DT;
    }

    // 루프를 한 번도 못 돌았을 수 있다. 그래도 내 약속은 보내야 교착이 안 생긴다.
    this.source.pump?.(this.state.tick, this.state);
    this.renderer.setWaiting(this.source.waiting);

    const ui = this.input?.ui;
    if (ui) this.renderer.render(this.state, ui, this.accumulator / TICK_DT, dt);

    // 승부가 나도 씬은 유지한다. 여기서 화면을 바꾸면 마지막 점령 이펙트가 잘린다.
    if (this.state.winner !== null && !this.resultShown) this.showResult();
  }

  private teardown(): void {
    this.input?.dispose();
    this.input = null;
    this.source.dispose?.();
  }

  private showResult(): void {
    // 끝난 판에서 항복 버튼이 남아 있으면 결과창 위에 떠서 [로비로]를 가린다.
    this.resignBtn.hidden = true;

    const local = this.input?.ui.local ?? 1;
    const w = this.state.winner;
    this.resultTitle.textContent = this.resigned ? '항복' : w === 0 ? '무승부' : w === local ? '승리' : '패배';

    // resultShown 플래그가 이 블록을 판당 한 번으로 막는다. 여기가 두 번 돌면
    // 보상이 두 번 들어간다.
    //
    // **항복하면 아예 보고하지 않는다** (사용자 결정: 항복은 0코인). 서버가 보상을
    // 계산하므로(§-10) 안 부르는 것이 곧 0이다 — 서버에 "항복" 개념을 넣을 필요가 없다.
    // PVP 상대는 자기 클라이언트에서 정상 승리로 보고하고 승리 보상을 그대로 받는다.
    // 점수 줄은 서버 응답이 와야 채워진다. 이전 판의 값이 남아 있으면 안 되므로
    // 여기서 먼저 지운다.
    this.resultRating.hidden = true;
    this.resultRating.textContent = '';

    if (this.resigned) {
      this.resultReward.textContent = '항복 — 보상 없음';
    } else {
      const reward = rewardFor(this.state, local);
      const shown = ++this.resultRound;
      void this.grantReward(reward, w ?? 0).then((change) => {
        // 늦게 온 응답이 다음 판의 결과 화면을 덮어쓰지 않게 한다.
        if (shown === this.resultRound) this.showRating(change);
      });
      this.resultReward.textContent =
        `+${reward.total}  (기본 ${reward.base} · 타워 ${reward.towers}개 ${reward.towerBonus})`;
    }

    // PVP는 같은 상대와 같은 시드로 다시 시작할 수 없다. 로비로만 나간다.
    const again = this.resultRoot.querySelector<HTMLButtonElement>('#btn-again');
    if (again) again.hidden = this.pvp;

    this.resultRoot.hidden = false;
    this.resultShown = true;
  }

  /**
   * 점수 변동 한 줄. **안 움직였으면 줄 자체를 안 띄운다** — 오프라인이거나 보고가
   * 실패한 경우라 "±0" 으로 적으면 안 움직인 것처럼 읽힌다.
   */
  private showRating(change: RatingChange | null): void {
    if (!change) return;
    const diff = change.after - change.before;
    const sign = diff > 0 ? '+' : ''; // 음수는 부호가 이미 붙어 있다
    this.resultRating.textContent = `점수 ${change.before} → ${change.after}  (${sign}${diff})`;
    this.resultRating.classList.toggle('rating-up', diff > 0);
    this.resultRating.classList.toggle('rating-down', diff < 0);
    this.resultRating.hidden = false;
  }

  private hideResult(): void {
    this.resultRoot.hidden = true;
    this.resultShown = false;
  }
}
