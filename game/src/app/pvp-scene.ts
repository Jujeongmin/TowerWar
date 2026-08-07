/**
 * 대전 매칭 화면.
 *
 * 이 씬은 **아무것도 결정하지 않는다.** 시드도 플레이어 번호도 시작 시점도,
 * 상대를 봇으로 대체할지도, 방 코드까지 전부 서버가 정한다 (`server.js`).
 * 여기서 하는 일은 방에 들어가고, 방 상태를 지켜보고, 판이 열리면 넘기는 것뿐이다.
 *
 * ── 길이 셋이고 실패 처리가 다르다 ────────────────────────────
 *
 * | 길 | 실패하면 |
 * |---|---|
 * | 무작위 매칭 (들어오자마자) | **조용히 봇전.** 화면에 안 드러낸다 |
 * | [방 만들기] | 화면에 오류. 친구를 부르려던 것이라 침묵하면 안 된다 |
 * | 코드로 [참가] | 화면에 오류. 그 사람은 *그 방*에 가려던 것이다 |
 *
 * ── 자동 매칭의 AI 대체 안내 ─────────────────────────────────
 *
 * 무작위 매칭에서 상대를 못 찾으면 서버가 12초 뒤 봇전으로 확정한다. 사용자가 대기
 * 조건을 미리 알 수 있도록 검색 중에만 이 내용을 안내한다.
 *
 * 코드 방은 봇 폴백을 안 받는다. 친구를 기다리는 중에 판이 시작되면 코드를 준 의미가 없다.
 */
import { Agent8Client, type RoomSnapshot } from '../net/agent8';
import { t } from '../i18n';
import type { MatchSetup, MatchTransport } from '../net/types';
import type { TowerKind } from '../towers';
import type { Scene } from './scene';

/**
 * 이 화면에 들어온 길.
 *
 * `auto` 는 들어오자마자 무작위 매칭을 돌리고 실패를 봇전으로 삼킨다.
 * `friend` 는 아무것도 자동으로 하지 않고, 실패를 전부 화면에 띄운다 —
 * 그 사람은 *그 방*에 가려던 것이라 조용히 봇으로 넘기면 왜 친구가 없는지 알 수 없다.
 */
export type PvpMode = 'auto' | 'friend';

type Phase = 'idle' | 'searching' | 'creating' | 'hosting' | 'joining' | 'starting' | 'error';

/**
 * **함수여야 한다.** 전에는 모듈 최상단 상수였는데, 그러면 `t()` 가 **앱이 처음
 * 로드될 때 한 번만** 평가된다 — 언어를 바꿔도 이 표는 영어인 채로 남았다.
 * 증상은 "한글로 설정했는데 매칭 화면만 영어"였다.
 *
 * 같은 함정이 이 저장소에 또 있으면 안 된다: **`t()` 를 모듈 최상단에서 부르지 말 것.**
 * 쓰는 순간에 읽어야 언어 전환을 따라간다.
 */
function statusText(phase: Phase): string {
  const s = t();
  return {
    idle: s.makeRoomOrCode,
    searching: s.searching,
    creating: s.creatingRoom,
    hosting: s.waitingFriend,
    joining: s.joiningRoom,
    starting: s.startingSoon,
    error: s.couldNotJoin,
  }[phase];
}

function titleText(mode: PvpMode): string {
  return mode === 'auto' ? t().pvpTitleAuto : t().pvpTitleFriend;
}

/**
 * 매칭을 다시 훑는 간격(ms).
 *
 * 대역이 넓어지는 시점(`ratingBandFor`: 4초·8초·10초)을 놓치지 않을 만큼 촘촘하되,
 * 서버 호출이 초당 10회로 제한된 것을 감안해 넉넉히 잡았다.
 *
 * 2초에서 **1.5초로 줄였다** (2026-08-06 사용자 지시). 봇 폴백이 12초라 2초 간격이면
 * 실질 탐색이 5회뿐이었다. 1.5초면 8회로 늘고, 특히 대역이 무제한으로 열리는
 * 10초 이후에 훑을 기회가 1번에서 2번이 된다 — 사람과 붙을 마지막 구간이라 여기가 값지다.
 * 초당 0.67회라 remote function 한도(10회/초)와는 거리가 멀다.
 */
const REMATCH_INTERVAL_MS = 1500;

/** 경과 시간을 `0:07` 로. 분이 넘어가도 자리가 안 흔들리게 초를 두 자리로 채운다. */
function formatElapsed(sec: number): string {
  const t = Math.max(0, Math.floor(sec));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}

export class PvpScene implements Scene {
  private readonly title: HTMLElement;
  private readonly status: HTMLElement;
  private readonly detail: HTMLElement;
  private readonly timer: HTMLElement;
  private readonly codeShown: HTMLElement;
  private readonly codeInput: HTMLInputElement;
  private readonly joinBtn: HTMLButtonElement;
  private readonly hostBtn: HTMLButtonElement;
  private readonly friendBox: HTMLElement;
  /** 어느 버튼으로 들어왔는가. `enter` 전에 `setMode` 로 정해진다. */
  private mode: PvpMode = 'auto';

  private unsubscribe: (() => void) | null = null;
  /** 이 씬을 떠났는데 늦게 도착한 콜백이 화면을 되돌리지 않게 막는다. */
  private active = false;
  /** 매치로 넘어갔는가. 넘어갔으면 exit에서 방을 나가면 안 된다. */
  private handedOff = false;
  /**
   * 지금 살아 있는 시도의 번호.
   *
   * 무작위 매칭이 도는 중에 [방 만들기]나 [참가]를 누를 수 있다. 앞의 시도가 8초 뒤에
   * 실패해서 돌아오면, 그때 화면은 이미 다른 길에 가 있다 — 그 늦은 실패가 봇전을
   * 시작해 버리면 사용자가 누른 것과 다른 일이 벌어진다. 번호가 다르면 조용히 버린다.
   */
  private attempt = 0;
  /** 방 상태 구독을 건 시도의 번호. 늦게 온 방 상태도 같은 이유로 걸러야 한다. */
  private roomAttempt = 0;
  /**
   * 상대를 찾기 시작한 시각(`Date.now`). 도는 중이 아니면 null.
   *
   * **벽시계다. rAF 의 dt 를 누산하면 안 된다.** 탭이 뒤로 가면 rAF 가 통째로 멈추는데
   * (실측: 숨긴 탭에서 1.8초 동안 0프레임) 서버의 대기 시간은 계속 흐른다. dt 를 쌓으면
   * 돌아왔을 때 화면의 숫자가 서버가 센 시간보다 한참 적어 거짓말이 된다.
   *
   * 12초가 되면 서버에 AI 전환을 요청하는 기준으로도 쓴다. 실제 전환 여부는 서버가
   * 방 인원과 서버 시각을 다시 검사해 결정하므로 클라이언트가 판정을 소유하지 않는다.
   */
  private searchStart: number | null = null;
  /** 마지막으로 화면에 쓴 문자열. 같은 값을 매 프레임 다시 쓰지 않으려고 들고 있다. */
  private timerShown = '';
  /** AI 전환 요청을 프레임마다 보내지 않도록 다음 재시도 가능 시각을 둔다. */
  private nextFallbackAttemptAt = 0;
  /** 다음 매칭 재훑기 시각. `frame` 이 이 시각을 넘으면 한 번 돈다. */
  private nextRematchAt = 0;
  private rematchInFlight = false;
  /** 느린 요청 위에 다음 요청이 겹치지 않게 한다. */
  private fallbackRequestInFlight = false;

  constructor(
    private readonly root: HTMLElement,
    private readonly startPvp: (setup: MatchSetup, transport: MatchTransport) => void,
    /**
     * 상대를 못 구했을 때. 무작위 매칭에서는 화면상 PVP와 구분되지 않는다.
     * `seed` 가 있으면 서버가 연 방(봇 확정)이고, 없으면 서버에 아예 못 붙은 것이다 —
     * 보상을 서버에 보고할지 로컬에 넣을지가 그 차이로 갈린다.
     */
    private readonly startBot: (seed?: number, towerKind?: TowerKind) => void,
    private readonly toLobby: () => void,
    /**
     * 앱이 들고 있는 접속 하나를 그대로 쓴다. 씬이 따로 만들면 계정용과 매칭용
     * 접속이 둘이 되어, 서버가 보는 계정과 화면이 보는 계정이 갈릴 수 있다.
     */
    private readonly client: Agent8Client,
  ) {
    const title = root.querySelector<HTMLElement>('#pvp-title');
    const status = root.querySelector<HTMLElement>('#pvp-status');
    const detail = root.querySelector<HTMLElement>('#pvp-detail');
    const timer = root.querySelector<HTMLElement>('#pvp-timer');
    const codeShown = root.querySelector<HTMLElement>('#pvp-code');
    const codeInput = root.querySelector<HTMLInputElement>('#pvp-code-input');
    const joinBtn = root.querySelector<HTMLButtonElement>('#btn-pvp-join');
    const hostBtn = root.querySelector<HTMLButtonElement>('#btn-pvp-host');
    const friendBox = root.querySelector<HTMLElement>('#pvp-friend');
    const cancel = root.querySelector<HTMLButtonElement>('#btn-pvp-cancel');
    if (!title || !status || !detail || !timer || !codeShown || !codeInput || !joinBtn || !hostBtn || !friendBox || !cancel) {
      throw new Error('대전 화면 DOM이 예상과 다릅니다');
    }
    this.title = title;
    this.friendBox = friendBox;
    this.status = status;
    this.detail = detail;
    this.timer = timer;
    this.codeShown = codeShown;
    this.codeInput = codeInput;
    this.joinBtn = joinBtn;
    this.hostBtn = hostBtn;

    cancel.addEventListener('click', () => this.toLobby());
    hostBtn.addEventListener('click', () => void this.host());
    joinBtn.addEventListener('click', () => void this.join());
    // 코드는 짧아서 엔터로 넣는 게 자연스럽다.
    codeInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') void this.join();
    });
  }

  /** `switchTo` 전에 부른다. `Scene.enter` 가 인자를 못 받아서 상태로 넘긴다. */
  setMode(mode: PvpMode): void {
    this.mode = mode;
  }

  enter(): void {
    this.active = true;
    this.handedOff = false;
    this.codeInput.value = '';
    this.codeShown.hidden = true;
    this.title.textContent = titleText(this.mode);
    this.friendBox.hidden = this.mode !== 'friend';
    this.root.hidden = false;

    // 친구랑 하기는 아무것도 자동으로 하지 않는다 — 방을 만들지 코드로 들어갈지는
    // 사람이 고를 일이다. 자동 매칭만 들어오자마자 상대를 찾는다.
    if (this.mode === 'auto') void this.search();
    else this.show('idle');
  }

  exit(): void {
    this.active = false;
    // `show` 를 안 거치고 나가는 길도 있다. 여기서 확실히 멈춘다.
    this.searchStart = null;
    this.unsubscribe?.();
    this.unsubscribe = null;
    // 매치로 넘어간 것이 아니라 취소한 것이면 방을 비워 줘야 한다.
    // 안 그러면 빈 방이 매칭 후보로 남아 다음 사람이 유령과 짝지어진다.
    if (!this.handedOff && this.client.inRoom) void this.client.leaveMatch().catch(() => {});
    this.root.hidden = true;
  }

  frame(): void {
    if (this.searchStart === null) return;
    const now = Date.now();
    const elapsed = (now - this.searchStart) / 1000;
    const text = formatElapsed(elapsed);
    if (text !== this.timerShown) {
      this.timerShown = text;
      this.timer.textContent = text;
    }

    // **매칭을 주기적으로 다시 훑는다.** 대역이 기다린 시간에 따라 넓어지는데
    // (`ratingBandFor`) 첫 호출 한 번으로는 그 확장을 못 받는다 — 두 사람이 동시에
    // 대기 중인데도 서로를 지나쳐 둘 다 봇으로 떨어지는 일이 있었다.
    // 자동 매칭에서만, 아직 넘기기 전에만 돈다.
    if (
      this.mode === 'auto' &&
      !this.handedOff &&
      this.client.inRoom &&
      !this.rematchInFlight &&
      now >= this.nextRematchAt
    ) {
      this.nextRematchAt = now + REMATCH_INTERVAL_MS;
      void this.retryFindMatch(now - this.searchStart);
    }

    // 4초에 미리 호출하면 서버가 구버전이라 RPC 자체가 응답하지 않는 경우에도
    // 8초 타임아웃이 정확히 12초 무렵 끝난다. 정상 서버는 아직 이르므로 null을 즉시
    // 돌려주고, 아래 메서드가 12초 시점으로 다음 요청을 예약한다.
    if (elapsed >= 4 && this.client.inRoom && !this.fallbackRequestInFlight && now >= this.nextFallbackAttemptAt) {
      this.nextFallbackAttemptAt = now + 1000;
      void this.requestSoloFallback();
    }

    // 12초 요청 자체가 멈추는 경우에도 추가 8초를 기다리지 않는다.
    if (elapsed >= 12.5 && !this.handedOff) this.startLocalFallback();
  }

  /**
   * 대기 중에 더 나은 후보를 다시 훑는다. 못 찾으면 아무 일도 안 일어난다.
   *
   * 찾았으면 **다른 방으로 옮겨진 것**이라 구독을 다시 건다 — 안 그러면 옛 방의
   * 상태만 듣고 있어 판이 시작돼도 모른다. `attempt` 번호를 올려 이전 구독이
   * 늦게 뱉는 이벤트도 걸러 낸다 (`enterRoom` 과 같은 규칙).
   */
  private async retryFindMatch(waitedMs: number): Promise<void> {
    this.rematchInFlight = true;
    try {
      const before = this.client.currentRoomId;
      const found = await this.client.retryFindMatch(waitedMs);
      // 그 사이 취소했거나 판이 잡혔으면 버린다.
      if (!this.active || this.searchStart === null || this.handedOff) return;
      if (!found || found === before) return;

      const mine = ++this.attempt;
      this.roomAttempt = mine;
      this.unsubscribe?.();
      this.unsubscribe = null;
      await this.client.setReady(true);
      if (!this.active || this.attempt !== mine) return;
      this.unsubscribe = this.client.onRoom((state) => {
        if (this.roomAttempt === mine) this.onRoom(state, true);
      });
    } catch (e) {
      // 재시도는 부가 기능이다. 실패해도 원래 대기와 봇 폴백은 그대로 굴러간다.
      console.warn('[net] 매칭 재시도 실패:', e);
    } finally {
      this.rematchInFlight = false;
    }
  }

  private startLocalFallback(): void {
    if (!this.active || this.searchStart === null || this.handedOff) return;
    void this.client.leaveMatch().catch(() => {});
    this.handOff(() => this.startBot());
  }

  /** 서버가 승인한 시드를 받으면 방 상태 구독을 기다리지 않고 즉시 AI전을 시작한다. */
  private async requestSoloFallback(): Promise<void> {
    this.fallbackRequestInFlight = true;
    try {
      const seed = await this.client.requestSoloFallback();
      if (seed !== null && this.active && this.searchStart !== null && !this.handedOff) {
        this.handOff(() => this.startBot(seed));
      } else if (this.searchStart !== null) {
        // 정상 서버의 조기 거절(null)이면 정확히 12초에 다시 요청한다.
        this.nextFallbackAttemptAt = this.searchStart + 12000;
      }
    } catch (e) {
      console.warn('[net] AI 상대 전환 요청 실패:', e);
      // 서버 코드가 아직 배포되지 않았거나 장애가 있어도 사용자를 매칭 화면에 가두지 않는다.
      // 서버 방은 비우기를 시도하고, 보상 위조를 피하기 위해 이 판은 로컬 AI전으로 연다.
      if (
        this.active &&
        this.searchStart !== null &&
        Date.now() - this.searchStart >= 12000 &&
        !this.handedOff
      ) {
        this.startLocalFallback();
      }
    } finally {
      this.fallbackRequestInFlight = false;
    }
  }

  // ── 길 셋 ──────────────────────────────────────────────────────

  /** 자동 매칭. 실패는 침묵하고 봇으로 간다. */
  private async search(): Promise<void> {
    this.codeShown.hidden = true;
    await this.enterRoom('searching', true, (c) => c.findMatch());
  }

  /** 친구를 부를 방을 판다. 코드가 나오면 크게 띄운다. */
  private async host(): Promise<void> {
    this.codeShown.hidden = true;
    const mine = this.attempt + 1;
    await this.enterRoom('creating', false, async (c) => {
      const { code } = await c.createRoom();
      if (this.attempt !== mine) return;
      this.showRoomCode(code);
      this.show('hosting');
    });
  }

  /** 코드로 친구 방에 들어간다. */
  private async join(): Promise<void> {
    const code = this.codeInput.value.trim();
    if (!code) return;
    this.codeShown.hidden = true;
    await this.enterRoom('joining', false, (c) => c.joinRoomByCode(code));
  }

  /**
   * 셋의 공통 부분: 이전 구독을 끊고, 방에 들어가고, 준비를 알리고, 방 상태를 구독한다.
   *
   * `silentFallback` 이 켜져 있을 때만 실패를 봇전으로 삼킨다.
   */
  private async enterRoom(
    phase: Phase,
    silentFallback: boolean,
    go: (c: Agent8Client) => Promise<unknown>,
  ): Promise<void> {
    const mine = ++this.attempt;
    const alive = () => this.active && this.attempt === mine;

    this.unsubscribe?.();
    this.unsubscribe = null;
    // 누른 즉시 화면을 바꾼다. 아래 await 뒤로 미루면 서버가 굼뜰 때
    // 버튼을 눌러도 아무 반응이 없는 것처럼 보인다.
    this.show(phase);
    // 이전 방에 발을 걸친 채 다른 방에 들어가면 양쪽에 유령이 남는다.
    // 방에 없으면 부르지 않는다 — 서버가 죽었을 때 이 호출만으로 8초를 버린다.
    if (this.client.inRoom) await this.client.leaveMatch().catch(() => {});
    if (!alive()) return;

    try {
      const connected = await this.client.connect();
      if (!alive()) return;
      if (!connected) throw new Error(t().connectionRefused);

      await go(this.client);
      if (!alive()) return;

      // 강화 단계는 안 보낸다 — 서버가 자기 계정에서 읽는다 (server.js setReady).
      await this.client.setReady(true);
      if (!alive()) return;

      this.roomAttempt = mine;
      this.unsubscribe = this.client.onRoom((state) => {
        if (this.roomAttempt === mine) this.onRoom(state, silentFallback);
      });
    } catch (e) {
      if (!alive()) return;
      const reason = String((e as Error)?.message ?? e);
      if (!silentFallback) {
        this.show('error', reason);
        return;
      }
      // 배포 전이라면 대개 VITE_AGENT8_VERSE가 없어서 여기로 온다.
      // 화면에는 안 드러낸다 — 판별은 이 경고로만 된다.
      console.warn('[net] 매칭 실패, 봇전으로 대체합니다:', reason);
      this.handOff(() => this.startBot());
    }
  }

  private onRoom(state: RoomSnapshot, silentFallback: boolean): void {
    if (!this.active || !this.client) return;

    // The server persists the invite code in room state. Recovering it here
    // covers delayed RPC responses and keeps the code visible after updates.
    if (this.mode === 'friend' && typeof state.code === 'string') {
      this.showRoomCode(state.code);
    }

    if (state.phase === 'finished') {
      if (!silentFallback) {
        this.show('error', t().roomClosed(state.reason ?? '종료'));
        return;
      }
      console.warn('[net] 방이 닫혔습니다, 봇전으로 대체합니다:', state.reason);
      this.handOff(() => this.startBot());
      return;
    }

    const soloSeed = this.client.soloSeedFrom(state);
    if (soloSeed !== null) {
      const towerKind = this.client.soloTowerFrom(state);
      this.handOff(() => this.startBot(soloSeed, towerKind));
      return;
    }

    const setup = this.client.setupFrom(state);
    if (!setup) return; // 아직 대기 중. 화면은 그대로 둔다.

    const transport = this.client.transport();
    this.handOff(() => this.startPvp(setup, transport));
  }

  private showRoomCode(rawCode: string): void {
    const code = rawCode.trim().toUpperCase();
    if (!code) return;
    this.codeShown.textContent = code;
    this.codeShown.hidden = false;
  }

  /** 판을 넘기고 이 씬의 일을 끝낸다. 무작위 매칭이면 넘기는 이유를 화면에 남기지 않는다. */
  private handOff(go: () => void): void {
    this.show('starting');
    this.codeShown.hidden = true;
    this.handedOff = true;
    this.unsubscribe?.();
    this.unsubscribe = null;
    go();
  }

  private show(phase: Phase, detail = ''): void {
    // 시간은 **자동 매칭에서 상대를 찾는 동안만** 흐른다.
    // 친구 방에서 기다리는 것은 서버가 재는 대기가 아니라 사람을 기다리는 것이고,
    // 판이 잡히거나(`starting`) 실패하면(`error`) 더 셀 것이 없다.
    // 화면 전환이 전부 이 함수를 거치므로 시작·정지를 여기 한 곳에 둔다.
    const counting = this.mode === 'auto' && phase === 'searching';
    this.searchStart = counting ? Date.now() : null;
    this.nextFallbackAttemptAt = counting ? Date.now() + 4000 : 0;
    // 첫 재훑기는 한 주기 뒤부터. 방금 `findMatch` 를 돌린 직후라 곧바로 또 부를 이유가 없다.
    this.nextRematchAt = counting ? Date.now() + REMATCH_INTERVAL_MS : 0;
    this.rematchInFlight = false;
    this.fallbackRequestInFlight = false;
    this.timer.hidden = !counting;
    this.timerShown = counting ? formatElapsed(0) : '';
    this.timer.textContent = this.timerShown;

    this.status.textContent = statusText(phase);
    // 안내문은 오류가 아니다. 크게 띄우면 뭔가 잘못된 것처럼 보인다.
    this.status.classList.toggle('is-hint', phase === 'idle');
    this.status.classList.toggle('is-error', phase === 'error');
    this.detail.textContent = detail || (counting ? t().matchingFallbackHint : '');
    // 판이 잡힌 뒤에 다른 방으로 뛰어들면 방 두 개에 걸친다.
    const busy = phase === 'starting';
    this.joinBtn.disabled = busy;
    this.hostBtn.disabled = busy;
  }
}
