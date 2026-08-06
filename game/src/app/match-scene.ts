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
import { audio } from '../audio';
import { isAdReady } from '../net/ads';
import { t } from '../i18n';
import { Lockstep } from '../net/lockstep';
import { TICK_DT } from '../sim/config';
import { generateMap } from '../sim/maps';
import { createMatch, step, tempoScaleOf } from '../sim/sim';
import type { MatchState, Owner, PlayerId, PlayerMods, TickEvents } from '../sim/types';
import { InputController } from '../render/input';
import type { Renderer } from '../render/renderer';
import { stepDownKind, unitPowerOf, type UnitKind } from '../units';
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

/**
 * 상대를 이만큼(ms) 계속 기다렸으면 끊긴 것으로 보고 판을 끝낸다.
 *
 * **정상 경로가 아니다.** 상대가 끊기면 서버가 `PEER_TIMEOUT_MS`(10초) 뒤에 남은 쪽
 * 승리로 방을 닫고, 그 판정이 `transport.onClosed` 로 온다. 이건 **그 신호마저 못 받는
 * 경우**의 마지막 수단이므로 서버 타임아웃보다 넉넉해야 한다.
 *
 * **여기서 승패를 정하지 않는다** (2026-08-06 실기 영상). 처음엔 "내 소켓이 죽었으면
 * 서버도 나를 조용한 쪽으로 볼 테니 패배가 맞다"고 봤는데, 실제로는 **상대가 끊긴
 * 경우에도** 이 타이머가 먼저 도는 일이 있었다 — 그때 패배를 지어내 보고하면 멀쩡히
 * 이기고 있던 사람의 점수가 깎인다. 승패는 서버만 정한다. 여기서는 판을 닫고
 * "연결 끊김"만 알린다 (`endedByDisconnect`).
 *
 * 서버의 `PEER_TIMEOUT_MS`(20초)보다 커야 한다 — 서버가 먼저 판정하게 두는 것이 낫다.
 */
const STALL_GIVEUP_MS = 25000;

/** 정지가 이만큼(ms) 이어지면 콘솔에 원인 진단을 **한 번** 찍는다. */
const STALL_DIAGNOSE_MS = 3000;

/**
 * "상대를 기다리는 중"을 띄우기까지 참는 시간(ms).
 *
 * 락스텝은 상대 배치가 전송 주기(130ms)마다 뭉텅이로 오므로, 그 사이 한두 프레임쯤
 * 걸리는 것은 **정상이다.** 그때마다 글자를 띄우면 판이 멀쩡히 굴러가는데도 계속
 * 깜빡여서, 진짜 정지와 구분이 안 된다 (2026-08-06 사용자 신고).
 *
 * 전송 주기보다 넉넉히 잡아 한 주기를 통째로 놓쳤을 때만 뜨게 한다.
 */
const WAITING_HINT_MS = 400;

/**
 * 정지가 이만큼(ms) 이어지면 통로를 다시 세워 본다 (`transport.recover`).
 *
 * SDK 재연결이 소켓만 붙이고 방 참가·구독은 복구하지 않으므로, 끊겼다 붙으면
 * **아무도 안 고쳐 주는 상태**로 남는다 (`net/agent8.ts` 의 `recover` 주석).
 * 여기가 그걸 알아채는 유일한 자리다 — 판이 멈췄다는 사실 말고는 단서가 없다.
 *
 * 정상적인 지연(왕복 지터)과 구분되게 넉넉히 잡는다. 헛불러도 손해는 구독을
 * 다시 거는 것뿐이라 크게 위험하지 않다.
 */
const STALL_RECOVER_MS = 4000;

/** 복구를 다시 시도하기까지의 간격(ms). SDK 재연결 백오프(1·2·4초)와 맞물릴 시간을 준다. */
const RECOVER_RETRY_MS = 3000;

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
  /** 방 상태 구독 해제. PVP에서만 걸린다. */
  private unwatchRoom: (() => void) | null = null;
  /**
   * 서버가 내린 판정. **바로 안 쓴다** — 판이 정상적으로 끝나는 순간에도 방은 닫히는데,
   * 그때 이 값을 박으면 내 시뮬레이션이 마지막 몇 틱을 못 돌아 타워 수가 어긋난다
   * (보상이 그 수로 계산된다). 시뮬레이션이 **실제로 멈춰 있을 때만** 적용한다.
   */
  private serverVerdict: Owner | null = null;
  /** 상대를 기다리기 시작한 벽시계 시각(ms). 0이면 안 기다리는 중. */
  private stalledSince = 0;
  /** 이번 정지에 대해 진단을 이미 찍었는가. 매 프레임 찍으면 콘솔이 못 쓰게 된다. */
  private stallLogged = false;
  /** 마지막으로 통로 복구를 시도한 벽시계 시각(ms). 0이면 이번 정지에서 아직 안 했다. */
  private recoveredAt = 0;
  /**
   * 연결이 끊겨 끝난 판인가. **승패가 아니다** — 결과 화면이 이걸 보고 보상·점수 보고를
   * 통째로 건너뛴다 (`STALL_GIVEUP_MS` 주석).
   */
  private endedByDisconnect = false;

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
    /** 결과 화면의 [다시 매칭]. 자동 매칭 화면으로 돌아가 상대를 다시 찾는다. */
    private readonly toMatchmaking: () => void,
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
    /** 캔버스 위 배속 토글. **살 수 있는 사람에게만** 보인다. */
    private readonly tempoBtn: HTMLButtonElement,
    /** 상대가 배속을 켰을 때 양쪽 모두에게 보이는 읽기 전용 상태. */
    private readonly tempoStatus: HTMLElement,
    /** 결과 화면의 [광고 보고 두 배] 버튼. */
    private readonly adDoubleBtn: HTMLButtonElement,
    /** 광고를 보고 보상 두 배. `null` 이면 성공, 아니면 실패 이유. */
    private readonly watchAdForDouble: () => Promise<string | null>,
  ) {
    const again = resultRoot.querySelector<HTMLButtonElement>('#btn-again');
    const lobby = resultRoot.querySelector<HTMLButtonElement>('#btn-lobby');
    if (!again || !lobby) throw new Error('결과 화면에 버튼이 없습니다');
    // **같은 판을 다시 돌리지 않는다 — 매칭을 다시 잡는다** (2026-08-04 사용자 지시).
    //
    // 전에는 `restart(true)` 로 시드만 새로 뽑아 그 자리에서 봇전을 다시 열었고,
    // PVP에서는 같은 상대와 같은 시드를 쓸 수 없어 버튼을 아예 숨겼다. 그래서
    // 봇전과 PVP의 결과 화면이 서로 달랐다. 이제 둘 다 매칭 화면으로 돌아간다 —
    // 봇전이었다면 상대를 다시 찾다가 없으면 또 봇으로 떨어진다(§-7).
    again.addEventListener('click', () => this.toMatchmaking());
    lobby.addEventListener('click', () => this.toLobby());

    // **재확인도 설정 창도 없다.** 한 번 누르면 바로 항복이다 (§-23 사용자 지시).
    // 되돌릴 수 없고 보상도 0이라는 것은 버튼 글자 자체가 알린다.
    this.resignBtn.addEventListener('click', () => this.resign());
    this.tempoBtn.addEventListener('click', () => this.toggleTempo());

    this.adDoubleBtn.addEventListener('click', () => {
      // 광고를 보는 동안 두 번 눌리면 두 번 재생된다. 성공하면 버튼이 사라지므로
      // 되살릴 필요가 없다 — **판당 한 번**이다 (서버의 `doubled` 가 자물쇠).
      this.adDoubleBtn.disabled = true;
      void this.watchAdForDouble().then((err) => {
        if (err === null) {
          this.adDoubleBtn.hidden = true;
          audio.play('purchase');
          return;
        }
        // 실패했으면 다시 누를 수 있어야 한다 — 광고가 안 뜬 것일 수도 있다.
        this.adDoubleBtn.disabled = false;
      });
    });
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
    this.tempoBtn.hidden = true;
    this.tempoStatus.hidden = true;
    this.adDoubleBtn.hidden = true;
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
    // **연타를 막는다.** 명령은 `inputDelayTicks` 뒤에 적용되므로 그 사이에 판이 아직
    // 안 끝나 있고, `winner` 검사만으로는 두 번째 누름이 그대로 통과한다. `applyResign`
    // 이 끝난 판을 무시하므로 데싱크는 없지만, PVP에서는 그만큼 명령이 더 나간다.
    if (this.resigned || local === undefined || this.state.winner !== null) return;
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
      const { kinds } = plan.setup;
      this.state = createMatch(generateMap(seed), {
        // `canTempo` 도 서버가 내려준다. 각자 자기 계정을 읽으면 한쪽만 배속을 켤 수
        // 있다고 믿어 같은 명령을 다르게 처리한다 — 그 순간 갈라진다.
        1: { speedMul: 1, unitPower: unitPowerOf(kinds[1]), canTempo: plan.setup.tempo[1] },
        2: { speedMul: 1, unitPower: unitPowerOf(kinds[2]), canTempo: plan.setup.tempo[2] },
      });
      this.source = new NetSource(new Lockstep(plan.setup, plan.transport));
      // 상대가 끊기면 배치가 영영 안 온다. 그때 판을 끝낼 수 있는 유일한 길이다
      // (`net/types.ts` 의 `onClosed` 주석).
      this.unwatchRoom =
        plan.transport.onClosed?.((slot) => {
          this.serverVerdict = slot;
        }) ?? null;
      shownKinds = { 1: kinds[1], 2: kinds[2] };
    } else {
      // 봇도 사람의 강화 단계를 따라 세진다 (app/difficulty.ts). 안 그러면 강화를 살수록
      // 봇전이 쉬워지기만 한다.
      this.state = createMatch(generateMap(seed), this.getMods());
      this.source = BotSource.forPlayer(2);
      // **봇은 나보다 한 단계 아래를 입는다** (2026-08-03 사용자 지시).
      // 그리는 종류와 `botModsFor` 의 힘이 **반드시 같은 함수에서 나와야 한다** —
      // 어긋나면 화면이 거짓말을 한다. 둘 다 `stepDownKind` 를 탄다.
      const mine = this.getUnitKind();
      shownKinds = { [local]: mine, [other]: stepDownKind(mine) } as Record<PlayerId, UnitKind>;
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
    this.serverVerdict = null;
    this.stalledSince = 0;
    this.stallLogged = false;
    this.recoveredAt = 0;
    this.endedByDisconnect = false;
    audio.setBgm('match');
    audio.play('match-start');
    this.resignBtn.hidden = false;
    // 배속 버튼은 **살 수 있는 사람에게만** 보인다. 못 켜는 사람에게 죽은 버튼을
    // 보여 주면 눌러 보고 왜 안 되는지 묻게 된다.
    this.tempoBtn.hidden = !this.canTempo();
    this.paintTempo();
    this.hideResult();
  }

  /** 내 경로 수. 소리를 내는 데만 쓴다 — 열렸는지 닫혔는지는 이 값의 변화로 안다. */
  private myRoutes(): number {
    const local = this.input?.ui.local ?? 1;
    return this.state.routes.reduce((n, r) => n + (r.owner === local ? 1 : 0), 0);
  }

  /**
   * 이 틱에 난 일을 소리로 낸다. **읽기만 한다** — 렌더러와 같은 규칙이고,
   * 소리가 시뮬레이션에 흘러들면 서버 권위 PVP에서 결과가 갈라진다.
   *
   * 경로 개설·절단은 `TickEvents` 에 없다 (자동으로 닫힌 것만 `routesClosed` 로 온다).
   * **내 경로 수의 변화로 안다** — 명령이 적용되는 틱에 정확히 한 번 바뀐다.
   * 남의 경로는 안 센다: 상대가 그을 때마다 내 쪽에서 소리가 나면 무엇이 내 조작인지
   * 알 수가 없다.
   */
  private hear(ev: TickEvents, routesBefore: number): void {
    // 점령은 이 게임에서 가장 중요한 사건이다. 뺏긴 것도 들려야 한다.
    if (ev.captures.length > 0) audio.play('capture');
    if (ev.clashes.length > 0) audio.play('clash');

    // **경로를 여는 소리는 안 낸다** (사용자 결정). 판 하나에서 가장 자주 하는 조작이라
    // 소리가 붙으면 계속 울려 시끄럽고, 점령·충돌처럼 알아야 할 소리를 덮는다.
    // 자르는 것은 남긴다 — 빈도가 훨씬 낮고, 되돌릴 수 없는 조작이라 확인이 필요하다.
    const now = this.myRoutes();
    if (now < routesBefore) audio.play('route-cut');
  }

  /** 이 판에서 내가 배속을 켤 수 있는가. 판정은 `mods` 에 있고 서버가 정한다. */
  private canTempo(): boolean {
    const local = this.input?.ui.local ?? 1;
    return this.state.mods[local]?.canTempo === true;
  }

  /**
   * 배속 토글. **커맨드로 낸다** — 항복과 같은 이유다. 여기서 상태를 직접 바꾸면
   * 상대는 `inputDelayTicks` 뒤에야 알게 되어 그 사이 두 판이 다른 속도로 돈다.
   */
  private toggleTempo(): void {
    const local = this.input?.ui.local;
    if (local === undefined || this.state.winner !== null || !this.canTempo()) return;
    this.source.submit({ kind: 'setTempo', player: local, on: !this.state.tempo[local] });
  }

  /**
   * 버튼에 지금 배속을 적는다. **내가 켠 것만이 아니라 판 전체 값이다** —
   * 상대가 켜면 내가 안 켰어도 1.5배로 뜬다. 그게 실제로 도는 속도다.
   */
  private paintTempo(): void {
    const local = this.input?.ui.local ?? 1;
    const enemy: PlayerId = local === 1 ? 2 : 1;
    const scale = tempoScaleOf(this.state);
    const opponentOn = this.state.tempo[enemy] === true;
    this.tempoStatus.hidden = !opponentOn;
    this.tempoStatus.textContent = opponentOn ? t().opponentTempo(scale) : '';

    if (this.tempoBtn.hidden) return;
    this.tempoBtn.textContent = `${scale}×`;
    this.tempoBtn.classList.toggle('is-on', this.state.tempo[local] === true);
  }

  frame(dt: number): void {
    // **판을 멈추는 경로가 없다.** 설정 창이 있던 시절에는 봇전에서만 멈췄는데,
    // 그것이 곧 "상대가 봇이다"를 알려 주는 신호였다 (§-7은 안 알리기로 했다).
    //
    // **배속은 여기서만 걸린다.** 현실 시간을 배수만큼 부풀려 넣을 뿐이라 틱 하나가
    // 계산하는 것은 그대로다 — 그래서 양쪽이 같은 배속이면 결과가 안 갈라진다
    // (`tempoScaleOf` 주석). 상한(`MAX_ACCUMULATOR`)은 부풀린 뒤에 건다.
    this.accumulator = Math.min(this.accumulator + dt * tempoScaleOf(this.state), MAX_ACCUMULATOR);

    while (this.accumulator >= TICK_DT) {
      // 배치를 먼저 보낸다. 내가 멈춰 있어도 이건 계속 나가야 상대가 진행한다.
      this.source.pump?.(this.state.tick, this.state);

      const commands = this.source.commandsFor(this.state.tick, this.state);
      // null = 상대 입력이 아직 안 왔다. 시간을 누산기에 남겨 두고 다음 프레임에 다시 본다.
      if (commands === null) break;

      const before = this.myRoutes();
      const events = step(this.state, commands);
      this.renderer.ingest(this.state, events);
      this.hear(events, before);
      this.accumulator -= TICK_DT;
    }

    // 루프를 한 번도 못 돌았을 수 있다. 그래도 내 약속은 보내야 교착이 안 생긴다.
    this.source.pump?.(this.state.tick, this.state);
    // 배속은 상대가 켜도 바뀐다. 매 프레임 다시 적는다 — 눌린 순간이 아니라
    // 명령이 적용된 순간에 숫자가 바뀌어야 실제 속도와 맞는다.
    this.paintTempo();
    // **순서가 중요하다.** `watchStall` 이 `stalledSince` 를 갱신하고, 화면은 그 값으로
    // "얼마나 오래 기다렸나"를 판단한다. 뒤집으면 한 프레임씩 늦은 값을 그린다.
    this.watchStall(this.source.waiting);
    this.renderer.setWaiting(
      this.stalledSince !== 0 && Date.now() - this.stalledSince >= WAITING_HINT_MS,
    );

    const ui = this.input?.ui;
    if (ui) this.renderer.render(this.state, ui, this.accumulator / TICK_DT, dt);

    // 승부가 나도 씬은 유지한다. 여기서 화면을 바꾸면 마지막 점령 이펙트가 잘린다.
    if (this.state.winner !== null && !this.resultShown) this.showResult();
  }

  /**
   * 상대가 끊겨 영영 안 풀리는 정지에서 빠져나온다.
   *
   * 판이 도는 동안에는 아무것도 안 한다 — 여기 걸리는 것은 시뮬레이션이 **멈춰 있을
   * 때**뿐이다. 멈춘 판은 항복도 안 먹는다: 항복은 명령이라 `execTick` 까지 시뮬레이션이
   * 굴러야 적용되는데 그 틱이 안 온다. 그래서 탈출은 여기밖에 없다.
   */
  private watchStall(waiting: boolean): void {
    if (!waiting || this.state.winner !== null) {
      this.stalledSince = 0;
      this.stallLogged = false;
      this.recoveredAt = 0;
      return;
    }
    // 서버 판정이 있으면 그걸 쓴다. 승패를 정하는 것은 언제나 서버다.
    if (this.serverVerdict !== null) {
      this.finish(this.serverVerdict);
      return;
    }
    const now = Date.now();
    if (this.stalledSince === 0) {
      this.stalledSince = now;
      return;
    }
    const held = now - this.stalledSince;

    // **정지가 길어지면 원인을 콘솔에 남긴다.** 화면만 보면 "배치가 안 온다"와
    // "배치는 오는데 상대 약속이 굼뜨다"가 똑같이 멈춤으로 보이는데, 고칠 곳은 정반대다.
    // `received` 가 안 늘면 채널이 죽은 것이고, 느는데 `peerAck` 이 안 오르면 전송률이다.
    if (!this.stallLogged && held >= STALL_DIAGNOSE_MS) {
      this.stallLogged = true;
      console.warn('[net] 정지', { heldMs: held, tick: this.state.tick, ...this.source.stats?.() });
    }

    // **끊겼다 붙은 통로를 다시 세운다.** 판이 멈췄다는 것 말고는 단서가 없으므로
    // 여기가 알아채는 유일한 자리다 (`STALL_RECOVER_MS` 주석). 소켓이 아직 안 붙었으면
    // 실패하니 정지가 이어지는 동안 주기적으로 다시 부른다.
    const plan = this.getPlan();
    if (plan.mode === 'pvp' && held >= STALL_RECOVER_MS && now - this.recoveredAt >= RECOVER_RETRY_MS) {
      this.recoveredAt = now;
      console.warn('[net] 통로 복구 시도', { heldMs: held });
      plan.transport.recover?.();
    }

    if (held < STALL_GIVEUP_MS) return;
    // 서버 판정조차 못 받았다. **승패를 지어내지 않는다** — 상대가 끊긴 경우에도 여기까지
    // 오므로(2026-08-06 실기), 패배로 보고하면 이기고 있던 사람의 점수가 깎인다.
    // 판만 닫고 결과 화면은 "연결 끊김"으로 간다.
    this.endedByDisconnect = true;
    this.finish(0);
  }

  /**
   * 시뮬레이션 밖에서 판을 끝낸다.
   *
   * **평소에는 절대 이러면 안 된다** — 승패는 양쪽 시뮬레이션이 같은 틱에 같은 결론을
   * 내야 하고, 그래서 항복도 배속도 명령으로 낸다. 여기가 예외인 이유는 **갈라질 상대가
   * 이미 없기 때문**이다. 상대가 끊겨 명령이 영영 안 오는 상황에서만 불린다.
   */
  private finish(winner: Owner): void {
    if (this.state.winner !== null) return;
    this.state.winner = winner;
  }

  private teardown(): void {
    this.input?.dispose();
    this.input = null;
    this.source.dispose?.();
    this.unwatchRoom?.();
    this.unwatchRoom = null;
  }

  private showResult(): void {
    // 끝난 판에서 버튼이 남아 있으면 결과창 위에 떠서 [로비로]를 가린다.
    this.resignBtn.hidden = true;
    this.tempoBtn.hidden = true;
    this.tempoStatus.hidden = true;

    const local = this.input?.ui.local ?? 1;
    const w = this.state.winner;
    this.resultTitle.textContent = this.endedByDisconnect
      ? t().disconnected
      : this.resigned
        ? t().resigned
        : w === 0
          ? t().draw
          : w === local
            ? t().victory
            : t().defeat;

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

    // **화면에 뜬 글자와 같은 소리를 낸다.** 항복도 패배고, 무승부는 이긴 소리를
    // 내면 안 된다 — 소리가 화면보다 먼저 들리므로 어긋나면 그게 더 눈에 띈다.
    audio.play(!this.resigned && !this.endedByDisconnect && w !== 0 && w === local ? 'victory' : 'defeat');

    // **항복은 보상이 0이라 두 배도 없다.** 서버도 `paid` 가 없어 거절한다.
    // 광고가 안 붙어 있으면(`isAdReady`) 아예 안 보여 준다 — 눌러도 아무 일이 없는
    // 버튼은 고장으로 읽힌다.
    this.adDoubleBtn.hidden = this.resigned || this.endedByDisconnect || !isAdReady();
    this.adDoubleBtn.disabled = false;
    this.adDoubleBtn.textContent = t().adDouble;

    if (this.endedByDisconnect) {
      // **보고하지 않는다.** 승패를 모르는 판이라 무엇을 보고해도 거짓말이 된다.
      // 서버가 이 방을 자기 타임아웃으로 닫고 자기 판정대로 점수를 매긴다.
      this.resultReward.textContent = t().disconnectedNote;
    } else if (this.resigned) {
      this.resultReward.textContent = t().resignNoReward;
    } else {
      const reward = rewardFor(this.state, local);
      const shown = ++this.resultRound;
      void this.grantReward(reward, w ?? 0).then((change) => {
        // 늦게 온 응답이 다음 판의 결과 화면을 덮어쓰지 않게 한다.
        if (shown === this.resultRound) this.showRating(change);
      });
      this.resultReward.textContent =
        t().rewardLine(reward.total, reward.base, reward.towers, reward.towerBonus);
    }

    // **PVP에서도 보인다.** 전에는 "같은 상대와 같은 시드로 다시 시작할 수 없다"는
    // 이유로 숨겼는데, 이 버튼이 이제 판을 다시 도는 게 아니라 **매칭을 다시 잡는다** —
    // 그 이유가 사라졌다 (2026-08-04). 봇전·PVP가 같은 결과 화면을 쓴다.

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
    this.resultRating.textContent = t().ratingLine(change.before, change.after, sign, diff);
    this.resultRating.classList.toggle('rating-up', diff > 0);
    this.resultRating.classList.toggle('rating-down', diff < 0);
    this.resultRating.hidden = false;
  }

  private hideResult(): void {
    this.resultRoot.hidden = true;
    this.resultShown = false;
  }
}
