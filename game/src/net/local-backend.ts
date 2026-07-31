/**
 * 개발 빌드 전용 로컬 백엔드.
 *
 * **배포 전에는 Verse8에 붙을 수 없다** (`.env` 의 `VITE_AGENT8_VERSE` 가 없다).
 * 그러면 방 코드도, 친구랑 하기도 한 줄도 시험할 수 없다. 그 구멍을 메운다.
 *
 * ── 무엇을 흉내 내고 무엇을 진짜로 쓰는가 ─────────────────────
 *
 * **서버 로직은 진짜다.** 저장소 루트의 `server.js` 를 원문으로 읽어 그대로 실행한다
 * (`?raw` + `new Function`). 코드 발급·봇 폴백·보상 계산이 전부 배포될 코드와 같은 코드다.
 * 흉내 내는 것은 그 아래 플랫폼뿐이다: `$global`/`$room`/`$sender`/`$lock` 를
 * 메모리 스텁으로 물리고, 탭 사이는 `BroadcastChannel` 로 잇는다.
 *
 * 그래서 이걸로 통과한 것이 배포 후에도 통과한다는 보장은 없다 —
 * 스텁이 문서를 읽고 만든 가정이기 때문이다. 확인해야 할 가정은 HANDOFF §-5에 적혀 있다.
 *
 * ── 프로덕션 빌드에는 절대 안 들어간다 ────────────────────────
 *
 * `main.ts` 가 `import.meta.env.DEV` 안에서 **동적 import** 로만 부른다.
 * 프로덕션에서는 그 값이 `false` 로 치환되고 이 모듈째로 떨어져 나간다.
 * 정적으로 import 하지 말 것 — 그 순간 `server.js` 원문이 번들에 실린다.
 *
 * ── 탭 하나가 서버를 든다 ─────────────────────────────────────
 *
 * 먼저 뜬 탭이 호스트가 되어 서버를 돌리고, 나중 탭은 채널로 RPC를 보낸다.
 * 호스트 탭을 닫으면 나머지가 먹통이 된다 — 개발용이라 그 복구는 안 만들었다.
 */
import serverSource from '../../../server.js?raw';

const CHANNEL = 'towerwar.dev.backend';
/** 이 시간(ms) 안에 호스트가 응답하지 않으면 내가 호스트가 된다. */
const ELECTION_MS = 250;

/** `Agent8Client` 가 실제로 쓰는 것만. GameServer 전체를 흉내 낼 필요는 없다. */
export interface ServerLike {
  account: string;
  connected: boolean;
  connect(): Promise<boolean>;
  remoteFunction(fn: string, args?: unknown[], opts?: unknown): Promise<any>;
  subscribeRoomState(roomId: string, cb: (state: any) => void): () => void;
  onRoomMessage(roomId: string, type: string, cb: (message: any) => void): () => void;
}

interface Sender {
  account: string;
  roomId: string | null;
}

/** 탭마다 다른 계정. 두 창을 서로 다른 사람으로 붙이려면 이게 달라야 한다. */
function newAccount(): string {
  return '0xDEV' + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0').toUpperCase();
}

// ── 서버 실행 ─────────────────────────────────────────────────────

interface Host {
  call(sender: Sender, fn: string, args: unknown[]): Promise<unknown>;
  onState(cb: (roomId: string, state: unknown) => void): void;
  onMessage(cb: (roomId: string, type: string, message: unknown) => void): void;
}

function makeHost(): Host {
  const rooms = new Map<string, { state: Record<string, any>; users: Set<string> }>();
  const userStates = new Map<string, unknown>();
  let globalState: Record<string, unknown> = {};
  let nextRoom = 1;
  let cur: Sender | null = null;

  const stateCbs: ((roomId: string, state: unknown) => void)[] = [];
  const msgCbs: ((roomId: string, type: string, message: unknown) => void)[] = [];

  const room = (id: string) => {
    if (!rooms.has(id)) rooms.set(id, { state: { roomId: id }, users: new Set() });
    return rooms.get(id)!;
  };
  const withUsers = (id: string) => ({ ...room(id).state, $users: [...room(id).users] });

  // `$sender` 는 요청마다 바뀐다. Proxy로 현재 요청자를 가리킨다.
  const $sender = new Proxy({} as Sender, { get: (_, k) => (cur ? (cur as any)[k] : undefined) });
  // 하네스와 같다 — 단일 스레드라 락 안에서 도는지만 재현한다.
  const $lock = async <T>(_key: string, fn: () => T | Promise<T>): Promise<T> => await fn();

  const $global = {
    async getMyState() {
      return userStates.get(cur!.account) ?? null;
    },
    async updateMyState(s: unknown) {
      userStates.set(cur!.account, s);
      return s;
    },
    async getGlobalState() {
      return globalState;
    },
    async updateGlobalState(p: Record<string, unknown>) {
      globalState = { ...globalState, ...p };
    },
    async joinRoom(id?: string) {
      const r = id ?? `room-${nextRoom++}`;
      room(r).users.add(cur!.account);
      cur!.roomId = r;
      return r;
    },
    async leaveRoom() {
      const id = cur!.roomId;
      if (id) room(id).users.delete(cur!.account);
      cur!.roomId = null;
      return id;
    },
    async countRoomUsers(id: string) {
      return room(id).users.size;
    },
    async getAllRoomIds() {
      return [...rooms.keys()];
    },
    async getRoomState(id: string) {
      return rooms.has(id) ? withUsers(id) : null;
    },
    async updateRoomState(id: string, p: Record<string, unknown>) {
      const r = room(id);
      r.state = { ...r.state, ...p };
    },
  };

  const $room = {
    async getRoomState() {
      return cur!.roomId ? withUsers(cur!.roomId) : null;
    },
    async updateRoomState(p: Record<string, unknown>) {
      const r = room(cur!.roomId!);
      r.state = { ...r.state, ...p };
    },
    broadcastToRoom(type: string, message: unknown) {
      const id = cur!.roomId!;
      for (const cb of msgCbs) cb(id, type, message);
    },
  };

  // 진짜 server.js. export 가 금지된 파일이라 마지막에 노출 한 줄만 붙인다.
  const Server = new Function(
    '$global',
    '$room',
    '$sender',
    '$lock',
    `${serverSource}\n;return Server;`,
  )($global, $room, $sender, $lock);
  const server = new Server();

  const lastPushed = new Map<string, string>();
  function pushStates(): void {
    for (const id of rooms.keys()) {
      const s = withUsers(id);
      const json = JSON.stringify(s);
      if (lastPushed.get(id) === json) continue;
      lastPushed.set(id, json);
      for (const cb of stateCbs) cb(id, s);
    }
  }

  // `$roomTick` 은 서버가 주기로 돌려 주는 것이다. 숨겨진 탭에서는 setInterval 이
  // 강하게 조여지지만(1초 이상), 봇 폴백·타임아웃 판정은 원래 초 단위라 그걸로 충분하다.
  setInterval(() => {
    void (async () => {
      for (const id of [...rooms.keys()]) {
        cur = { account: '__tick__', roomId: null };
        try {
          await server.$roomTick(300, id);
        } catch (e) {
          console.warn('[dev] $roomTick 실패', id, e);
        }
      }
      pushStates();
    })();
  }, 300);

  return {
    async call(sender, fn, args) {
      cur = sender;
      try {
        return await server[fn](...args);
      } finally {
        pushStates();
      }
    },
    onState(cb) {
      stateCbs.push(cb);
    },
    onMessage(cb) {
      msgCbs.push(cb);
    },
  };
}

// ── 탭 붙이기 ─────────────────────────────────────────────────────

type Wire =
  | { k: 'who' }
  | { k: 'iam' }
  | { k: 'rpc'; id: number; sender: Sender; fn: string; args: unknown[] }
  | { k: 'ok'; id: number; value: unknown }
  | { k: 'err'; id: number; message: string }
  | { k: 'state'; roomId: string; state: unknown }
  | { k: 'msg'; roomId: string; type: string; message: unknown };

export async function createLocalBackend(): Promise<ServerLike> {
  const account = newAccount();
  const sender: Sender = { account, roomId: null };
  const ch = new BroadcastChannel(CHANNEL);

  const stateSubs: { roomId: string; cb: (s: any) => void }[] = [];
  const msgSubs: { roomId: string; type: string; cb: (m: any) => void }[] = [];
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  let nextId = 1;
  let host: Host | null = null;

  const fanState = (roomId: string, state: unknown) => {
    for (const s of stateSubs) if (s.roomId === roomId) s.cb(state);
  };
  const fanMsg = (roomId: string, type: string, message: unknown) => {
    for (const s of msgSubs) if (s.roomId === roomId && s.type === type) s.cb(message);
  };

  ch.onmessage = (e: MessageEvent<Wire>) => {
    const m = e.data;
    switch (m.k) {
      case 'who':
        if (host) ch.postMessage({ k: 'iam' } satisfies Wire);
        break;
      case 'rpc':
        if (!host) break;
        void host
          .call(m.sender, m.fn, m.args)
          .then((value) => ch.postMessage({ k: 'ok', id: m.id, value } satisfies Wire))
          .catch((err: Error) =>
            ch.postMessage({ k: 'err', id: m.id, message: String(err?.message ?? err) } satisfies Wire),
          );
        break;
      case 'ok':
      case 'err': {
        const p = pending.get(m.id);
        if (!p) break;
        pending.delete(m.id);
        m.k === 'ok' ? p.resolve(m.value) : p.reject(new Error(m.message));
        break;
      }
      case 'state':
        fanState(m.roomId, m.state);
        break;
      case 'msg':
        fanMsg(m.roomId, m.type, m.message);
        break;
      default:
        break;
    }
  };

  // 호스트 선출. 이미 있으면 손님이 되고, 없으면 내가 서버를 든다.
  const found = await new Promise<boolean>((resolve) => {
    const done = (v: boolean) => resolve(v);
    const timer = setTimeout(() => done(false), ELECTION_MS);
    const prev = ch.onmessage!;
    ch.onmessage = (e: MessageEvent<Wire>) => {
      if (e.data.k === 'iam') {
        clearTimeout(timer);
        ch.onmessage = prev;
        done(true);
        return;
      }
      // 선출 중에 온 다른 메시지도 흘리지 않는다. `call` 로 부르는 것은
      // 핸들러가 `this` 를 채널로 기대하기 때문이다.
      prev.call(ch, e);
    };
    ch.postMessage({ k: 'who' } satisfies Wire);
  });

  if (!found) {
    host = makeHost();
    // 호스트가 만든 변화는 자기 탭과 다른 탭 양쪽에 알려야 한다.
    host.onState((roomId, state) => {
      fanState(roomId, state);
      ch.postMessage({ k: 'state', roomId, state } satisfies Wire);
    });
    host.onMessage((roomId, type, message) => {
      fanMsg(roomId, type, message);
      ch.postMessage({ k: 'msg', roomId, type, message } satisfies Wire);
    });
  }

  console.warn(
    `[dev] 로컬 백엔드로 붙었습니다 (${found ? '손님' : '호스트'}). ` +
      `계정 ${account}. 실제 Verse8 서버가 아닙니다 — 배포 후에는 이 경로가 안 쓰입니다.`,
  );

  return {
    account,
    connected: true,
    async connect() {
      return true;
    },
    async remoteFunction(fn: string, args: unknown[] = []) {
      if (host) return await host.call(sender, fn, args);
      const id = nextId++;
      return await new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        ch.postMessage({ k: 'rpc', id, sender, fn, args } satisfies Wire);
        // 호스트 탭이 닫혔을 수 있다. 영원히 매달리는 것보다 실패가 낫다.
        setTimeout(() => {
          if (!pending.delete(id)) return;
          reject(new Error('로컬 백엔드 호스트가 응답하지 않습니다 (탭을 닫았나요?)'));
        }, 5000);
      });
    },
    subscribeRoomState(roomId, cb) {
      const s = { roomId, cb };
      stateSubs.push(s);
      return () => {
        const i = stateSubs.indexOf(s);
        if (i >= 0) stateSubs.splice(i, 1);
      };
    },
    onRoomMessage(roomId, type, cb) {
      const s = { roomId, type, cb };
      msgSubs.push(s);
      return () => {
        const i = msgSubs.indexOf(s);
        if (i >= 0) msgSubs.splice(i, 1);
      };
    },
  };
}
