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
  async getGlobalState() {
    return globalState;
  },
  async updateGlobalState(patch) {
    globalState = { ...globalState, ...patch };
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
    return [...rooms.keys()];
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
  speedLevel: 0, ownedUnits: [], unitKind: DEFAULT_UNIT_KIND,
  soloWins: 0, soloLosses: 0, soloDraws: 0,
});
$global.getUserStateOf = async (a) => userStates.get(a) ?? null;

const A = { account: '0xAAA', roomId: null };
const B = { account: '0xBBB', roomId: null };
const C = { account: '0xCCC', roomId: null };
const as = (s) => (sender = s);

/**
 * 방을 `ms` 전에 시작한 것으로 만든다.
 *
 * `MIN_RATED_MS`(20초)보다 짧게 끝난 판은 점수가 안 움직인다. 하네스는 판을 실제로
 * 돌리지 않고 곧바로 결과를 보고하므로, **점수를 보는 검사는 전부 방을 늙혀야 한다.**
 */
function age(roomId, ms = 30000) {
  rooms.get(roomId).state.startedAt = Date.now() - ms;
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
check('슬롯이 계정 순으로 1,2', started.slots['0xAAA'] === 1 && started.slots['0xBBB'] === 2, started.slots);
check('입력 지연이 방 상태에 실린다', started.inputDelayTicks === 12);

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
check('클라이언트가 보낸 player 를 서버 값으로 덮는다', relayed.message.commands[0].player === 2, relayed.message.commands[0]);
check('ackTick 이 기록된다', (await $global.getRoomState('room-1')).players['0xBBB'].ackTick === 42);

// 7) 빈 배치도 통과해야 한다 (상대가 진행할 수 있게)
as(A);
const emptyOk = await server.sendInputs({ execTick: 45 });
check('빈 배치도 받는다', emptyOk === true);
check('빈 배치도 ackTick 을 올린다', (await $global.getRoomState('room-1')).players['0xAAA'].ackTick === 45);

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
await server.reportResult(1);
const fin = await $global.getRoomState('room-1');
check('결과가 기록된다', fin.phase === 'finished' && fin.winner === '0xAAA' && fin.winnerSlot === 1, fin);
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
await server.$roomTick(300, r6.roomId);
check('기다린 지 얼마 안 됐으면 그대로 대기', (await $global.getRoomState(r6.roomId)).phase === 'waiting');
rooms.get(r6.roomId).state.players['0xAAA'].joinedAt = Date.now() - 20000;
await server.$roomTick(300, r6.roomId);
const solo = await $global.getRoomState(r6.roomId);
check('오래 기다리면 봇전 확정', solo.phase === 'playing' && solo.solo === true, solo);
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

// 23) 상점 강화 단계를 서버가 잘라 슬롯 번호로 내려준다
as(A); await server.leaveMatch();
as(B); await server.leaveMatch();
as(C); await server.leaveMatch().catch(() => {});
userStates.set('0xAAA', { ...defaultsFor('0xAAA'), speedLevel: 3 });
userStates.set('0xBBB', { ...defaultsFor('0xBBB'), speedLevel: 99 }); // 상한을 넘겨 저장돼 있다
as(A);
const lv = await server.createRoom();
await server.setReady(true);
as(B);
await server.joinRoomByCode(lv.code);
await server.setReady(true);
await server.$roomTick(300, lv.roomId);
const lvState = await $global.getRoomState(lv.roomId);
check('시작 시 levels 가 내려온다', lvState.levels != null, lvState);
check('A는 슬롯1/3단계', lvState.slots['0xAAA'] === 1 && lvState.levels[1] === 3, lvState.levels);
check('B의 99단계는 5로 잘린다', lvState.slots['0xBBB'] === 2 && lvState.levels[2] === 5, lvState.levels);

// 24) 음수·문자열도 0으로 떨어진다
as(A); await server.leaveMatch();
as(B); await server.leaveMatch();
userStates.set('0xAAA', { ...defaultsFor('0xAAA'), speedLevel: -4 });
userStates.set('0xBBB', { ...defaultsFor('0xBBB'), speedLevel: 'hax' });
as(A);
const lv2 = await server.createRoom();
await server.setReady(true);
as(B);
await server.joinRoomByCode(lv2.code);
await server.setReady(true);
await server.$roomTick(300, lv2.roomId);
const s2 = await $global.getRoomState(lv2.roomId);
check('음수는 0', s2.levels[1] === 0, s2.levels);
check('문자열은 0', s2.levels[2] === 0, s2.levels);

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
check('A는 슬롯1/보라 (산 것)', uks.slots['0xAAA'] === 1 && uks.kinds[1] === 'beergang_purple', uks.kinds);
check('B는 안 산 금색을 자칭 못 한다', uks.slots['0xBBB'] === 2 && uks.kinds[2] === 'beergang', uks.kinds);
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

// 25) 계정이 서버에 산다 — 앞 테스트에 안 쓰인 새 계정으로 본다
const D = { account: '0xDDD', roomId: null };
as(D);
let acct = await server.getAccount();
check('처음 부르면 기본 계정이 생긴다', acct.coins === 0 && acct.speedLevel === 0 && acct.unitKind === DEFAULT_UNIT_KIND, acct);

// 26) 코인이 모자라면 못 산다
let e2 = null;
try { await server.buyUpgrade('speed'); } catch (e) { e2 = e.message; }
check('코인 없으면 강화 거부', e2 === '코인이 모자랍니다', e2);

// 27) 코인을 넣고 사면 서버가 깎는다
userStates.set('0xDDD', { ...acct, coins: 1000 });
acct = await server.buyUpgrade('speed');
check('강화 1단계 구매: 1000 - 300', acct.coins === 700 && acct.speedLevel === 1, acct);
acct = await server.buyUpgrade('speed');
check('강화 2단계 구매: 700 - 700', acct.coins === 0 && acct.speedLevel === 2, acct);
e2 = null;
try { await server.buyUpgrade('speed'); } catch (e) { e2 = e.message; }
check('잔액 0이면 거부', e2 === '코인이 모자랍니다', e2);

// 28) 유닛 구매/착용
//
// 2026-07-31에 BeerGang 색 변형 4종이 들어와 **구매 경로가 다시 살아났다**
// (2026-07-30 ~ 07-31 사이에는 값 0짜리 하나뿐이라 거부 경로만 지켰다).
userStates.set('0xDDD', { ...acct, coins: 500 });
e2 = null;
try { await server.buyUnitKind(DEFAULT_UNIT_KIND); } catch (e) { e2 = e.message; }
check('값 0짜리는 살 수 없다 (이미 가진 것)', e2 === '이미 가지고 있습니다', e2);
e2 = null;
try { await server.buyUnitKind('lancer'); } catch (e) { e2 = e.message; }
check('카탈로그에 없는 유닛 구매 거부', e2 === '그런 유닛이 없습니다', e2);
e2 = null;
try { await server.selectUnitKind('lancer'); } catch (e) { e2 = e.message; }
check('카탈로그에 없는 유닛 착용 거부', e2 === '그런 유닛이 없습니다', e2);
acct = await server.selectUnitKind(DEFAULT_UNIT_KIND);
check('기본 유닛은 언제나 착용 가능', acct.unitKind === DEFAULT_UNIT_KIND, acct);

// 코인 500으로 400짜리는 사지고 900짜리는 안 사져야 한다
acct = await server.buyUnitKind('beergang_white');
check(
  '흰 비어갱 400 구매: 500 - 400, 자동 착용',
  acct.coins === 100 && acct.unitKind === 'beergang_white' && acct.ownedUnits.includes('beergang_white'),
  acct,
);
e2 = null;
try { await server.buyUnitKind('beergang_gold'); } catch (e) { e2 = e.message; }
check('잔액 100으로 900짜리 거부', e2 === '코인이 모자랍니다', e2);
e2 = null;
try { await server.buyUnitKind('beergang_white'); } catch (e) { e2 = e.message; }
check('이미 산 것을 또 못 산다', e2 === '이미 가지고 있습니다', e2);
e2 = null;
try { await server.selectUnitKind('beergang_purple'); } catch (e) { e2 = e.message; }
check('안 가진 유닛 착용 거부', e2 === '가지고 있지 않습니다', e2);
acct = await server.selectUnitKind(DEFAULT_UNIT_KIND);
check('기본으로 되돌아가도 코인은 그대로', acct.coins === 100 && acct.unitKind === DEFAULT_UNIT_KIND, acct);
acct = await server.selectUnitKind('beergang_white');
check('산 것은 다시 입어도 공짜', acct.coins === 100 && acct.unitKind === 'beergang_white', acct);

// 29) 손으로 고친 계정은 정규화된다
userStates.set('0xDDD', {
  coins: -50, speedLevel: 99, unitKind: 'dragon',
  // `pawn` 은 카탈로그에서 빠진 옛 유닛이다 — 이것도 걸러져야 한다.
  ownedUnits: [DEFAULT_UNIT_KIND, DEFAULT_UNIT_KIND, 'pawn', 'bogus'],
});
acct = await server.getAccount();
check('음수 코인은 0', acct.coins === 0, acct);
check('과한 강화 단계는 상한으로', acct.speedLevel === 5, acct);
check('모르는 유닛 착용은 기본으로', acct.unitKind === DEFAULT_UNIT_KIND, acct);
check(
  '소유 목록에서 중복·카탈로그에 없는 값 제거',
  JSON.stringify(acct.ownedUnits) === JSON.stringify([DEFAULT_UNIT_KIND]),
  acct.ownedUnits,
);

// 30) setReady 가 클라이언트 값을 안 믿고 서버 계정을 읽는다
as(A); await server.leaveMatch().catch(() => {});
as(B); await server.leaveMatch().catch(() => {});
userStates.set('0xAAA', { ...defaultsFor('0xAAA'), speedLevel: 4 });
userStates.set('0xBBB', { ...defaultsFor('0xBBB'), speedLevel: 1 });
as(A);
const forge = await server.createRoom();
await server.setReady(true, 5); // 클라이언트가 5를 자칭한다
as(B);
await server.joinRoomByCode(forge.code);
await server.setReady(true, 5);
await server.$roomTick(300, forge.roomId);
const fs = await $global.getRoomState(forge.roomId);
check('위조한 강화 단계가 안 먹는다 (A=4)', fs.levels[fs.slots['0xAAA']] === 4, fs.levels);
check('상대도 서버 값 (B=1)', fs.levels[fs.slots['0xBBB']] === 1, fs.levels);

// 31) 보상은 서버가 준다. 양쪽 다 받고, 두 번은 안 준다
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
check('봇전은 solo 전적으로 간다', paidC.soloWins === 1 && paidC.wins === 0, paidC);

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
// 1100 대 1000, K=8. 기대승률 0.6403 → round(8 × 0.3597) = +3
check('봇전 승리 1100 → 1103', soloWin.rating === 1103, soloWin.rating);
userStates.set('0xCCC', { ...defaultsFor('0xCCC'), name: '캐럴', rating: 1100 });
const soloLoss = await soloMatch(C, 2);
// 지는 쪽이 이기는 쪽보다 크다 — 봇보다 점수가 높으니 이기는 게 당연한 판이다
check('봇전 패배 1100 → 1095', soloLoss.rating === 1095, soloLoss.rating);

// 37-b) 천장. 점수가 오를수록 봇을 이겨서 얻는 것이 줄고, 결국 0이 된다 —
//       파밍을 따로 막는 장치가 없는 이유가 이것이다 (`BOT_RATING` 주석).
userStates.set('0xCCC', { ...defaultsFor('0xCCC'), name: '캐럴', rating: 1500 });
const capped = await soloMatch(C, 1);
check('1500점에서는 봇을 이겨도 안 오른다', capped.rating === 1500, capped.rating);

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
// 1300 대 1000: 기대승률 0.8490 → round(8 × 0.1510) = +1
check('순위표 점수도 봇전 결과를 반영한다', boardSolo.find((e) => e.name === '캐럴').rating === 1301, boardSolo);

// 43) 표는 10명에서 잘린다
globalState = {
  ...globalState,
  board: Array.from({ length: 10 }, (_, i) => ({ account: `0xF${i}`, name: `봇${i}`, rating: 9000 + i })),
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
check('10명을 안 넘는다', board3.length === 10, board3.length);
check('점수가 모자라면 표에 못 든다', board3.every((e) => e.name !== '앨리스'), board3);

// 44) 짧게 끝난 판은 점수에 안 센다 (MIN_RATED_MS). 코인과 전적은 그대로 준다.
//     막으려는 것: 부계정이 즉시 항복하고 본계정이 점수를 먹는 경로.
globalState = { ...globalState, board: [] };
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
// 방금 시작한 판을 곧바로 보고한다 (경과 ≈ 0ms)
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
perr = null;
try { await server.grantEntitlement('beergang_gold'); } catch (e) { perr = e.message; }
check('유료 목록에 없는 항목은 못 연다', perr === '그런 항목이 없습니다', perr);

// 49) 소유가 열리면 입을 수 있다. 코인은 안 깎인다 — 결제는 Verse8 쪽에서 끝났다
const before49 = (await server.getAccount()).coins;
const granted = await server.grantEntitlement('beergang_rainbow');
check('소유가 열린다', granted.entitlements.includes('beergang_rainbow'), granted.entitlements);
check('코인은 안 깎인다', granted.coins === before49, { now: granted.coins, before49 });
const wornVx = await server.selectUnitKind('beergang_rainbow');
check('열린 뒤에는 입는다', wornVx.unitKind === 'beergang_rainbow', wornVx.unitKind);
const twice49 = await server.grantEntitlement('beergang_rainbow');
check('두 번 열어도 한 칸만', twice49.entitlements.length === 1, twice49.entitlements);

// 50) 저장본이 오염돼도 유료 소유를 자칭 못 한다
userStates.set('0xGGG', {
  ...defaultsFor('0xGGG'),
  unitKind: 'beergang_rainbow',
  entitlements: ['beergang_rainbow', 'beergang_rainbow', 'nonsense'],
});
const vxClean = await server.getAccount();
check('중복·모르는 항목이 걸러진다', JSON.stringify(vxClean.entitlements) === JSON.stringify(['beergang_rainbow']), vxClean.entitlements);

// ── 보고 ────────────────────────────────────────────────────────
const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : '  ← ' + JSON.stringify(r.extra)}`);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
