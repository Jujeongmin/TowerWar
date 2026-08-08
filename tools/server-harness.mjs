/**
 * server.js 로직 검증 하네스.
 *
 * Verse8에 배포하지 않고 돌려 보려고 $global/$room/$sender 를 메모리 스텁으로 물린다.
 * server.js 는 export 를 금지당했으므로 소스를 읽어 마지막에 노출 한 줄만 붙여 평가한다.
 * (파일 자체는 손대지 않는다.)
 */
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const src = readFileSync(new URL('../server.js', import.meta.url), 'utf8');

// ── 스텁 ────────────────────────────────────────────────────────
const rooms = new Map(); // roomId -> { state, users:Set }
let nextRoomId = 1;
let sender = null;
const messages = [];

function room(id) {
  if (!rooms.has(id)) rooms.set(id, { state: { roomId: id }, users: new Set() });
  return rooms.get(id);
}
/** 문서상 룸 상태는 얕은 병합. 그 가정 자체를 여기서 고정해 둔다. */
function merge(id, patch) {
  const r = room(id);
  r.state = { ...r.state, ...patch };
}
function withUsers(id) {
  const r = room(id);
  return { ...r.state, $users: [...r.users] };
}

/** 글로벌 상태. 방 코드 표가 여기 산다. */
let globalState = {};
const collections = new Map();
let nextCollectionId = 1;
function collection(id) {
  if (!collections.has(id)) collections.set(id, new Map());
  return collections.get(id);
}

/** 분산 락. 하네스는 단일 스레드라 그냥 실행한다 — 락 안에서 도는지만 재현한다. */
const lockCalls = [];
async function $lock(key, fn) {
  lockCalls.push(key);
  return await fn();
}

/** 계정별 영구 상태. Verse8 유저 상태는 **덮어쓰기**라 스텁도 그렇게 둔다. */
const userStates = new Map();

const $global = {
  async getMyState() {
    return userStates.get(sender.account) ?? null;
  },
  async updateMyState(state) {
    userStates.set(sender.account, { ...state });
    return state;
  },
  async getUserState(account) {
    return userStates.get(account) ?? null;
  },
  async updateUserState(account, state) {
    userStates.set(account, { ...state });
    return state;
  },
  async getGlobalState() {
    return globalState;
  },
  async updateGlobalState(patch) {
    globalState = { ...globalState, ...patch };
  },
  async getCollectionItems(id, options = {}) {
    let rows = [...collection(id).values()].map((row) => ({ ...row }));
    for (const filter of options.filters || []) {
      if (filter.operator === '==') rows = rows.filter((row) => row[filter.field] === filter.value);
      if (filter.operator === '>') rows = rows.filter((row) => row[filter.field] > filter.value);
    }
    for (const order of [...(options.orderBy || [])].reverse()) {
      rows.sort((a, b) => order.direction === 'desc'
        ? Number(b[order.field]) - Number(a[order.field])
        : Number(a[order.field]) - Number(b[order.field]));
    }
    return options.limit ? rows.slice(0, options.limit) : rows;
  },
  async countCollectionItems(id, options = {}) {
    return (await this.getCollectionItems(id, options)).length;
  },
  async addCollectionItem(id, item) {
    const row = { ...item, __id: `item-${nextCollectionId++}` };
    collection(id).set(row.__id, row);
    return { ...row };
  },
  async updateCollectionItem(id, item) {
    if (!item.__id || !collection(id).has(item.__id)) throw new Error('missing collection item');
    const row = { ...collection(id).get(item.__id), ...item };
    collection(id).set(item.__id, row);
    return { ...row };
  },
  async deleteCollectionItem(id, itemId) {
    collection(id).delete(itemId);
    return { __id: itemId };
  },
  async joinRoom(roomId) {
    const id = roomId ?? `room-${nextRoomId++}`;
    room(id).users.add(sender.account);
    sender.roomId = id;
    return id;
  },
  async leaveRoom() {
    room(sender.roomId).users.delete(sender.account);
    const left = sender.roomId;
    sender.roomId = null;
    return left;
  },
  // 문서상 Promise를 돌려준다. 동기 값으로 두면 서버가 await 를 빼먹어도 통과해 버린다.
  async countRoomUsers(id) {
    return room(id).users.size;
  },
  async getAllRoomIds() {
    // **`null` 키를 거른다.** `$room.getRoomState()` 를 방에 없는 상태로 부르면
    // `room(sender.roomId)` 가 `room(null)` 을 만들어 표에 등록해 버린다 — 하네스만의
    // 결함이고 실제 Verse8 은 id 가 null 인 방을 돌려주지 않는다.
    //
    // 안 거르면 그 유령 방이 `phase` 도 `players` 도 없어서 매칭 필터를 전부 통과하고,
    // `findMatch` 가 늘 그걸 집어 버린다 (실제로 매칭 테스트가 그렇게 깨졌다).
    return [...rooms.keys()].filter((id) => id !== null && id !== undefined);
  },
  async getRoomState(id) {
    return rooms.has(id) ? withUsers(id) : null;
  },
  async updateRoomState(id, patch) {
    merge(id, patch);
  },
};

const $room = {
  async getRoomState() {
    return sender.roomId ? withUsers(sender.roomId) : null;
  },
  async updateRoomState(patch) {
    merge(sender.roomId, patch);
  },
  broadcastToRoom(type, message) {
    messages.push({ roomId: sender.roomId, type, message });
  },
};

// 광고는 서버 사이드 검증을 안 쓴다 (2026-08-04, B안). 그래서 fetch 스텁도 없다 —
// server.js 가 광고 청구에서 네트워크를 타지 않는다.

const ctx = vm.createContext({
  // **디버그 해금을 끄고 잰다.** 켜 둔 채로 재면 "안 산 것을 못 입는다" 계열 검사가
  // 통째로 통과해 버려서 아무것도 증명하지 못한다 (`server.js` 의 DEBUG_UNLOCK_ALL).
  __TW_NO_DEBUG_UNLOCK: true,
  $global,
  $room,
  $lock,
  get $sender() {
    return sender;
  },
  // server.js 는 setTimeout 도 fetch 도 안 쓴다 (광고 서버 검증 제거, 2026-08-04).
  console, Date, Math, Number, Object, Array, Set, JSON, String, Error,
});
vm.runInContext(src + '\nglobalThis.__Server = Server;', ctx);
const server = new ctx.__Server();

// ── 시나리오 ────────────────────────────────────────────────────
const results = [];
const check = (name, cond, extra) => results.push({ name, ok: !!cond, ...(cond ? {} : { extra }) });

/**
 * 기본 유닛 생김새. `server.js` 와 `game/src/units.ts` 의 값과 같아야 한다 —
 * 여기에 값을 박아 두면 기본값을 바꿀 때마다 이 파일이 이유 없이 빨개진다.
 */
const DEFAULT_UNIT_KIND = 'beergang';

/** 계정 스텁을 손으로 세팅할 때 쓰는 최소 골격. */
const defaultsFor = (account) => ({
  account, coins: 0, wins: 0, losses: 0, draws: 0,
  ownedUnits: [], unitKind: DEFAULT_UNIT_KIND,
  soloWins: 0, soloLosses: 0, soloDraws: 0,
});
$global.getUserStateOf = async (a) => userStates.get(a) ?? null;

const A = { account: '0xAAA', roomId: null };
const B = { account: '0xBBB', roomId: null };
const C = { account: '0xCCC', roomId: null };
const as = (s) => (sender = s);

/**
 * 점수·보상이 실제로 나가는 판으로 만든다.
 *
 * 두 가지를 손본다:
 *
 * - **길이**: `MIN_RATED_MS`(10초)보다 짧게 끝난 판은 점수가 안 움직인다. 하네스는
 *   판을 실제로 돌리지 않고 곧바로 결과를 보고하므로 시작 시각을 뒤로 당겨야 한다.
 * - **공개 여부**: 친구 방(`private`)은 코인도 점수도 전적도 안 준다. 하네스는 거의
 *   모든 판을 `createRoom` + `joinRoomByCode` 로 만드는데 그 길이 곧 친구 방이라,
 *   여기서 풀지 않으면 점수를 보는 검사가 전부 0을 본다.
 *
 * **친구 방이 정말 아무것도 안 주는지 보는 검사는 이 함수를 쓰면 안 된다** —
 * `startedAt` 만 직접 당겨서 길이 조건만 맞춰야 `private` 하나가 원인임이 드러난다.
 */
function age(roomId, ms = 30000) {
  rooms.get(roomId).state.startedAt = Date.now() - ms;
  open(roomId);
}

/**
 * 친구 방 표시만 뗀다. **길이는 안 건드린다** — "짧은 판이라 점수는 안 움직여도
 * 코인·전적은 나간다"를 보는 검사들이 있어서, 거기에 `age` 를 쓰면 검사 자체가
 * 무의미해진다.
 */
function open(roomId) {
  rooms.get(roomId).state.private = false;
}

// 1) A가 매칭 → 새 방
as(A);
const r1 = await server.findMatch();
check('A가 새 방을 만든다', r1.roomId === 'room-1', r1);
check('방이 waiting 으로 초기화된다', (await $global.getRoomState('room-1')).phase === 'waiting');

// 2) B가 매칭 → 같은 방에 합류 (새로 파지 않는다)
as(B);
const r2 = await server.findMatch();
check('B가 A의 방에 들어간다', r2.roomId === 'room-1', r2);
check('방 인원 2', (await $global.countRoomUsers('room-1')) === 2);

// 3) 한쪽만 준비 → 시작하지 않는다
as(A);
await server.setReady(true);
await server.$roomTick(300, 'room-1');
check('한쪽만 준비면 안 시작', (await $global.getRoomState('room-1')).phase === 'waiting');

// 4) 둘 다 준비 → 시작. 시드와 슬롯이 정해진다
as(B);
await server.setReady(true);
await server.$roomTick(300, 'room-1');
const started = await $global.getRoomState('room-1');
check('둘 다 준비면 시작', started.phase === 'playing', started.phase);
check('시드가 16비트 범위', Number.isInteger(started.seed) && started.seed >= 0 && started.seed < 0x10000, started.seed);
// 슬롯은 무작위로 준다 (같은 두 사람이 붙어도 위아래가 바뀌게). 순서는 못 박지만
// **둘이 서로 다른 번호를 하나씩 갖는 것**은 반드시 지켜져야 한다 — 둘 다 P1이 되면
// 양쪽이 서로를 자기 자리에 놓고 첫 틱부터 갈라진다.
check(
  '슬롯이 1과 2로 하나씩 나뉜다',
  [started.slots['0xAAA'], started.slots['0xBBB']].sort().join() === '1,2',
  started.slots,
);
// 슬롯별 값이 그 사람 것이어야 한다. 무작위로 바뀌는 것은 번호지 사람이 아니다.
check(
  '이름이 슬롯 번호를 따라간다',
  started.names[started.slots['0xAAA']] === started.players['0xAAA'].name &&
    started.names[started.slots['0xBBB']] === started.players['0xBBB'].name,
  { names: started.names, slots: started.slots },
);
check('입력 지연이 방 상태에 실린다', started.inputDelayTicks === 12);

// 4-b) 슬롯이 **정말로** 뒤집히는가. 한 번 돌려서 통과하는 것은 증명이 아니다 —
// 계정 순 고정이던 시절에도 위 검사는 통과한다. 같은 두 사람으로 여러 판을 열어
// 두 배치가 모두 나오는지 본다 (2026-08-06 사용자 지시: 같은 상대여도 위아래가 바뀌게).
{
  const seen = new Set();
  // 200번이면 한쪽으로만 나올 확률이 2^-199 다. 실패하면 무작위가 아닌 것이다.
  for (let i = 0; i < 200 && seen.size < 2; i++) {
    const id = `slotmix-${i}`;
    const r = room(id);
    r.users = new Set(['0xAAA', '0xBBB']);
    const now = Date.now();
    r.state = {
      roomId: id,
      phase: 'waiting',
      createdAt: now,
      players: {
        '0xAAA': { ready: true, joinedAt: now },
        '0xBBB': { ready: true, joinedAt: now },
      },
    };
    await server.$roomTick(300, id);
    seen.add(rooms.get(id).state.slots['0xAAA']);
    rooms.delete(id);
  }
  check('같은 두 사람이어도 슬롯이 판마다 바뀐다', seen.size === 2, [...seen]);
}

// 5) 진행 중인 방에는 새 사람이 안 들어간다 (새 방을 판다)
as(C);
const r3 = await server.findMatch();
check('진행 중인 방은 매칭에서 걸러진다', r3.roomId === 'room-2', r3);
as(C);
await server.leaveMatch();

// 6) 명령 릴레이 — 서버가 player 를 박는다
as(B);
messages.length = 0;
await server.sendInputs({ execTick: 42, commands: [{ kind: 'upgrade', player: 99, towerId: 3 }] });
const relayed = messages.at(-1);
check('명령이 룸에 브로드캐스트된다', relayed && relayed.type === 'tw.inputs', relayed);
check('클라이언트가 보낸 player 를 서버 값으로 덮는다', relayed.message.commands[0].player === started.slots['0xBBB'], relayed.message.commands[0]);
check('ackTick 이 기록된다', (await $global.getRoomState('room-1')).players['0xBBB'].ackTick === 42);

// 7) 빈 배치도 통과해야 한다 (상대가 진행할 수 있게)
as(A);
const emptyOk = await server.sendInputs({ execTick: 45 });
check('빈 배치도 받는다', emptyOk === true);
check('빈 배치도 ackTick 을 올린다', (await $global.getRoomState('room-1')).players['0xAAA'].ackTick === 45);

// 7-b) 재연결 복구 — 끊겼다 붙은 사람을 방에 다시 넣는다
// SDK 재연결은 소켓만 붙이고 방 참가를 복구하지 않는다 (server.js `rejoinRoom` 주석).
as(A);
// 끊겨 있던 동안 seenAt 이 안 갱신됐다고 치고 낡은 값을 박는다. 복구가 이걸 되돌려야
// 돌아오자마자 $roomTick 이 나를 조용한 쪽으로 보고 부전패로 닫는 일이 안 생긴다.
{
  const st = await $global.getRoomState('room-1');
  st.players['0xAAA'].seenAt = Date.now() - 60000;
  await $global.updateRoomState('room-1', { players: st.players });
}
check('이 판의 사람이면 방에 다시 들어간다', (await server.rejoinRoom('room-1')).ok === true);
check(
  '복구가 seenAt 을 되돌린다',
  Date.now() - (await $global.getRoomState('room-1')).players['0xAAA'].seenAt < 5000,
);
as(C);
check('남의 판에는 못 끼어든다', (await server.rejoinRoom('room-1')).ok === false);
as(A);
// 닫힌 방은 되살리지 않고 판정을 실어 보낸다. 이게 없으면 클라이언트가 복구를 계속
// 재시도하며 25초를 버린다 (재구독으로는 못 알아챈다 — 닫힌 방엔 더 올 변경이 없다).
check('없는 방은 phase 가 null', (await server.rejoinRoom('no-such-room')).phase === null);

// 8) 해시 일치 → 데싱크 없음
as(A);
await server.sendInputs({ execTick: 60, hash: { tick: 30, value: 'h1' } });
as(B);
await server.sendInputs({ execTick: 60, hash: { tick: 30, value: 'h1' } });
check('같은 해시면 데싱크 아님', (await $global.getRoomState('room-1')).desync == null);

// 9) 해시 불일치 → 데싱크 기록
as(A);
await server.sendInputs({ execTick: 90, hash: { tick: 60, value: 'h2' } });
as(B);
await server.sendInputs({ execTick: 90, hash: { tick: 60, value: 'DIFFERENT' } });
const d = (await $global.getRoomState('room-1')).desync;
check('해시가 다르면 데싱크 기록', d && d.tick === 60, d);

// 10) 결과 보고
as(A);
// 슬롯이 무작위라 A의 번호를 읽어서 보고한다. 이 검사의 뜻은 "A가 이겼다"이지
// "1번이 이겼다"가 아니다.
const slotA = started.slots['0xAAA'];
await server.reportResult(slotA);
const fin = await $global.getRoomState('room-1');
check('결과가 기록된다', fin.phase === 'finished' && fin.winner === '0xAAA' && fin.winnerSlot === slotA, fin);
// 끝난 방에 복구를 시도하면 되살리지 않고 판정을 실어 보낸다 (§-70).
const rejoinFin = await server.rejoinRoom('room-1');
check(
  '닫힌 방은 복구 대신 판정을 돌려준다',
  rejoinFin.ok === false && rejoinFin.phase === 'finished' && rejoinFin.winnerSlot === slotA,
  rejoinFin,
);
check('끝난 판에는 명령이 안 들어간다', (await server.sendInputs({ execTick: 99 })) === false);

// 11) 진행 중 이탈 → 상대 부전승
as(A);
await server.findMatch();
as(B);
const r4 = await server.findMatch();
as(A);
await server.setReady(true);
as(B);
await server.setReady(true);
await server.$roomTick(300, r4.roomId);
as(B);
await server.leaveMatch();
const left = await $global.getRoomState(r4.roomId);
check('진행 중 이탈하면 상대 승', left.phase === 'finished' && left.winner === '0xAAA' && left.reason === 'left', left);

// 12) 무응답 타임아웃
as(A);
const r5 = await server.findMatch();
as(B);
await server.findMatch();
as(A);
await server.setReady(true);
as(B);
await server.setReady(true);
await server.$roomTick(300, r5.roomId);
const st = rooms.get(r5.roomId).state;
st.players['0xBBB'].seenAt = Date.now() - 30000; // B가 조용해졌다
await server.$roomTick(300, r5.roomId);
const to = await $global.getRoomState(r5.roomId);
check('무응답이면 남은 쪽 승', to.phase === 'finished' && to.winner === '0xAAA' && to.reason === 'timeout', to);

// 13) 혼자 오래 기다리면 봇전으로 확정 (화면에는 안 드러나지만 서버는 표시를 남긴다)
as(A);
const r6 = await server.findMatch();
await server.setReady(true);
check('12초 전 AI 전환 요청은 거절', (await server.requestSoloFallback()) === false);
check('기다린 지 얼마 안 됐으면 그대로 대기', (await $global.getRoomState(r6.roomId)).phase === 'waiting');
rooms.get(r6.roomId).state.players['0xAAA'].joinedAt = Date.now() - 20000;
const requestedSoloSeed = await server.requestSoloFallback();
check('12초 뒤 AI 전환 요청을 승인', Number.isInteger(requestedSoloSeed));
const solo = await $global.getRoomState(r6.roomId);
check('오래 기다리면 봇전 확정', solo.phase === 'playing' && solo.solo === true, solo);
check('AI 전환 요청이 시작 시드를 직접 돌려준다', requestedSoloSeed === solo.seed, { requestedSoloSeed, seed: solo.seed });
check('봇전도 시드를 서버가 준다', Number.isInteger(solo.seed) && solo.seed >= 0 && solo.seed < 0x10000, solo.seed);
check('봇전은 슬롯 1번', solo.slots['0xAAA'] === 1, solo.slots);

// 14) 봇전으로 확정된 방은 매칭 후보에서 빠진다
as(B);
const r7 = await server.findMatch();
check('봇전 방에 다른 사람이 안 들어간다', r7.roomId !== r6.roomId, { r6: r6.roomId, r7: r7.roomId });
as(B);
await server.leaveMatch();

// 15) 봇전은 배치를 안 보낸다 — 전원 무응답이면 방을 닫는다
rooms.get(r6.roomId).state.players['0xAAA'].seenAt = Date.now() - 30000;
await server.$roomTick(300, r6.roomId);
const closed = await $global.getRoomState(r6.roomId);
check('버려진 봇전 방은 닫힌다', closed.phase === 'finished' && closed.reason === 'abandoned', closed);
// **abandon 은 endedAt 을 안 찍는다** (2026-08-04). 찍으면 클라가 ~90초 뒤 판을 끝내고
// 보고해도 played≈0 이라 MIN_RATED_MS 를 못 넘겨 봇전 점수가 영영 안 오른다.
check('abandon 이 endedAt 을 미리 안 찍는다', closed.endedAt === undefined, closed.endedAt);

// 15.5) 봇전도 전적·점수가 오른다 — 방이 조기 abandon 돼도. 클라가 ~60초 판을 하고
// 이겼다고 보고한 상황을 startedAt 을 뒤로 밀어 흉내낸다.
as(A);
userStates.set('0xAAA', { ...userStates.get('0xAAA'), rating: 1000, wins: 0 });
age(r6.roomId, 60000);
const soloResult = await server.reportResult(1, 0);
check('봇전 승리로 전적이 오른다', soloResult && soloResult.wins === 1, soloResult && soloResult.wins);
check('봇전 승리로 점수가 오른다 (+4)', soloResult && soloResult.rating === 1004, soloResult && soloResult.rating);
as(A); await server.leaveMatch().catch(() => {});

// 16) 방 코드 — 발급, 정규화, 참가
as(A);
const host = await server.createRoom();
check('코드는 4자', typeof host.code === 'string' && host.code.length === 4, host);
check('코드에 헷갈리는 글자가 없다', !/[IO01]/.test(host.code), host.code);
check('코드 발급은 락 안에서 돈다', lockCalls.includes('towerwar:roomcode'), lockCalls);
check('코드 → 방 매핑이 글로벌 상태에 남는다', globalState.codes[host.code] === host.roomId, globalState.codes);
check('코드 방은 private 표시', (await $global.getRoomState(host.roomId)).private === true);

as(B);
const joined = await server.joinRoomByCode(host.code.toLowerCase() + ' ');
check('소문자·공백을 넣어도 정규화되어 들어간다', joined.roomId === host.roomId, joined);

// 16.5) 점수 대역 매칭 — "될 때가 있고 안 될 때가 있다"의 원인 (2026-08-04)
//
// 대역은 기다린 시간에 따라 넓어진다 (0초 ±150 / 4초 ±250 / 8초 ±600 / 10초 무제한).
// 세 가지를 고정한다:
//   ① 점수가 멀면 갓 생긴 방을 안 집는다
//   ② **내 대기 시간도 대역을 넓힌다** — 전에는 상대 것만 봐서, 늦게 온 사람은
//      아무리 오래 기다려도 대역이 그대로였다. 두 사람이 동시에 대기 중인데도
//      서로를 지나쳐 둘 다 봇으로 떨어지던 바로 그 구멍이다
//   ③ **재시도가 자기 방을 다시 집지 않는다** — 집으면 `joinedAt` 이 초기화돼
//      대기 시간과 봇 폴백 타이머가 함께 리셋된다
as(A); await server.leaveMatch().catch(() => {});
as(B); await server.leaveMatch().catch(() => {});
as(C); await server.leaveMatch().catch(() => {});
userStates.set('0xAAA', { ...defaultsFor('0xAAA'), rating: 1000 });
userStates.set('0xBBB', { ...defaultsFor('0xBBB'), rating: 1400 }); // 400 차이

as(A);
const bandRoom = await server.findMatch();
as(B);
// ① 갓 생긴 방 + 400 차이 → 대역 100 밖이라 안 붙고 자기 방을 판다
const bandMiss = await server.findMatch();
check('점수가 멀면 갓 생긴 방을 안 집는다', bandMiss.roomId !== bandRoom.roomId, {
  a: bandRoom.roomId, b: bandMiss.roomId,
});

// ③ B가 재시도해도 **자기 방**은 다시 안 집는다 (대기 0초로 불러 A 방은 여전히 대역 밖)
const selfRetry = await server.findMatch(0, true);
check('재시도가 자기 방을 다시 집지 않는다', selfRetry === null, selfRetry);
const bJoinedAt = rooms.get(bandMiss.roomId).state.players['0xBBB'].joinedAt;
check('그래서 joinedAt 이 초기화되지 않는다', typeof bJoinedAt === 'number' && bJoinedAt > 0, bJoinedAt);

// ② 내가 9초 기다렸다고 하면 대역이 600으로 넓어져 A 방에 붙는다.
//    A 방의 대기 시간은 그대로다 — 넓힌 것은 내 쪽이다.
const bandHit = await server.findMatch(9000, true);
check('내 대기가 대역을 넓혀 매칭된다', bandHit && bandHit.roomId === bandRoom.roomId, bandHit);
check('두 사람이 한 방에 모였다', (await $global.countRoomUsers(bandRoom.roomId)) === 2);

as(A); await server.leaveMatch().catch(() => {});
as(B); await server.leaveMatch().catch(() => {});

// 17) 코드 방은 무작위 매칭 후보가 아니다
as(A); await server.leaveMatch();
as(B); await server.leaveMatch();
as(A);
const host2 = await server.createRoom();
as(C);
const rando = await server.findMatch();
check('무작위 매칭이 코드 방을 안 집는다', rando.roomId !== host2.roomId, { host2: host2.roomId, rando: rando.roomId });
as(C); await server.leaveMatch();

// 18) 코드 방은 봇 폴백을 안 받는다 — 친구를 기다리는 중이다
as(A);
await server.setReady(true);
rooms.get(host2.roomId).state.players['0xAAA'].joinedAt = Date.now() - 60000;
check('코드 방은 AI 전환 요청도 거절한다', (await server.requestSoloFallback()) === false);
await server.$roomTick(300, host2.roomId);
check('코드 방은 혼자 오래 있어도 봇전이 안 된다', (await $global.getRoomState(host2.roomId)).phase === 'waiting');

// 19) 잘못된 코드
as(C);
let err = null;
try { await server.joinRoomByCode('ZZZZ'); } catch (e) { err = e.message; }
check('없는 코드는 던진다', err === '그런 방이 없습니다', err);
err = null;
try { await server.joinRoomByCode('AB'); } catch (e) { err = e.message; }
check('길이가 모자란 코드는 던진다', err === '방 코드는 4자입니다', err);

// 20) 판이 시작되면 코드를 놓아 준다
as(C);
await server.joinRoomByCode(host2.code);
await server.setReady(true);
await server.$roomTick(300, host2.roomId);
check('둘 다 준비되면 코드 방도 시작한다', (await $global.getRoomState(host2.roomId)).phase === 'playing');
check('시작하면 코드가 표에서 빠진다', globalState.codes[host2.code] === undefined, globalState.codes);

// 21) 꽉 찬 방은 코드로도 못 들어간다
as(A); await server.leaveMatch();
as(B); await server.leaveMatch();
as(A);
const host3 = await server.createRoom();
as(B);
await server.joinRoomByCode(host3.code);
as(C);
err = null;
try { await server.joinRoomByCode(host3.code); } catch (e) { err = e.message; }
check('꽉 찬 코드 방은 던진다', err === '방이 가득 찼습니다', err);

// 22) 버려진 코드 방은 코드까지 회수된다
as(A); await server.leaveMatch();
as(B); await server.leaveMatch();
await server.$roomTick(300, host3.roomId);
check('빈 코드 방은 닫힌다', (await $global.getRoomState(host3.roomId)).phase === 'finished');
check('닫히면 코드가 회수된다', globalState.codes[host3.code] === undefined, globalState.codes);

// 23·24) 상점 공속 강화(`speedLevel`) 검사는 2026-08-06에 통째로 뺐다 — 강화 자체를
// 없앴다(사용자 지시). 생산속도를 타워 외형이 이어받으면 그 종류 이름을 유닛 종류와
// 같은 방식으로 검사할 것 (바로 아래 24.5 가 그 본보기다).

// 24.5) 유닛 종류도 슬롯 번호로 내려온다
//
// 2026-07-31부터 종류가 유닛의 힘을 정한다. 이 값이 안 내려오거나 슬롯이 어긋나면
// 두 클라이언트가 **서로 다른 PlayerMods 로 시뮬레이션해 첫 틱부터 갈라진다.**
// 힘 수치 자체는 서버가 모른다 — 이름만 내려주고 변환은 클라이언트가 한다.
as(A); await server.leaveMatch();
as(B); await server.leaveMatch();
userStates.set('0xAAA', {
  ...defaultsFor('0xAAA'), unitKind: 'beergang_purple', ownedUnits: ['beergang_purple'],
});
// 안 가진 것을 손으로 심어 뒀다. cleanAccount 가 걸러 기본값으로 떨어져야 한다
userStates.set('0xBBB', { ...defaultsFor('0xBBB'), unitKind: 'beergang_gold', ownedUnits: [] });
as(A);
const uk = await server.createRoom();
await server.setReady(true);
as(B);
await server.joinRoomByCode(uk.code);
await server.setReady(true);
await server.$roomTick(300, uk.roomId);
const uks = await $global.getRoomState(uk.roomId);
check('시작 시 kinds 가 내려온다', uks.kinds != null, uks);
check('A가 산 보라가 A 슬롯으로 내려온다', uks.kinds[uks.slots['0xAAA']] === 'beergang_purple', uks.kinds);
check('B는 안 산 금색을 자칭 못 한다', uks.kinds[uks.slots['0xBBB']] === 'beergang', uks.kinds);
check('힘 수치는 서버가 안 내려준다', uks.powers === undefined && uks.unitPower === undefined, uks);

// 24.6) 모르는 종류는 기본값으로 떨어진다 (배포 시점이 어긋난 클라이언트)
as(A); await server.leaveMatch();
as(B); await server.leaveMatch();
userStates.set('0xAAA', { ...defaultsFor('0xAAA'), unitKind: 'dragon' });
userStates.set('0xBBB', { ...defaultsFor('0xBBB'), unitKind: 'toString' }); // 상속 키
as(A);
const uk2 = await server.createRoom();
await server.setReady(true);
as(B);
await server.joinRoomByCode(uk2.code);
await server.setReady(true);
await server.$roomTick(300, uk2.roomId);
const uks2 = await $global.getRoomState(uk2.roomId);
check('모르는 종류는 기본값', uks2.kinds[1] === 'beergang', uks2.kinds);
check('상속 키도 기본값', uks2.kinds[2] === 'beergang', uks2.kinds);

// 24.7) 타워 외형도 슬롯 번호로 내려온다 — 유닛 종류와 같은 규칙이다.
// 외형이 생산속도를 정하므로(towers.ts) 클라이언트가 보낸 값을 믿으면 안 산 속도를
// 자칭할 수 있다. 서버 계정에서 읽는지, 안 가진 것은 기본으로 떨어지는지 본다.
as(A); await server.leaveMatch().catch(() => {});
as(B); await server.leaveMatch().catch(() => {});
userStates.set('0xAAA', {
  ...defaultsFor('0xAAA'),
  ownedTowers: ['tower_keep'], towerKind: 'tower_keep',
});
userStates.set('0xBBB', {
  ...defaultsFor('0xBBB'),
  ownedTowers: [], towerKind: 'tower_citadel', // 안 산 것이 착용돼 있다
});
as(A);
const tw = await server.createRoom();
await server.setReady(true);
as(B);
await server.joinRoomByCode(tw.code);
await server.setReady(true);
await server.$roomTick(300, tw.roomId);
const twState = await $global.getRoomState(tw.roomId);
check('시작 시 towerKinds 가 내려온다', twState.towerKinds != null, twState);
check('A가 산 석탑이 A 슬롯으로', twState.towerKinds[twState.slots['0xAAA']] === 'tower_keep', twState.towerKinds);
check('B의 안 산 성채는 기본으로', twState.towerKinds[twState.slots['0xBBB']] === 'tower_hut', twState.towerKinds);

// 24.8) 타워 구매·착용
as(A); await server.leaveMatch().catch(() => {});
as(B); await server.leaveMatch().catch(() => {});
const T = { account: '0xTTT', roomId: null };
as(T);
userStates.set('0xTTT', { ...defaultsFor('0xTTT'), coins: 5000 });
let te = null;
try { await server.buyTowerKind('tower_hut'); } catch (e) { te = e.message; }
check('기본 타워는 이미 가진 것', te === '이미 가지고 있습니다', te);
te = null;
try { await server.buyTowerKind('tower_prime'); } catch (e) { te = e.message; }
check('유료 타워는 코인으로 못 산다', te === '코인으로 살 수 없습니다', te);
te = null;
try { await server.buyTowerKind('castle'); } catch (e) { te = e.message; }
check('카탈로그에 없는 타워 거부', te === '그런 타워가 없습니다', te);
// `Object.prototype` 상속 키(`toString` 등)는 `TOWER_PRICES[kind]` 가 함수를
// 돌려줘 `undefined`/`0`/`NaN` 비교를 전부 피해 간다 — 코인이 그대로 새어 나가면
// 안 된다 (최종 코드 리뷰 Important #2).
for (const bad of ['toString', 'constructor', 'valueOf', 'hasOwnProperty']) {
  te = null;
  const coinsBefore = (await server.getAccount()).coins;
  try { await server.buyTowerKind(bad); } catch (e) { te = e.message; }
  check(`상속 키 타워 구매 거부: ${bad}`, te === '그런 타워가 없습니다', te);
  check(`상속 키 타워 구매가 코인을 안 건드린다: ${bad}`, (await server.getAccount()).coins === coinsBefore, await server.getAccount());
}
// **가장 싼 유료 칸을 산다.** 종류 이름에 가격을 박아 두면 사다리 순서를 바꿀 때마다
// (2026-08-07에 석탑을 2번으로 올렸다) 이 검사가 이유 없이 빨개진다. 검사의 뜻은
// "코인이 가격만큼 깎이고 바로 착용된다"이지 "석탑이 2000원이다"가 아니다.
// 값 자체는 `server.js` 의 `TOWER_PRICES` 를 따라간다 (2026-08-09에 5배가 됐다).
const cheapest = 'tower_keep';
const cheapestPrice = 2000;
const wallet = 5000;
const bought = await server.buyTowerKind(cheapest);
check(`타워 구매: ${wallet} - ${cheapestPrice}`, bought.coins === wallet - cheapestPrice, bought.coins);
check('사면 바로 착용된다', bought.towerKind === cheapest, bought);
te = null;
try { await server.buyTowerKind('tower_citadel'); } catch (e) { te = e.message; }
check('코인 모자라면 거부', te === '코인이 모자랍니다', te);
te = null;
try { await server.selectTowerKind('tower_citadel'); } catch (e) { te = e.message; }
check('안 산 타워는 착용 거부', te === '가지고 있지 않습니다', te);
const worn = await server.selectTowerKind('tower_hut');
check('가진 것은 착용된다', worn.towerKind === 'tower_hut', worn);

// 25) 계정이 서버에 산다 — 앞 테스트에 안 쓰인 새 계정으로 본다
const D = { account: '0xDDD', roomId: null };
as(D);
let acct = await server.getAccount();
check('처음 부르면 기본 계정이 생긴다', acct.coins === 0 && acct.unitKind === DEFAULT_UNIT_KIND, acct);
check('없앤 강화는 함수 자체가 없다', typeof server.buyUpgrade !== 'function');
let e2 = null;

// 26·27·27.5) 공속 강화 구매 검사도 통째로 뺐다 (강화를 없앴다, 2026-08-06).
// 코인 잔액·락·가격 검사는 유닛 구매(28절)가 같은 경로로 덮는다.

// 28) 유닛 구매/착용
//
// 2026-07-31에 BeerGang 색 변형 4종이 들어와 **구매 경로가 다시 살아났다**
// (2026-07-30 ~ 07-31 사이에는 값 0짜리 하나뿐이라 거부 경로만 지켰다).
// 지갑은 `UNIT_PRICES` 를 따라간다 — 가장 싼 칸(2000)은 사지고 그다음(4500)은
// 못 사는 액수여야 아래 두 검사가 뜻을 갖는다. 2026-08-09에 가격이 5배가 됐다.
userStates.set('0xDDD', { ...acct, coins: 2500 });
e2 = null;
try { await server.buyUnitKind(DEFAULT_UNIT_KIND); } catch (e) { e2 = e.message; }
check('값 0짜리는 살 수 없다 (이미 가진 것)', e2 === '이미 가지고 있습니다', e2);
e2 = null;
try { await server.buyUnitKind('lancer'); } catch (e) { e2 = e.message; }
check('카탈로그에 없는 유닛 구매 거부', e2 === '그런 유닛이 없습니다', e2);
e2 = null;
try { await server.selectUnitKind('lancer'); } catch (e) { e2 = e.message; }
check('카탈로그에 없는 유닛 착용 거부', e2 === '그런 유닛이 없습니다', e2);
// `Object.prototype` 상속 키는 `UNIT_PRICES[kind]` 가 함수를 돌려줘 가격 검사를
// 전부 피해 간다 — `buyUnitKind`/`selectUnitKind` 양쪽 다 (최종 코드 리뷰 Important #2).
for (const bad of ['toString', 'constructor', 'valueOf', 'hasOwnProperty']) {
  e2 = null;
  const coinsBefore = (await server.getAccount()).coins;
  try { await server.buyUnitKind(bad); } catch (e) { e2 = e.message; }
  check(`상속 키 유닛 구매 거부: ${bad}`, e2 === '그런 유닛이 없습니다', e2);
  check(`상속 키 유닛 구매가 코인을 안 건드린다: ${bad}`, (await server.getAccount()).coins === coinsBefore, await server.getAccount());
  e2 = null;
  try { await server.selectUnitKind(bad); } catch (e) { e2 = e.message; }
  check(`상속 키 유닛 착용 거부: ${bad}`, e2 === '그런 유닛이 없습니다', e2);
}
acct = await server.selectUnitKind(DEFAULT_UNIT_KIND);
check('기본 유닛은 언제나 착용 가능', acct.unitKind === DEFAULT_UNIT_KIND, acct);

// 코인 2500으로 2000짜리는 사지고 4500짜리는 안 사져야 한다
acct = await server.buyUnitKind('beergang_white');
check(
  '흰 비어갱 2000 구매: 2500 - 2000, 자동 착용',
  acct.coins === 500 && acct.unitKind === 'beergang_white' && acct.ownedUnits.includes('beergang_white'),
  acct,
);
e2 = null;
try { await server.buyUnitKind('beergang_gold'); } catch (e) { e2 = e.message; }
check('잔액 500으로 4500짜리 거부', e2 === '코인이 모자랍니다', e2);
e2 = null;
try { await server.buyUnitKind('beergang_white'); } catch (e) { e2 = e.message; }
check('이미 산 것을 또 못 산다', e2 === '이미 가지고 있습니다', e2);
e2 = null;
try { await server.selectUnitKind('beergang_purple'); } catch (e) { e2 = e.message; }
check('안 가진 유닛 착용 거부', e2 === '가지고 있지 않습니다', e2);
acct = await server.selectUnitKind(DEFAULT_UNIT_KIND);
check('기본으로 되돌아가도 코인은 그대로', acct.coins === 500 && acct.unitKind === DEFAULT_UNIT_KIND, acct);
acct = await server.selectUnitKind('beergang_white');
check('산 것은 다시 입어도 공짜', acct.coins === 500 && acct.unitKind === 'beergang_white', acct);

// 29) 손으로 고친 계정은 정규화된다
userStates.set('0xDDD', {
  coins: -50, speedLevel: 99, unitKind: 'dragon',
  // `pawn` 은 카탈로그에서 빠진 옛 유닛이다 — 이것도 걸러져야 한다.
  ownedUnits: [DEFAULT_UNIT_KIND, DEFAULT_UNIT_KIND, 'pawn', 'bogus'],
});
acct = await server.getAccount();
check('음수 코인은 0', acct.coins === 0, acct);
check('모르는 유닛 착용은 기본으로', acct.unitKind === DEFAULT_UNIT_KIND, acct);
check(
  '소유 목록에서 중복·카탈로그에 없는 값 제거',
  JSON.stringify(acct.ownedUnits) === JSON.stringify([DEFAULT_UNIT_KIND]),
  acct.ownedUnits,
);

// 30) setReady 가 클라이언트 값을 안 믿고 서버 계정을 읽는다
as(A); await server.leaveMatch().catch(() => {});
as(B); await server.leaveMatch().catch(() => {});
// 공속 강화가 사라진 뒤로 이 자리를 지키는 값은 **유닛 종류**다 — 종류가 힘을 정하므로
// 클라이언트가 보낸 값을 믿으면 안 산 유닛의 힘을 자칭할 수 있다.
userStates.set('0xAAA', {
  ...defaultsFor('0xAAA'),
  ownedUnits: ['beergang_purple'], unitKind: 'beergang_purple',
});
userStates.set('0xBBB', { ...defaultsFor('0xBBB') });
as(A);
const forge = await server.createRoom();
await server.setReady(true, 'beergang_gold'); // 클라이언트가 안 산 금색을 자칭한다
as(B);
await server.joinRoomByCode(forge.code);
await server.setReady(true, 'beergang_gold');
await server.$roomTick(300, forge.roomId);
const fs = await $global.getRoomState(forge.roomId);
check('위조한 종류가 안 먹는다 (A=보라)', fs.kinds[fs.slots['0xAAA']] === 'beergang_purple', fs.kinds);
check('상대도 서버 값 (B=기본)', fs.kinds[fs.slots['0xBBB']] === DEFAULT_UNIT_KIND, fs.kinds);

// 31) 보상은 서버가 준다. 양쪽 다 받고, 두 번은 안 준다
// 짧은 판이라 점수는 안 움직이지만 코인·전적은 나가는 자리다. 친구 방 표시만 뗀다.
open(forge.roomId);
const coinsBefore = (await $global.getUserStateOf('0xAAA')).coins;
as(A);
const paidA = await server.reportResult(fs.slots['0xAAA'], 7);
check('승자 보상 = 100 + 7*8', paidA.coins === coinsBefore + 100 + 56, { paidA: paidA.coins, coinsBefore });
check('PVP 전적에 쌓인다', paidA.wins === 1 && paidA.soloWins === 0, paidA);
const twice = await server.reportResult(fs.slots['0xAAA'], 7);
check('같은 사람이 두 번 보고해도 한 번만', twice === false, twice);
as(B);
const paidB = await server.reportResult(fs.slots['0xAAA'], 2);
check('진 쪽도 보상을 받는다 = 30 + 2*8', paidB.coins === 46, paidB.coins);
check('진 쪽 전적', paidB.losses === 1, paidB);

// 32) 타워 수 보고를 부풀려도 상한에서 잘린다
as(C);
const soloRoom = await server.createRoom();
await server.setReady(true);
rooms.get(soloRoom.roomId).state.players['0xCCC'].joinedAt = Date.now() - 60000;
rooms.get(soloRoom.roomId).state.private = false; // 봇 폴백을 받게 한다
await server.$roomTick(300, soloRoom.roomId);
const ss = await $global.getRoomState(soloRoom.roomId);
check('혼자면 봇전으로 확정', ss.solo === true, ss);
const paidC = await server.reportResult(1, 9999);
check('타워 수는 12로 잘린다 = 100 + 96', paidC.coins === 196, paidC.coins);
check('봇전은 일반 전적과 solo 통계에 모두 쌓인다', paidC.soloWins === 1 && paidC.wins === 1, paidC);

// 32.5) 전적 초기화 — 전적만 0, 점수·코인·솔로 통계는 그대로
as(C);
userStates.set('0xCCC', {
  ...defaultsFor('0xCCC'),
  wins: 5, losses: 3, draws: 2,
  soloWins: 4, soloLosses: 1,
  rating: 1234, coins: 777,
});
const rr = await server.resetRecord();
check('전적 초기화: 승/패/무가 0', rr.wins === 0 && rr.losses === 0 && rr.draws === 0, rr);
check('전적 초기화: 점수·코인은 유지', rr.rating === 1234 && rr.coins === 777, rr);
check('전적 초기화: solo 통계는 안 지운다', rr.soloWins === 4 && rr.soloLosses === 1, rr);
const rrSaved = await $global.getUserStateOf('0xCCC');
check('전적 초기화가 서버에 저장된다', rrSaved.wins === 0 && rrSaved.rating === 1234, rrSaved);

// 33) 닉네임 — 정리 규칙과 거부
const E = { account: '0xEEE', roomId: null };
as(E);
let eacct = await server.getAccount();
check('처음엔 이름이 비어 있다', eacct.name === '', eacct.name);
let nerr = null;
try { await server.setName('   '); } catch (e) { nerr = e.message; }
check('공백만 넣으면 거부', nerr === '닉네임을 입력하세요', nerr);
eacct = await server.setName('  홍길동  ');
check('앞뒤 공백을 잘라낸다', eacct.name === '홍길동', eacct.name);
eacct = await server.setName('가나다라마바사아자차카타파하');
check('12자로 자른다', eacct.name.length === 12, eacct.name);
eacct = await server.setName('a b​c  d');
check('제어문자 제거·공백 축약', eacct.name === 'abc d', JSON.stringify(eacct.name));

// 34) 매치 시작 시 슬롯별 이름이 내려온다 — 클라이언트가 보낸 값이 아니라 서버 계정에서
userStates.set('0xAAA', { ...defaultsFor('0xAAA'), name: '앨리스' });
userStates.set('0xBBB', { ...defaultsFor('0xBBB'), name: '밥' });
as(A); await server.leaveMatch().catch(() => {});
as(B); await server.leaveMatch().catch(() => {});
as(A);
const nroom = await server.createRoom();
await server.setReady(true);
as(B);
await server.joinRoomByCode(nroom.code);
await server.setReady(true);
await server.$roomTick(300, nroom.roomId);
const ns = await $global.getRoomState(nroom.roomId);
check('슬롯별 이름이 내려온다', ns.names[ns.slots['0xAAA']] === '앨리스' && ns.names[ns.slots['0xBBB']] === '밥', ns.names);

// 35) 봇전 방에는 사람 이름만 내려준다 (봇 이름은 클라이언트가 만든다)
userStates.set('0xCCC', { ...defaultsFor('0xCCC'), name: '캐럴' });
as(C); await server.leaveMatch().catch(() => {});
as(C);
const sroom = await server.createRoom();
await server.setReady(true);
rooms.get(sroom.roomId).state.players['0xCCC'].joinedAt = Date.now() - 60000;
rooms.get(sroom.roomId).state.private = false;
await server.$roomTick(300, sroom.roomId);
const sst = await $global.getRoomState(sroom.roomId);
check('봇전은 내 이름만', sst.solo === true && sst.names[1] === '캐럴' && sst.names[2] === undefined, sst.names);

// 36) PVP 점수(Elo) — 판이 끝나면 서버가 점수를 옮긴다.
//     점수 차 200인 판을 고른 이유: 양쪽 변동이 ±8로 같아야 스냅샷으로 쟀다는 뜻이다.
//     지금 계정 값을 읽었다면 나중에 보고한 쪽이 이미 움직인 상대 점수를 보게 돼 합이 어긋난다.
as(A); await server.leaveMatch().catch(() => {});
as(B); await server.leaveMatch().catch(() => {});
userStates.set('0xAAA', { ...defaultsFor('0xAAA'), rating: 1200 });
userStates.set('0xBBB', { ...defaultsFor('0xBBB'), rating: 1000 });
as(A);
const eroom = await server.createRoom();
await server.setReady(true);
as(B);
await server.joinRoomByCode(eroom.code);
await server.setReady(true);
await server.$roomTick(300, eroom.roomId);
const es = await $global.getRoomState(eroom.roomId);
age(eroom.roomId);
check(
  '시작 시 점수 스냅샷이 찍힌다',
  es.ratings[es.slots['0xAAA']] === 1200 && es.ratings[es.slots['0xBBB']] === 1000,
  es.ratings,
);
as(A);
const ratedA = await server.reportResult(es.slots['0xAAA'], 0);
check('이긴 쪽 1200 → 1208', ratedA.rating === 1208, ratedA.rating);
as(B);
const ratedB = await server.reportResult(es.slots['0xAAA'], 0);
check('진 쪽 1000 → 992', ratedB.rating === 992, ratedB.rating);
check('점수 합이 보존된다 (스냅샷으로 쟀다)', ratedA.rating + ratedB.rating === 2200, {
  a: ratedA.rating, b: ratedB.rating,
});

// 37) 봇전도 점수를 움직인다. 봇은 계정이 없어 `BOT_RATING`(1000)이 상대다.
//     플레이어는 봇인 것을 모르므로(§-7) 여기서 안 움직이면 "이겼는데 왜 안 올라"가 된다.
/** 봇전 한 판을 끝까지 돌리고 새 계정을 돌려준다. `winner` 는 1(사람) 또는 2(봇). */
async function soloMatch(who, winner) {
  as(who); await server.leaveMatch().catch(() => {});
  const r = await server.createRoom();
  await server.setReady(true);
  rooms.get(r.roomId).state.players[who.account].joinedAt = Date.now() - 60000;
  rooms.get(r.roomId).state.private = false; // 봇 폴백을 받게 한다
  await server.$roomTick(300, r.roomId);
  age(r.roomId);
  return await server.reportResult(winner, 0);
}
userStates.set('0xCCC', { ...defaultsFor('0xCCC'), name: '캐럴', rating: 1100 });
const soloWin = await soloMatch(C, 1);
// 플레이어와 봇 모두 1100, K=8. 기대승률 0.5 → ±4
check('봇전 승리 1100 → 1104', soloWin.rating === 1104, soloWin.rating);
userStates.set('0xCCC', { ...defaultsFor('0xCCC'), name: '캐럴', rating: 1100 });
const soloLoss = await soloMatch(C, 2);
// 패배도 동점 상대 기준으로 -4다.
check('봇전 패배 1100 → 1096', soloLoss.rating === 1096, soloLoss.rating);

// 37-b) 고점에서도 봇 점수는 플레이어와 같으므로 승리 변동은 +4다.
userStates.set('0xCCC', { ...defaultsFor('0xCCC'), name: '캐럴', rating: 1500 });
const capped = await soloMatch(C, 1);
check('1500점에서도 동점 봇을 이기면 4점 오른다', capped.rating === 1504, capped.rating);

// 38) 점수 필드가 없던 계정(v8 이하)은 0이 아니라 기본 점수에서 출발한다
const F = { account: '0xFFF', roomId: null };
as(F);
check('점수가 없던 계정은 1000', (await server.getAccount()).rating === 1000, await server.getAccount());

// 39) 매칭 대역 — 점수가 너무 다르면 즉시 안 붙고, 오래 기다린 방은 열린다
as(A); await server.leaveMatch().catch(() => {});
as(B); await server.leaveMatch().catch(() => {});
as(C); await server.leaveMatch().catch(() => {});
rooms.clear(); // 앞 절의 방들이 후보에 섞이면 무엇에 붙었는지 알 수 없다
userStates.set('0xAAA', { ...defaultsFor('0xAAA'), rating: 1000 });
userStates.set('0xBBB', { ...defaultsFor('0xBBB'), rating: 1600 });
as(A);
const waitRoom = await server.findMatch();
as(B);
const far = await server.findMatch();
check('점수 차 600은 즉시 안 붙는다', far.roomId !== waitRoom.roomId, { far: far.roomId, waitRoom: waitRoom.roomId });
as(B); await server.leaveMatch();
rooms.get(waitRoom.roomId).state.players['0xAAA'].joinedAt = Date.now() - 11000;
as(B);
const near = await server.findMatch();
check('11초 기다린 방은 대역이 열린다', near.roomId === waitRoom.roomId, { near: near.roomId, waitRoom: waitRoom.roomId });

// 40) 순위표 — 판이 끝날 때마다 서버가 고친다
globalState = { ...globalState, board: [] };
collections.set('rankings', new Map());
as(A); await server.leaveMatch().catch(() => {});
as(B); await server.leaveMatch().catch(() => {});
userStates.set('0xAAA', { ...defaultsFor('0xAAA'), name: '앨리스', rating: 1200 });
userStates.set('0xBBB', { ...defaultsFor('0xBBB'), name: '밥', rating: 1000 });
as(A);
const lroom = await server.createRoom();
await server.setReady(true);
as(B);
await server.joinRoomByCode(lroom.code);
await server.setReady(true);
await server.$roomTick(300, lroom.roomId);
const ls = await $global.getRoomState(lroom.roomId);
age(lroom.roomId);
as(A); await server.reportResult(ls.slots['0xAAA'], 0);
as(B); await server.reportResult(ls.slots['0xAAA'], 0);
as(A);
const board1 = await server.getLeaderboard();
check('두 사람 다 순위표에 오른다', board1.length === 2, board1);
check('점수 내림차순이다', board1[0].name === '앨리스' && board1[1].name === '밥', board1);
check('점수는 판이 끝난 뒤 값이다', board1[0].rating === 1208 && board1[1].rating === 992, board1);
check('부른 사람이 me 로 표시된다', board1[0].me === true && board1[1].me === false, board1);
check('계정 id는 안 내려간다', board1.every((e) => e.account === undefined), board1);

// 41) 한 사람이 여러 판을 해도 한 칸만 쓰고, 점수가 내려가면 그 값으로 갱신된다
as(A); await server.leaveMatch().catch(() => {});
as(B); await server.leaveMatch().catch(() => {});
const rroom = await (async () => { as(A); return await server.createRoom(); })();
as(A); await server.setReady(true);
as(B);
await server.joinRoomByCode(rroom.code);
await server.setReady(true);
await server.$roomTick(300, rroom.roomId);
const rs = await $global.getRoomState(rroom.roomId);
age(rroom.roomId);
as(A); const revA = await server.reportResult(rs.slots['0xBBB'], 0); // 이번엔 밥이 이긴다
as(B); await server.reportResult(rs.slots['0xBBB'], 0);
as(A);
const board2 = await server.getLeaderboard();
check('같은 사람이 두 칸을 안 쓴다', board2.length === 2, board2);
check('내려간 점수로 갱신된다', board2.find((e) => e.name === '앨리스').rating === revA.rating, board2);

// 42) 봇전도 순위표에 올라간다. **인구가 적으면 거의 매 판이 봇전이라**
//     (`SOLO_FALLBACK_MS`) 여기서 빼면 표가 통째로 빈다.
userStates.set('0xCCC', { ...defaultsFor('0xCCC'), name: '캐럴', rating: 1300 });
await soloMatch(C, 1);
as(A);
const boardSolo = await server.getLeaderboard();
check('봇전 승리도 순위표에 오른다', boardSolo.some((e) => e.name === '캐럴'), boardSolo);
// 1300 대 1300: 기대승률 0.5 → +4
check('순위표 점수도 봇전 결과를 반영한다', boardSolo.find((e) => e.name === '캐럴').rating === 1304, boardSolo);

// 43) 표는 `BOARD_SIZE`(50)에서 잘린다
collections.set('rankings', new Map());
globalState = {
  ...globalState,
  board: Array.from({ length: 50 }, (_, i) => ({ account: `0xF${i}`, name: `봇${i}`, rating: 9000 + i })),
};
as(A); await server.leaveMatch().catch(() => {});
as(B); await server.leaveMatch().catch(() => {});
as(A);
const croom = await server.createRoom();
await server.setReady(true);
as(B);
await server.joinRoomByCode(croom.code);
await server.setReady(true);
await server.$roomTick(300, croom.roomId);
const cs = await $global.getRoomState(croom.roomId);
age(croom.roomId);
as(A); await server.reportResult(cs.slots['0xAAA'], 0);
as(A);
const board3 = await server.getLeaderboard();
check('상한(50명)을 안 넘는다', board3.length === 50, board3.length);
check('점수가 모자라면 표에 못 든다', board3.every((e) => e.name !== '앨리스'), board3);

// 44) 짧게 끝난 판은 점수에 안 센다 (MIN_RATED_MS). 코인과 전적은 그대로 준다.
//     막으려는 것: 부계정이 즉시 항복하고 본계정이 점수를 먹는 경로.
globalState = { ...globalState, board: [] };
collections.set('rankings', new Map());
as(A); await server.leaveMatch().catch(() => {});
as(B); await server.leaveMatch().catch(() => {});
userStates.set('0xAAA', { ...defaultsFor('0xAAA'), name: '앨리스', rating: 1000 });
userStates.set('0xBBB', { ...defaultsFor('0xBBB'), name: '밥', rating: 1000 });
as(A);
const qroom = await server.createRoom();
await server.setReady(true);
as(B);
await server.joinRoomByCode(qroom.code);
await server.setReady(true);
await server.$roomTick(300, qroom.roomId);
// 방금 시작한 판을 곧바로 보고한다 (경과 ≈ 0ms). 길이만 짧게 두고 친구 방 표시는 뗀다 —
// 여기서 보는 것은 "짧아서 점수가 안 움직인다"이지 "친구 방이라 아무것도 안 준다"가 아니다.
open(qroom.roomId);
as(A);
const quick = await server.reportResult((await $global.getRoomState(qroom.roomId)).slots['0xAAA'], 3);
check('짧은 판은 점수가 안 움직인다', quick.rating === 1000, quick.rating);
check('그래도 코인은 준다 = 100 + 3*8', quick.coins === 124, quick.coins);
check('전적도 쌓인다', quick.wins === 1, quick);
as(A);
check('짧은 판은 순위표에도 안 오른다', (await server.getLeaderboard()).length === 0, await server.getLeaderboard());

// 45) 20초를 넘긴 판은 정상적으로 점수가 움직인다 (같은 방을 손으로 늙힌다)
as(A); await server.leaveMatch().catch(() => {});
as(B); await server.leaveMatch().catch(() => {});
userStates.set('0xAAA', { ...defaultsFor('0xAAA'), name: '앨리스', rating: 1000 });
userStates.set('0xBBB', { ...defaultsFor('0xBBB'), name: '밥', rating: 1000 });
as(A);
const lroom2 = await server.createRoom();
await server.setReady(true);
as(B);
await server.joinRoomByCode(lroom2.code);
await server.setReady(true);
await server.$roomTick(300, lroom2.roomId);
age(lroom2.roomId); // 30초 전에 시작한 판
as(A);
const slow = await server.reportResult(rooms.get(lroom2.roomId).state.slots['0xAAA'], 0);
check('긴 판은 점수가 움직인다 1000 → 1016', slow.rating === 1016, slow.rating);
as(A);
check('긴 판은 순위표에 오른다', (await server.getLeaderboard()).some((e) => e.name === '앨리스'), await server.getLeaderboard());

// 46) 시작한 적 없는 방에는 보고를 못 한다
as(C); await server.leaveMatch().catch(() => {});
const fake = await server.createRoom();
check('시작 전 방에 보고하면 거부', (await server.reportResult(1, 12)) === false);

// 47) 양쪽이 다른 승자를 대면 기록에 남는다 (지불은 안 바꾼다 — 가릴 방법이 없다)
as(A); await server.leaveMatch().catch(() => {});
as(B); await server.leaveMatch().catch(() => {});
as(A);
const droom = await server.createRoom();
await server.setReady(true);
as(B);
await server.joinRoomByCode(droom.code);
await server.setReady(true);
await server.$roomTick(300, droom.roomId);
const ds = await $global.getRoomState(droom.roomId);
age(droom.roomId);
as(A); await server.reportResult(ds.slots['0xAAA'], 0); // 나는 내가 이겼다
as(B); await server.reportResult(ds.slots['0xBBB'], 0); // 상대도 자기가 이겼다
const dsAfter = await $global.getRoomState(droom.roomId);
check('서로 다른 승자를 대면 resultMismatch', dsAfter.resultMismatch === true, dsAfter.resultMismatch);
check('양쪽 신고가 남는다', Object.keys(dsAfter.reports || {}).length === 2, dsAfter.reports);

// 48) 유료(VX) 종류 — 코인으로 못 사고, 소유 없이 못 입는다
const G = { account: '0xGGG', roomId: null };
as(G);
await server.getAccount();
let perr = null;
try { await server.buyUnitKind('beergang_rainbow'); } catch (e) { perr = e.message; }
check('유료 종류는 코인으로 못 산다', perr === '코인으로 살 수 없습니다', perr);
perr = null;
try { await server.selectUnitKind('beergang_rainbow'); } catch (e) { perr = e.message; }
check('소유 없이 유료 종류를 못 입는다', perr === '가지고 있지 않습니다', perr);
const invalidVx = await server.$onItemPurchased({ account: '0xGGG', purchaseId: 'bad-1', productId: 'beergang_gold' });
check('유료 목록에 없는 상품은 지급하지 않는다', invalidVx.success === false, invalidVx);

// 49) Verse8가 검증한 구매 이벤트만 소유를 연다. 코인은 게임 계정에서 안 깎인다.
const before49 = (await server.getAccount()).coins;
const purchase49 = await server.$onItemPurchased({
  account: '0xGGG', purchaseId: 'vx-purchase-1', productId: 'beergang_rainbow', quantity: 1,
});
check('Verse8 구매 이벤트를 처리한다', purchase49.success === true, purchase49);
const granted = await server.getAccount();
check('소유가 열린다', granted.entitlements.includes('beergang_rainbow'), granted.entitlements);
check('코인은 안 깎인다', granted.coins === before49, { now: granted.coins, before49 });
const wornVx = await server.selectUnitKind('beergang_rainbow');
check('열린 뒤에는 입는다', wornVx.unitKind === 'beergang_rainbow', wornVx.unitKind);
await server.$onItemPurchased({ account: '0xGGG', purchaseId: 'vx-purchase-1', productId: 'beergang_rainbow' });
const twice49 = await server.getAccount();
check('두 번 열어도 한 칸만', twice49.entitlements.length === 1, twice49.entitlements);
check('같은 거래 ID를 한 번만 기록한다', twice49.vxPurchaseIds.length === 1, twice49.vxPurchaseIds);

// 50) 저장본이 오염돼도 유료 소유를 자칭 못 한다
userStates.set('0xGGG', {
  ...defaultsFor('0xGGG'),
  unitKind: 'beergang_rainbow',
  entitlements: ['beergang_rainbow', 'beergang_rainbow', 'nonsense'],
});
const vxClean = await server.getAccount();
check('중복·모르는 항목이 걸러진다', JSON.stringify(vxClean.entitlements) === JSON.stringify(['beergang_rainbow']), vxClean.entitlements);

// 51) 광고 코인 — **검증 없이 바로 지급** (B안). 남은 게이트는 30초 쿨다운 하나.
// 하루 상한은 제거했다 (2026-08-04, 사용자 지시: SDM처럼 "다 봤는데 안 됨"을 없앤다).
const H = { account: '0xHHH', roomId: null };
as(H);
userStates.set('0xHHH', { ...defaultsFor('0xHHH'), coins: 0 });

const ad1 = await server.claimAdCoins('req-1');
check('광고 보상 = +200 (검증 없이 바로)', ad1.coins === 200, ad1.coins);

// 쿨다운 — 바로 다시 부르면 거절한다 ("연타" 만 막는다).
let aerr = null;
try { await server.claimAdCoins('req-2'); } catch (e) { aerr = e.message; }
check('연달아 부르면 거절 (쿨다운)', aerr === 'ad_cooldown', aerr);

// 쿨다운이 지나면 다시 받는다. 빈 requestId 로도 된다 (검증을 안 하므로).
userStates.set('0xHHH', { ...userStates.get('0xHHH'), adAt: 0 });
const adAgain = await server.claimAdCoins('');
check('쿨다운 지나면 다시 받는다 (빈 requestId 로도)', adAgain.coins === 400, adAgain.coins);

// **하루 상한이 없다.** 쿨다운만 비켜 주면 몇 번이든 받는다.
for (let i = 0; i < 20; i++) {
  userStates.set('0xHHH', { ...userStates.get('0xHHH'), adAt: 0 });
  await server.claimAdCoins(`req-many-${i}`);
}
check('하루 상한 없음 — 20번 더 받아도 안 막힘', (await server.getAccount()).coins === 400 + 20 * 200, (await server.getAccount()).coins);

// 52) 광고 2배 — 서버가 지불한 금액을 그대로 한 번 더, 판당 한 번. 검증 없음.
as(A); await server.leaveMatch().catch(() => {});
as(B); await server.leaveMatch().catch(() => {});
userStates.set('0xAAA', { ...defaultsFor('0xAAA'), name: '앨리스', coins: 0 });
as(A);
const droom2 = await server.createRoom();
await server.setReady(true);
as(B);
await server.joinRoomByCode(droom2.code);
await server.setReady(true);
await server.$roomTick(300, droom2.roomId);
age(droom2.roomId);
const ds2 = await $global.getRoomState(droom2.roomId);
as(A);
const won = await server.reportResult(ds2.slots['0xAAA'], 5);
check('승리 보상 = 100 + 5*8', won.coins === 140, won.coins);

const dbl = await server.claimDoubleReward('req-double');
check('광고 2배 = 140 + 지불액 140', dbl.coins === 280, dbl.coins);
let derr = null;
try { await server.claimDoubleReward('req-double-2'); } catch (e) { derr = e.message; }
check('판당 한 번만', derr === 'already_claimed', derr);

// 53) 보상을 안 받은 사람은 2배도 못 받는다
as(C); await server.leaveMatch().catch(() => {});
const eroom2 = await server.createRoom();
let cerr = null;
try { await server.claimDoubleReward('req-c'); } catch (e) { cerr = e.message; }
check('안 끝난 판에서는 거절', cerr === 'not_finished_match', cerr);

// 54) 제작자 팔로우 보상 — 계정당 한 번, 서버가 팔로우 여부를 직접 본다
//
// **`$sender.isFollower` 가 이 기능의 전부다.** 클라이언트가 보낼 값이 없으므로
// 위조할 통로 자체가 없다 (광고 보상이 클라이언트를 믿는 것과 다르다).
// `F` 는 위(§ 방 코드)에서 이미 만든 계정이다. 팔로우 상태만 얹어 쓴다.
F.isFollower = false;
as(F);
await server.leaveMatch().catch(() => {});
userStates.set('0xFFF', { ...defaultsFor('0xFFF'), coins: 100 });

let ferr = null;
try { await server.claimFollowReward(); } catch (e) { ferr = e.message; }
check('팔로우 안 했으면 거절', ferr === 'not_following', ferr);
check('거절이 코인을 안 건드린다', (await server.getAccount()).coins === 100);

// 55) 팔로우 상태 조회 — **화면 그리기 전용이다.**
//
// 클라이언트가 팔로우 여부를 알 방법이 없어서 버튼에 뭘 쓸지 정할 수가 없었다.
// 이 함수가 그걸 알려 준다. **락을 안 쓴다** — 읽기뿐이고, 값이 조금 낡아도
// 손해가 없다. 실제 지급은 `claimFollowReward` 가 자기 락 안에서 `$sender.isFollower`
// 를 다시 읽으므로, 여기가 틀려도 코인이 새지 않는다.
const st0 = await server.getFollowState();
check('조회: 팔로우 안 했고 안 받음', st0.isFollower === false && st0.followRewarded === false, st0);

// 팔로우하고 왔다.
F.isFollower = true;
const st1 = await server.getFollowState();
check('조회: 팔로우했지만 아직 안 받음', st1.isFollower === true && st1.followRewarded === false, st1);
check('조회가 코인을 안 건드린다', (await server.getAccount()).coins === 100);

const followed = await server.claimFollowReward();
check('팔로우 보상 = 100 + 500', followed.coins === 600, followed.coins);
check('받았다는 표시가 남는다', followed.followRewarded === true, followed.followRewarded);

const st2 = await server.getFollowState();
check('조회: 받은 뒤에는 followRewarded 가 참', st2.followRewarded === true, st2);

ferr = null;
try { await server.claimFollowReward(); } catch (e) { ferr = e.message; }
check('두 번은 못 받는다', ferr === 'already_claimed', ferr);
check('두 번째가 코인을 안 건드린다', (await server.getAccount()).coins === 600);

// 팔로우를 끊어도 이미 받은 것은 회수하지 않는다 — 되돌릴 근거가 없고,
// 회수하면 '받았다 뺏겼다'가 되어 더 나쁘다.
F.isFollower = false;
check('팔로우를 끊어도 코인은 그대로', (await server.getAccount()).coins === 600);
// 조회는 지금 팔로워가 아니라고 정직하게 말한다. 화면은 `followRewarded` 를 먼저 보므로
// '받음'으로 잠긴 채 남고, 팔로우하러 가라고 다시 보내지 않는다.
const st3 = await server.getFollowState();
check('조회: 끊으면 isFollower 는 거짓, 받은 표시는 유지', st3.isFollower === false && st3.followRewarded === true, st3);
check('기본 계정은 아직 안 받은 상태', defaultsFor('0xZZZ').followRewarded === undefined);

// 락 안에서 돈다 (코인을 건드리는 경로는 전부 그래야 한다).
check('팔로우 보상이 계정 락 안에서 돈다', lockCalls.includes('acct:0xFFF'), lockCalls.slice(-3));

// 54) 친구 방(private)은 아무것도 안 준다 — 코인도 점수도 전적도, 순위표도.
//     둘이 짜고 번갈아 져 주면 무엇이든 무한히 불릴 수 있어서다.
//     **`age` 대신 `startedAt` 만 당긴다** — 길이 조건은 맞춰 두고 `private` 하나가
//     원인임이 드러나야 한다 (`age` 는 private 도 같이 뗀다).
collections.set('rankings', new Map());
as(A); await server.leaveMatch().catch(() => {});
as(B); await server.leaveMatch().catch(() => {});
userStates.set('0xAAA', { ...defaultsFor('0xAAA'), name: '앨리스', rating: 1000, coins: 0 });
userStates.set('0xBBB', { ...defaultsFor('0xBBB'), name: '밥', rating: 1000, coins: 0 });
as(A);
const proom = await server.createRoom();
await server.setReady(true);
as(B);
await server.joinRoomByCode(proom.code);
await server.setReady(true);
await server.$roomTick(300, proom.roomId);
check('코드 방은 private 로 남아 있다', rooms.get(proom.roomId).state.private === true);
rooms.get(proom.roomId).state.startedAt = Date.now() - 30000; // 길이만 채운다
const ps = await $global.getRoomState(proom.roomId);
as(A);
const privWin = await server.reportResult(ps.slots['0xAAA'], 7);
check('친구 방 승리는 코인이 0', privWin.coins === 0, privWin.coins);
check('친구 방 승리는 점수가 안 움직인다', privWin.rating === 1000, privWin.rating);
check('친구 방 승리는 전적에 안 쌓인다', privWin.wins === 0 && privWin.draws === 0, privWin);
as(B);
const privLose = await server.reportResult(ps.slots['0xAAA'], 2);
check('친구 방 패배도 코인이 0', privLose.coins === 0, privLose.coins);
check('친구 방 패배도 전적에 안 쌓인다', privLose.losses === 0, privLose);
as(A);
check('친구 방은 순위표에도 안 오른다', (await server.getLeaderboard()).length === 0);
// 지불액이 0이라 광고 2배도 탈 것이 없다 — 그쪽에 따로 조건을 안 달아도 막힌다.
let pderr = null;
try { await server.claimDoubleReward('req-priv'); } catch (e) { pderr = e.message; }
check('친구 방은 광고 2배도 못 탄다', pderr === 'no_reward', pderr);

// 55) 순위표가 프로필 카드용 값을 함께 내려준다. **따로 조회를 안 만들려는 것이다** —
//     상세를 계정에서 읽으려면 남의 계정 주소를 클라이언트에 내려야 한다.
collections.set('rankings', new Map());
as(A); await server.leaveMatch().catch(() => {});
as(B); await server.leaveMatch().catch(() => {});
userStates.set('0xAAA', {
  ...defaultsFor('0xAAA'), name: '앨리스', rating: 1200, profile: 'gold',
  ownedUnits: ['beergang_gold'], unitKind: 'beergang_gold',
  ownedTowers: ['tower_keep'], towerKind: 'tower_keep',
});
userStates.set('0xBBB', { ...defaultsFor('0xBBB'), name: '밥', rating: 1000 });
as(A);
const croom2 = await server.createRoom();
await server.setReady(true);
as(B);
await server.joinRoomByCode(croom2.code);
await server.setReady(true);
await server.$roomTick(300, croom2.roomId);
age(croom2.roomId);
const cs2 = await $global.getRoomState(croom2.roomId);
as(A); await server.reportResult(cs2.slots['0xAAA'], 4);
as(B); await server.reportResult(cs2.slots['0xAAA'], 1);
as(A);
const cardBoard = await server.getLeaderboard();
const mineRow = cardBoard.find((e) => e.name === '앨리스');
check('아바타가 실려 온다', mineRow.profile === 'gold', mineRow);
check('착용 유닛이 실려 온다', mineRow.unitKind === 'beergang_gold', mineRow);
check('착용 타워가 실려 온다', mineRow.towerKind === 'tower_keep', mineRow);
check('전적이 실려 온다', mineRow.wins === 1 && mineRow.losses === 0, mineRow);
check('계정 id는 여전히 안 내려간다', cardBoard.every((e) => e.account === undefined), cardBoard);

// 옛 기록(필드가 붙기 전에 오른 줄)은 빈 문자열로 내려간다 — 화면이 기본값으로 떨어뜨린다.
collections.get('rankings').set('legacy-1', {
  __id: 'legacy-1', account: '0xZZZ', name: '옛사람', rating: 1100,
});
const mixed = await server.getLeaderboard();
const legacy = mixed.find((e) => e.name === '옛사람');
check('옛 기록은 프로필 필드가 빈 문자열', legacy.profile === '' && legacy.unitKind === '' && legacy.towerKind === '', legacy);
check('옛 기록의 전적은 0', legacy.wins === 0 && legacy.losses === 0, legacy);

// 56) 순위표를 열면 **이미 표에 있는 내 칸**이 지금 계정 값으로 맞춰진다.
//     상점에서 갈아입어도 다음 판까지 옛 장비가 보이던 것을 고친 것이다.
collections.set('rankings', new Map());
as(A); await server.leaveMatch().catch(() => {});
as(B); await server.leaveMatch().catch(() => {});
userStates.set('0xAAA', {
  ...defaultsFor('0xAAA'), name: '앨리스', rating: 1200,
  ownedUnits: ['beergang_gold'], ownedTowers: ['tower_keep'],
});
userStates.set('0xBBB', { ...defaultsFor('0xBBB'), name: '밥', rating: 1000 });
as(A);
const froom = await server.createRoom();
await server.setReady(true);
as(B);
await server.joinRoomByCode(froom.code);
await server.setReady(true);
await server.$roomTick(300, froom.roomId);
age(froom.roomId);
const fsB = await $global.getRoomState(froom.roomId);
as(A); await server.reportResult(fsB.slots['0xAAA'], 3);
as(B); await server.reportResult(fsB.slots['0xAAA'], 1);

// 판이 끝난 시점의 값 — 아직 기본 장비다.
as(A);
const beforeSwap = (await server.getLeaderboard()).find((e) => e.name === '앨리스');
check('판 뒤에는 그때 장비가 실린다', beforeSwap.unitKind === DEFAULT_UNIT_KIND, beforeSwap);

// 판을 안 하고 상점에서 갈아입기만 한다.
await server.selectUnitKind('beergang_gold');
await server.selectTowerKind('tower_keep');
await server.setName('앨리스2');
const afterSwap = (await server.getLeaderboard()).find((e) => e.name === '앨리스2');
check('순위표를 열면 갈아입은 유닛이 바로 보인다', afterSwap.unitKind === 'beergang_gold', afterSwap);
check('타워도 바로 보인다', afterSwap.towerKind === 'tower_keep', afterSwap);
check('바꾼 이름도 따라온다', !!afterSwap, afterSwap);
check('칸이 늘어나지 않는다', (await server.getLeaderboard()).length === 2);

// **표에 없는 사람은 열어도 안 들어간다.** 넣어 버리면 점수가 낮아 못 든 사람까지
// 전부 컬렉션에 쌓이고, `BOARD_SIZE` 는 읽기 제한이라 표가 계속 커진다.
const H2 = { account: '0xJJJ', roomId: null };
as(H2);
await server.getAccount();
await server.setName('구경꾼');
const afterPeek = await server.getLeaderboard();
check('표에 없는 사람은 열어도 안 들어간다', afterPeek.length === 2, afterPeek.map((e) => e.name));
check('구경꾼은 표에 없다', afterPeek.every((e) => e.name !== '구경꾼'), afterPeek.map((e) => e.name));

// ── 보고 ────────────────────────────────────────────────────────
const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : '  ← ' + JSON.stringify(r.extra)}`);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
