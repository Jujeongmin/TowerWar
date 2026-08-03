/**
 * Verse8(Agent8) 실물 트랜스포트.
 *
 * **React 없이 붙는다.** `@agent8/gameserver` 는 `GameServer` 클래스를 루트에서 export 하고,
 * `react` 는 훅에만 필요한 peerDependency다. 문서의 시작하기 예제가 `useGameServer` 훅
 * 기준이라 React가 필수처럼 보이지만 아니다 (HANDOFF §-5에 확인 기록).
 *
 * 서버 쪽 짝은 저장소 루트의 `server.js` 다. 함수 이름과 메시지 타입이 양쪽에 하드코딩되므로
 * 여기 상수와 `server.js` 의 상수가 어긋나면 조용히 아무 일도 안 일어난다.
 */
import { GameServer } from '@agent8/gameserver';
import { DEFAULT_RATING } from '../account/account';
import { DEFAULT_PROFILE, isProfileId, type ProfileId } from '../profiles';
import type { PlayerId } from '../sim/types';
import { DEFAULT_UNIT_KIND, isUnitKind, type UnitKind } from '../units';
import type { InputBatch, MatchSetup, MatchTransport } from './types';

/** `server.js` 의 `MSG_INPUTS` 와 같아야 한다. */
const MSG_INPUTS = 'tw.inputs';

/** 서버가 모르는 아바타 id를 내려줘도 화면이 비지 않게 기본값으로 떨어뜨린다. */
function toProfile(v: unknown): ProfileId {
  return isProfileId(v) ? v : DEFAULT_PROFILE;
}

/**
 * 서버가 모르는 유닛 종류를 내려줘도 판이 시작되게 기본값으로 떨어뜨린다.
 *
 * **여기서 던지면 안 된다.** 종류가 힘을 정하게 된 뒤로 이 값이 규칙이 되었지만,
 * 배포 시점이 어긋난 클라이언트가 새 종류를 들고 들어오는 경우가 실제로 있다.
 * 그때 판을 못 열게 하는 것보다 양쪽이 **똑같이** 기본값으로 보는 편이 낫다 —
 * 어차피 두 클라이언트가 같은 문자열을 받으므로 갈라지지 않는다.
 */
function toKind(v: unknown): UnitKind {
  return isUnitKind(v) ? v : DEFAULT_UNIT_KIND;
}

/** 서버가 방 상태에 실어 주지 않았을 때의 기본값. `server.js` 상수와 맞춰 둔다. */
const DEFAULT_INPUT_DELAY_TICKS = 12;
const DEFAULT_DESYNC_CHECK_TICKS = 30;

export interface RoomSnapshot {
  /** 서버가 방 상태에 항상 넣어 주는 값. 방 코드로 그대로 보여 준다. */
  roomId?: string;
  phase?: 'waiting' | 'playing' | 'finished';
  /**
   * 상대를 못 찾아 봇전으로 확정된 방.
   *
   * **화면에는 드러내지 않는다** (사용자 결정). 클라이언트는 이 값을 보고 봇을 돌리기만 하고,
   * 매칭 화면도 결과 화면도 PVP와 똑같이 보인다.
   */
  solo?: boolean;
  seed?: number;
  slots?: Record<string, PlayerId>;
  /** 슬롯 번호 → 상점 공속 강화 단계. 서버가 잘라서 내려준다. */
  levels?: Record<number, number>;
  /** 슬롯 번호 → 유닛 종류. 힘을 정하는 값이라 서버 계정에서 읽어 내려준다. */
  kinds?: Record<number, string>;
  /** 슬롯 번호 → 닉네임. 서버가 자기 계정에서 읽어 내려준다. */
  names?: Record<number, string>;
  /** 슬롯 번호 → 프로필 아바타 id. 이것도 서버 계정에서 읽는다. */
  profiles?: Record<number, string>;
  /** 슬롯 번호 → 판 시작 시점의 PVP 점수. 판이 끝난 뒤 Elo 계산의 기준값이다 (§-27). */
  ratings?: Record<number, number>;
  /** 슬롯 번호 → 배속을 켤 수 있는가 (유료). 서버가 계정에서 읽어 내려준다. */
  tempo?: Record<number, boolean>;
  inputDelayTicks?: number;
  desyncCheckTicks?: number;
  winner?: string | null;
  winnerSlot?: number;
  desync?: { tick: number } | null;
  reason?: string;
  $users?: string[];
  /** Friend-room invite code. Kept in room state so the host can recover it. */
  code?: string;
  private?: boolean;
}

/**
 * 접속과 매칭. 판이 시작되면 `MatchSetup` 과 트랜스포트를 내놓는다.
 *
 * `.env` 의 `VITE_AGENT8_VERSE` 가 있어야 접속이 시작된다. 그 값은
 * `npm run deploy:server` 가 만든다 — 배포 전에는 여기서 더 나아가지 못한다.
 */
/**
 * 서버 호출이 이 시간(ms) 안에 안 끝나면 실패로 본다.
 *
 * **`connect()` 는 실패해도 거부하지 않고 그냥 안 끝난다.** `.env` 에
 * `VITE_AGENT8_VERSE` 가 없으면 콘솔에 경고만 찍고 영원히 대기 상태가 된다 —
 * 타임아웃이 없으면 매칭 화면이 "연결하는 중"에 갇혀 원인을 알 수 없다.
 */
const CALL_TIMEOUT_MS = 8000;
/** Creating a private room also acquires a distributed lock and persists its code. */
const ROOM_CALL_TIMEOUT_MS = 20000;

function withTimeout<T>(p: Promise<T>, what: string, timeoutMs = CALL_TIMEOUT_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${what} 응답이 없습니다 (${Math.round(timeoutMs / 1000)}초)`)),
      timeoutMs,
    );
    void p.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

/** `Agent8Client` 가 실제로 쓰는 서버 표면. 개발용 로컬 백엔드를 끼우려고 뽑아 뒀다. */
export interface ServerBackend {
  account: string;
  connected?: boolean;
  connect(): Promise<boolean>;
  remoteFunction(fn: string, args?: unknown[], opts?: unknown): Promise<any>;
  subscribeRoomState(roomId: string, cb: (state: any) => void): () => void;
  onRoomMessage(roomId: string, type: string, cb: (message: any) => void): () => void;
}

export class Agent8Client {
  private server: ServerBackend = GameServer.getInstance();
  private roomId: string | null = null;

  /**
   * 서버 표면을 갈아 끼운다. **개발 빌드에서만 쓴다** —
   * 배포 전에는 Verse8에 붙을 수 없어서 방 코드도 친구랑 하기도 시험할 수가 없다.
   * `net/local-backend.ts` 가 진짜 `server.js` 를 로컬에서 돌려 그 자리를 메운다.
   */
  useBackend(backend: ServerBackend): void {
    this.server = backend;
    this.roomId = null;
  }

  async connect(): Promise<boolean> {
    // Verse8 keeps one live GameServer connection. Calling connect() again
    // closes that socket before opening another one, so reuse the connection
    // established during account boot instead of racing a reconnect here.
    if (this.server.connected) return true;
    return await withTimeout(this.server.connect(), '서버 연결');
  }

  get account(): string {
    return this.server.account;
  }

  /**
   * 지금 방에 들어가 있는가.
   *
   * 방에 없을 때 `leaveMatch` 를 부르지 않기 위한 것이다. 서버가 죽어 있으면 그 호출이
   * 8초 타임아웃을 다 먹고, 그 뒤에 `connect` 가 또 8초를 먹어서 오류가 16초 뒤에 뜬다.
   */
  get inRoom(): boolean {
    return this.roomId !== null;
  }

  /** 무작위 매칭. 빈 방을 찾거나 새로 판다. 서버가 `roomId` 를 정한다. */
  async findMatch(): Promise<string> {
    const res = await withTimeout(this.server.remoteFunction('findMatch', []), '매칭');
    this.roomId = res.roomId;
    return res.roomId;
  }

  /** 친구를 부를 방을 판다. 코드는 서버가 발급한다 (락 안에서). */
  async createRoom(): Promise<{ roomId: string; code: string }> {
    const res = await withTimeout(
      this.server.remoteFunction('createRoom', []),
      '방 만들기',
      ROOM_CALL_TIMEOUT_MS,
    );
    if (typeof res?.roomId !== 'string' || typeof res?.code !== 'string' || !res.code.trim()) {
      throw new Error('서버가 방 코드를 보내지 않았습니다. 다시 시도해 주세요.');
    }
    this.roomId = res.roomId;
    return { roomId: res.roomId, code: res.code.trim().toUpperCase() };
  }

  /** 코드로 친구 방에 들어간다. 실패는 그대로 던진다 — 이유가 화면에 보여야 한다. */
  async joinRoomByCode(code: string): Promise<string> {
    const res = await withTimeout(
      this.server.remoteFunction('joinRoomByCode', [code]),
      '방 참가',
    );
    this.roomId = res.roomId;
    return res.roomId;
  }

  /**
   * 준비 알림. **강화 단계는 안 보낸다** — 서버가 자기 계정에서 읽는다.
   * 클라이언트가 보낸 숫자를 쓰면 만렙을 자칭할 수 있다 (server.js `setReady`).
   */
  async setReady(ready: boolean): Promise<void> {
    await withTimeout(this.server.remoteFunction('setReady', [ready]), '준비');
  }

  /** 12초 대기 뒤 서버에 AI 전환을 요청한다. 서버가 실제 대기시간과 방 인원을 재검증한다. */
  async requestSoloFallback(): Promise<number | null> {
    const seed = await withTimeout(
      this.server.remoteFunction('requestSoloFallback', []),
      'AI 상대 연결',
    );
    return Number.isInteger(seed) && seed >= 0 && seed < 0x10000 ? seed : null;
  }

  async leaveMatch(): Promise<void> {
    // 여기에도 타임아웃이 필요하다. 서버가 없으면 이 호출이 안 끝나서,
    // 방을 옮기려고 이걸 먼저 기다리는 화면이 통째로 멈춘다.
    try {
      await withTimeout(this.server.remoteFunction('leaveMatch', []), '방 나가기');
    } finally {
      this.roomId = null;
    }
  }

  /** 방 상태 구독. `phase` 가 `playing` 이 되는 순간이 판 시작 신호다. */
  onRoom(handler: (state: RoomSnapshot) => void): () => void {
    if (!this.roomId) throw new Error('방에 들어가기 전입니다');
    return this.server.subscribeRoomState(this.roomId, handler);
  }

  /**
   * 방 상태에서 이 판의 조건을 뽑는다. 슬롯에 내 계정이 없으면 아직 시작 전이다.
   *
   * **시드도 플레이어 번호도 서버가 정한 값을 그대로 쓴다.** 클라이언트가 정하면
   * 둘이 다른 맵을 만들거나 둘 다 P1이 된다.
   */
  setupFrom(state: RoomSnapshot): MatchSetup | null {
    if (state.phase !== 'playing' || state.solo) return null;
    const local = state.slots?.[this.account];
    if (!local || typeof state.seed !== 'number') return null;
    return {
      seed: state.seed,
      local,
      // 서버가 안 내려줬으면 양쪽 다 0단계로 본다. 한쪽만 기본값으로 떨어지면 갈라진다.
      levels: { 1: state.levels?.[1] ?? 0, 2: state.levels?.[2] ?? 0 },
      kinds: { 1: toKind(state.kinds?.[1]), 2: toKind(state.kinds?.[2]) },
      names: { 1: state.names?.[1] ?? '', 2: state.names?.[2] ?? '' },
      profiles: {
        1: toProfile(state.profiles?.[1]),
        2: toProfile(state.profiles?.[2]),
      },
      // 서버가 안 내려줬으면 양쪽 다 기본 점수로 본다. 한쪽만 떨어지면 화면에서
      // 실력 차가 있는 것처럼 보인다.
      ratings: { 1: state.ratings?.[1] ?? DEFAULT_RATING, 2: state.ratings?.[2] ?? DEFAULT_RATING },
      // 안 내려줬으면 양쪽 다 못 켜는 것으로 본다. 한쪽만 기본값이 달라지면 갈라진다.
      tempo: { 1: state.tempo?.[1] === true, 2: state.tempo?.[2] === true },
      inputDelayTicks: state.inputDelayTicks ?? DEFAULT_INPUT_DELAY_TICKS,
      desyncCheckTicks: state.desyncCheckTicks ?? DEFAULT_DESYNC_CHECK_TICKS,
    };
  }

  /** 봇전으로 확정된 방인가. 맞으면 쓸 시드를 돌려준다. */
  soloSeedFrom(state: RoomSnapshot): number | null {
    if (state.phase !== 'playing' || !state.solo) return null;
    return typeof state.seed === 'number' ? state.seed : null;
  }

  /** 봇전 방에서 서버가 내려준 내 이름. 상대(봇) 이름은 서버가 주지 않는다. */
  soloNameFrom(state: RoomSnapshot): string {
    return state.names?.[1] ?? '';
  }

  /** 봇전 방에서 서버가 내려준 내 아바타. */
  soloProfileFrom(state: RoomSnapshot): ProfileId {
    return toProfile(state.profiles?.[1]);
  }

  /** 이 방의 명령 통로. 락스텝에 그대로 넘긴다. */
  transport(): MatchTransport {
    const roomId = this.roomId;
    const server = this.server;
    if (!roomId) throw new Error('방에 들어가기 전입니다');

    return {
      send(batch: InputBatch) {
        // 응답을 기다리면 왕복이 한 번 더 붙어 입력 지연만 늘어난다.
        // 결과는 onBatch(브로드캐스트)로 돌아온다.
        server
          .remoteFunction('sendInputs', [batch], { needResponse: false })
          .catch((e: unknown) => console.warn('[net] sendInputs 실패', e));
      },
      onBatch(handler) {
        return server.onRoomMessage(roomId, MSG_INPUTS, (msg: InputBatch) => handler(msg));
      },
    };
  }

  // ── 계정 ───────────────────────────────────────────────────────
  //
  // 재화·강화·소유 유닛이 전부 서버에 산다. 클라이언트의 같은 판정은 버튼을 회색으로
  // 만드는 용도일 뿐이고, 실제로 깎는 것은 서버다.

  async getAccount(): Promise<RemoteAccount> {
    return await withTimeout(this.server.remoteFunction('getAccount', []), '계정 불러오기');
  }

  /** 광고를 보고 코인을 받는다. 금액·횟수 제한은 전부 서버가 정한다. */
  async claimAdCoins(): Promise<RemoteAccount> {
    return await withTimeout(this.server.remoteFunction('claimAdCoins', []), '광고 보상');
  }

  /** 판이 끝난 뒤 보상을 한 번 더. 금액은 서버가 지불한 값 그대로다. */
  async claimDoubleReward(): Promise<RemoteAccount> {
    return await withTimeout(this.server.remoteFunction('claimDoubleReward', []), '두 배 보상');
  }

  /**
   * 상위 10명. 서버가 판이 끝날 때마다 고치는 표를 그대로 읽는다 —
   * 클라이언트가 정렬하거나 자르지 않는다.
   */
  async getLeaderboard(): Promise<BoardEntry[]> {
    const res = await withTimeout(this.server.remoteFunction('getLeaderboard', []), '순위 불러오기');
    return Array.isArray(res) ? (res as BoardEntry[]) : [];
  }

  /** 닉네임 저장. 정리·검사는 서버가 한다 (`server.js` `setName`). */
  async setName(name: string): Promise<RemoteAccount> {
    return await withTimeout(this.server.remoteFunction('setName', [name]), '닉네임 저장');
  }

  /** 프로필 아바타 저장. 모르는 id는 서버가 기본값으로 떨어뜨린다. */
  async setProfile(profile: string): Promise<RemoteAccount> {
    return await withTimeout(this.server.remoteFunction('setProfile', [profile]), '아바타 저장');
  }

  async buyUpgrade(kind: string): Promise<RemoteAccount> {
    return await withTimeout(this.server.remoteFunction('buyUpgrade', [kind]), '강화 구매');
  }

  async buyUnitKind(kind: string): Promise<RemoteAccount> {
    return await withTimeout(this.server.remoteFunction('buyUnitKind', [kind]), '유닛 구매');
  }

  async selectUnitKind(kind: string): Promise<RemoteAccount> {
    return await withTimeout(this.server.remoteFunction('selectUnitKind', [kind]), '유닛 착용');
  }

  /**
   * 판 결과 보고. 서버가 보상을 계산해 계정에 넣고 새 계정을 돌려준다.
   * 이미 받은 판이면 `false` 를 돌려준다 — 방당 한 사람 한 번이다.
   *
   * **승패와 타워 수는 클라이언트가 보고한 값이다.** 서버가 시뮬레이션을 안 돌려서
   * 검증할 방법이 없다. 지금은 타워 수 상한으로 자르는 정도가 전부다.
   */
  async reportResult(winner: number, towers: number): Promise<RemoteAccount | null> {
    const res = await withTimeout(
      this.server.remoteFunction('reportResult', [winner, towers]),
      '결과 보고',
    );
    return res && typeof res === 'object' ? (res as RemoteAccount) : null;
  }
}

/**
 * 순위표 한 줄. 점수 내림차순으로 이미 정렬돼서 온다.
 *
 * 계정 id는 안 온다. **자기 자신은 `me` 로만 찾는다** — 닉네임은 안 겹치는 값이
 * 아니라서 이름으로 맞추면 동명이인이 내 줄로 강조된다.
 */
export interface BoardEntry {
  name: string;
  rating: number;
  me: boolean;
}

/** 서버가 들고 있는 계정. `account/account.ts` 의 로컬 계정과 필드가 겹친다. */
export interface RemoteAccount {
  account: string;
  name: string;
  coins: number;
  wins: number;
  losses: number;
  draws: number;
  speedLevel: number;
  ownedUnits: string[];
  unitKind: string;
  /** 봇 대체 판의 전적. 화면에는 안 드러내지만 갈라서 센다 (§-7). */
  soloWins: number;
  soloLosses: number;
  soloDraws: number;
  /** PVP 점수(Elo). 봇전에서는 현재 플레이어와 같은 점수의 봇을 상대한다. */
  rating: number;
  /** 유료(VX)로 열린 항목들. 코인으로 산 `ownedUnits` 와 갈라져 있다. */
  entitlements: string[];
}
