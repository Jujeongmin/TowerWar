/**
 * TowerWar — Verse8(Agent8) 게임 서버.
 *
 * 규약 (docs.verse8.io/ko/docs/gameserver/sdk/server.js):
 *   - 파일명은 정확히 `server.js`, 저장소 루트에 있어야 한다
 *   - `class Server` 를 정의만 하고 **절대 export 하지 않는다** (module.exports / export default 금지)
 *   - `setTimeout` / `setInterval` 금지. 주기 작업은 `$roomTick` 으로
 *   - **클래스 변수는 요청마다 초기화된다.** 그래서 이 파일에는 상태를 들지 않는다 —
 *     모든 상태는 룸 상태에만 산다
 *   - 배포: `npx -y @agent8/deploy`
 *
 * ── 이 파일이 하는 것과 안 하는 것 ─────────────────────────────
 *
 * **한다**: 매치메이킹(1v1 방 잡기), 준비/시작, 시드와 플레이어 번호 합의,
 * 명령 릴레이, 결과 집계, 데싱크 감지.
 * **안 한다**: 시뮬레이션. 아직 서버 권위가 아니다.
 *
 * 지금은 **결정론적 락스텝**이다. 양쪽 클라이언트가 같은 시드로 같은 `sim/` 코드를 돌리고,
 * 서버는 명령을 상대에게 넘겨주기만 한다. `sim/` 이 브라우저 API를 안 쓰는 이유가 이것이고,
 * 봇 명령 자리에 이 릴레이가 그대로 들어간다 — 시뮬레이션은 명령이 봇에서 왔는지
 * 네트워크에서 왔는지 구분하지 못한다.
 *
 * 서버 권위로 올리려면 `sim/` 을 이 파일에서 돌려야 하는데, 그때 걸리는 것이 두 가지다:
 *   1. `$roomTick` 주기가 200~1000ms 라 30Hz 틱을 그대로 못 돈다 (틱을 몰아서 돌려야 한다)
 *   2. 이 파일은 단일 JS라 `game/src/sim/*.ts` 를 import 할 수 없다.
 *      SDK의 "구조화된 서버 프로젝트"(server/src/server.ts)로 옮겨야 한다
 * 둘 다 별도 작업이다.
 *
 * ── 왜 틱 번호로 명령을 예약하는가 ─────────────────────────────
 *
 * remote function 호출이 **초당 약 10회로 제한된다.** 30Hz 시뮬레이션의 매 틱마다
 * 명령을 보내는 것은 불가능하다. 그래서 클라이언트는 명령을 모아 ~100ms 마다 한 번 보내고,
 * 각 배치에 **실행할 틱 번호**를 붙인다. 벽시계가 아니라 틱 번호로 맞추기 때문에
 * 양쪽의 시작 시각이 조금 어긋나도 결과가 갈라지지 않는다.
 *
 * 상대 입력을 기다려야 하므로 `INPUT_DELAY_TICKS` 만큼 앞선 틱에 예약한다.
 * **명령이 없는 배치도 보내야 한다** — 그게 "이 틱까지 내 명령은 없다"는 신호이고,
 * 없으면 상대가 그 지점에서 멈춘다.
 *
 * ── 상태를 전부 룸 상태에 두는 이유 ────────────────────────────
 *
 * `$roomTick(deltaMillis, roomId)` 에는 요청 맥락이 없어서 `$sender` 도 `$room` 도 못 쓴다.
 * 룸을 지목해 읽는 것은 `$global.getRoomState(roomId)` 뿐이다. 그래서 준비 상태·마지막
 * 수신 시각까지 전부 룸 상태의 `players` 맵에 넣는다 — 룸 유저 상태에 두면 `$roomTick`
 * 에서 읽을 방법이 문서에 없다.
 */

/** 1v1. 방이 이보다 차면 새 방을 판다. */
const ROOM_MAX_USER = 2;

/**
 * 명령을 몇 틱 뒤에 실행할 것인가. 30Hz 기준 12틱 = 0.4초.
 *
 * **게임 속도가 아니라 조작 반응이다.** 시뮬레이션은 언제나 30틱/초로 돈다. 이 값은
 * 클릭에서 명령이 먹히기까지의 지연이고, 내 명령도 상대와 똑같이 예약해야 결정론이
 * 유지되기 때문에 존재한다 (`net/lockstep.ts` 머리말).
 *
 * 배치 주기(전송 130ms)에 왕복 지연을 더한 값보다 커야 한다. 작으면 상대 입력이
 * 제때 안 와서 판이 멈추고(late batch), 크면 조작이 굼떠진다.
 *
 * **배속이 이 예산을 실시간으로 깎는다.** 12틱은 1배속 400ms 지만 1.5배속에선 267ms,
 * 2배속에선 200ms 다 (틱이 그만큼 빨리 지나므로).
 *
 * 12 → 15 로 올렸다가(5740b32) **다시 12로 내렸다** (2026-08-06 사용자 지시). 올렸던
 * 이유는 배속 정지였는데, 진짜 원인은 예산이 아니라 **정지에서 못 빠져나오는 것**이었고
 * 그건 `lockstep.pump` 에서 고쳤다 (HANDOFF §-67). 이제 정지가 나도 풀리므로 조작
 * 반응을 되찾는 쪽을 택한다. 그래도 정지가 잦으면 15로 되돌리는 것이 손잡이다.
 */
const INPUT_DELAY_TICKS = 12;

/** 몇 틱마다 상태 해시를 비교할 것인가. 30Hz 기준 30틱 = 1초. */
const DESYNC_CHECK_TICKS = 30;

/**
 * 상대가 이 시간(ms) 넘게 아무 배치도 안 보내면 끊긴 것으로 본다.
 * `$roomTick` 이 200~1000ms 주기라 그보다 넉넉해야 한다.
 *
 * **재연결 복구(`rejoinRoom`)가 끝날 시간을 줘야 한다.** SDK 재연결이 백오프로
 * 1·2·4초를 쓰고, 클라이언트가 정지를 알아채 `rejoinRoom` 을 부르기까지 또 몇 초가
 * 걸린다. 10초로는 복구되기 전에 방이 부전패로 닫혔다 — 20초로 늘렸다 (2026-08-06).
 * 클라이언트의 포기 타이머(`STALL_GIVEUP_MS`)는 이 값보다 커야 서버가 먼저 정한다.
 */
const PEER_TIMEOUT_MS = 20000;

/**
 * 혼자 이만큼 기다리면 봇전으로 확정한다.
 *
 * **이 판정을 클라이언트가 하면 안 된다.** "아무도 없네" 하고 나가는 그 순간 상대가
 * 방에 들어올 수 있고, 그러면 `leaveMatch` 가 상대 판을 부전승으로 끝내 버려서
 * 상대는 시작하자마자 영문 모를 승리 화면을 본다. 서버가 한 곳에서 정하면 경합이 없다.
 */
const SOLO_FALLBACK_MS = 12000;

/** 시작도 못 하고 이만큼 방치된 방은 닫는다. */
const LOBBY_TIMEOUT_MS = 120000;

const PHASE_WAITING = 'waiting';
const PHASE_PLAYING = 'playing';
const PHASE_FINISHED = 'finished';

/** 클라이언트가 구독할 메시지 타입. 문자열을 양쪽에서 하드코딩하지 않게 여기 모은다. */
const MSG_INPUTS = 'tw.inputs';

/**
 * 친구에게 불러 주는 방 코드.
 *
 * `I`·`O` 를 뺐다 — `1`/`l`, `0` 과 섞인다. 숫자도 `2~9` 만 쓴다.
 * 32자 4칸이면 약 105만 조합이고, 코드는 살아 있는 방에서만 유일하면 되므로 충분하다.
 *
 * **코드를 방 ID로 그대로 쓰지 않는다.** `$global.joinRoom()` 에 없는 ID를 넘겼을 때
 * 방이 만들어지는지가 문서에 없다. 미검증 동작에 걸지 않고, 코드 → 실제 방 ID 표를
 * 글로벌 상태에 둔다. 등록되는 것은 코드 방뿐이라 표가 크게 자라지 않는다.
 */
const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ROOM_CODE_LEN = 4;

/** 코드 발급은 반드시 락 안에서. 두 사람이 같은 코드를 잡으면 남의 방에 끼어든다. */
const CODE_LOCK = 'towerwar:roomcode';

// ── 계정 ──────────────────────────────────────────────────────────
//
// 재화와 강화가 **서버에 산다.** 전에는 클라이언트의 localStorage 가 유일한 저장소라
// 콘솔에서 코인을 고쳐 쓸 수 있었고, PVP 강화도 클라이언트가 보낸 숫자를 그대로 믿었다.
//
// 유저 상태는 **덮어쓰기**다 (글로벌 상태의 병합과 다르다). 그래서 저장할 때마다
// 계정 객체 전체를 쓴다 — 일부 필드만 넘기면 나머지가 날아갈 수 있다.

/**
 * 유닛 생김새 가격. **`game/src/units.ts` 의 `UNIT_KIND_META` 와 같아야 한다.**
 * 어긋나면 "상점에는 보이는데 못 입는" 또는 그 반대가 된다.
 *
 * 2026-07-31에 BeerGang 색 변형 4종이 붙었다 (하의·머리 색만 다르다).
 */
// **2026-08-09에 전부 5배로 올렸다** (사용자 지시 — "지금 너무 싸다").
// 400/900/1500/2400 이던 것이 승리 3~16판이면 다 모여서 목표가 안 됐다.
// **보상은 안 건드렸다** — 같이 올리면 상쇄되어 아무것도 안 바뀐다.
const UNIT_PRICES = {
  beergang: 0,
  beergang_white: 2000,
  beergang_gold: 4500,
  beergang_green: 7500,
  beergang_purple: 12000,
};

/**
 * 타워 외형 가격. **`game/src/towers.ts` 의 `TOWER_KIND_META.price` 와 같아야 한다.**
 * 어긋나면 "상점에는 보이는데 못 사는" 또는 그 반대가 된다.
 *
 * **속도 값은 여기 없다.** 서버는 이름만 내려주고 이름 → 배수 변환은 클라이언트가
 * 한다 — 공식을 양쪽에 복사하면 언젠가 어긋나고, 어긋나면 두 클라이언트가 다른 판을 돈다.
 */
// **`lv` 번호 순이 아니다.** 사다리가 오두막 → 석탑 → 집 → 병영 → 성채다
// (2026-08-07 사용자 지시 — 석탑이 병영 뒤에 오면 좁아서 약해 보인다).
// 이름은 안 옮겼으니 값만 보고 순서를 짐작하지 말 것.
// 유닛과 같은 사다리다 — 2026-08-09에 함께 5배로 올렸다.
const TOWER_PRICES = {
  tower_hut: 0,
  tower_keep: 2000,
  tower_house: 4500,
  tower_barracks: 7500,
  tower_citadel: 12000,
};

/** 코인으로 못 사는 타워. `UNIT_PRICES`/`PREMIUM_UNITS` 와 같은 이유로 갈라 둔다. */
const PREMIUM_TOWERS = ['tower_prime'];

/** `game/src/towers.ts` 의 `DEFAULT_TOWER_KIND` 와 같아야 한다. */
const DEFAULT_TOWER_KIND = 'tower_hut';

function isKnownTower(v) {
  return (
    typeof v === 'string' &&
    (Object.prototype.hasOwnProperty.call(TOWER_PRICES, v) || PREMIUM_TOWERS.includes(v))
  );
}

/** 모르는 값은 기본 외형으로 떨어뜨린다. 여기서 던지면 판이 안 열린다. */
function cleanTowerKind(v) {
  return isKnownTower(v) ? v : DEFAULT_TOWER_KIND;
}

/**
 * 코인으로 못 사는 유료 종류. 사는 곳은 Verse8 CrossRamp 상점이다.
 *
 * `UNIT_PRICES` 와 갈라 두는 이유: `cleanUnitKind` 가 `UNIT_PRICES` 로 "아는 종류인가"를
 * 판정하는데, 여기 값을 거기 넣으면 **코인 0원짜리로 읽혀 누구나 살 수 있게 된다.**
 */
const PREMIUM_UNITS = ['beergang_rainbow'];

/**
 * 열 수 있는 유료 항목 전부. **유닛만 있는 게 아니다** — 배속(`tempo_boost`)처럼
 * 종류가 아닌 것도 있다.
 *
 * `PREMIUM_UNITS` 와 갈라 두는 이유: `cleanUnitKind` 가 "아는 유닛인가"를 판정하는데
 * 여기 값을 그쪽에 넣으면 `tempo_boost` 가 입을 수 있는 유닛이 된다.
 */
const TEMPO_ITEM = 'tempo_boost';
// `PREMIUM_TOWERS` 도 결제 지급(`$onItemPurchased`) 대상이다 — 안 넣으면 유료 타워를
// 사도 서버가 모르는 상품이라며 지급을 거절한다.
const PREMIUM_ITEMS = [...PREMIUM_UNITS, ...PREMIUM_TOWERS, TEMPO_ITEM];

/**
 * **디버그: 소유 판정을 통째로 연다** (2026-08-03 사용자 지시).
 *
 * `game/src/account/account.ts` 의 같은 이름과 **반드시 같이 켜고 끈다.** 한쪽만 켜면
 * 상점은 '착용하기'를 보여 주는데 서버가 거절해서 눌러도 아무 일이 안 일어난다 —
 * 실제로 그 버그를 한 번 냈다.
 *
 * 코인·강화·점수는 안 건드린다. 여기서 여는 것은 **가졌는가**뿐이다.
 *
 * 출시 전에 양쪽 다 `false` 로 되돌릴 것.
 */
// **지금 꺼져 있다** (2026-08-07 에 되돌렸다). 실물에서 유료 항목을 입어 보려면
// 여기를 `typeof __TW_NO_DEBUG_UNLOCK === 'undefined'` 로 되돌리고 클라이언트도 같이
// 켠다 — 클라만 켜면 상점은 '착용하기'를 보여 주는데 서버가 거절해서 눌러도 아무 일이
// 안 일어난다. 그렇게 켰을 때 검증 하네스는 `__TW_NO_DEBUG_UNLOCK` 으로 다시 끄고
// 돌린다 (`tools/server-harness.mjs`) — 켜 둔 채로 재면 "안 산 것을 못 입는다" 같은
// 검사가 통째로 무의미해진다.
const DEBUG_UNLOCK_ALL = false;

function isKnownUnit(v) {
  return (
    Object.prototype.hasOwnProperty.call(UNIT_PRICES, v) || PREMIUM_UNITS.includes(v)
  );
}
/** `game/src/units.ts` 의 `DEFAULT_UNIT_KIND` 와 같아야 한다. */
const DEFAULT_UNIT_KIND = 'beergang';

/**
 * 방 상태에 실을 유닛 종류를 거른다. 모르는 값은 기본값으로 떨어뜨린다.
 *
 * **힘 수치(`units.ts` 의 `power`)는 여기 복사하지 않는다.** 서버가 아는 것은 종류
 * 이름뿐이고, 이름 → 힘 변환은 클라이언트에만 있다. 공식을 양쪽에 두면 언젠가 어긋나고,
 * 어긋나는 순간 두 클라이언트가 서로 다른 판을 돈다 (§-9에서 `speedMulFor` 에 같은 판단을
 * 했다). 서버가 막아야 하는 것은 **안 산 종류를 자칭하는 것**이고 그건
 * `cleanAccount` 가 이미 한다.
 */
function cleanUnitKind(v) {
  // `in` 이 아니라 hasOwnProperty 다 — `'toString'` 같은 상속 키가 통과하면 안 된다.
  return isKnownUnit(v) ? v : DEFAULT_UNIT_KIND;
}

/** 매치 보상. `account.ts` 의 값과 같아야 한다. */
const REWARD_WIN = 100;
const REWARD_DRAW = 50;
const REWARD_LOSS = 30;
const REWARD_PER_TOWER = 8;
/** 한 판에서 들고 있을 수 있는 타워 수 상한. 보고가 부풀려져도 여기서 잘린다. */
const MAX_TOWERS = 12;

// ── 보상형 광고 ──────────────────────────────────────────────────
//
// **서버 사이드 검증(ads-verifier)을 안 쓴다** (2026-08-04, 사용자 결정). §-55에서
// 넣었던 비동기 검증이 광고 직후 `pending` 에 걸려(서버가 setTimeout 을 못 써 딜레이
// 재시도를 못 함) 실물 광고를 끝까지 봐도 보상이 안 나갔다. 랜덤디펜스(같은 계정의
// 다른 게임)가 검증 없이 잘 돌므로 그 방식으로 맞췄다 — 클라이언트가 `rewarded` 를
// 받은 뒤에만 청구가 오고 서버는 바로 지급한다.
//
// **여전히 서버가 쥐는 것**: 금액(클라이언트가 액수를 못 보냄), 간격(쿨다운),
// 하루 상한. "무한"은 막고 "봤는지"만 안 본다. 트레이드오프는 각 메서드 주석 참고.

/**
 * 광고 한 번에 주는 코인.
 *
 * **60 → 200 으로 올렸다** (2026-08-09 사용자 지시). 상품 가격이 5배가 되면서
 * 60은 사실상 없는 것과 같아졌다.
 *
 * 한 판 값(승리 100)보다 커졌지만 **판이 여전히 훨씬 빠르다** — 광고는 30분
 * 쿨다운이라 시간당 400이 한계인데, 90초짜리 판은 시간당 수천이다. 광고는
 * 어디까지나 판 사이를 메우는 보조다.
 */
const AD_COINS = 200;

/**
 * 제작자를 팔로우하면 주는 코인. **계정당 한 번뿐이다** (`followRewarded` 가 자물쇠).
 *
 * 광고 코인(200)보다 큰 이유: 광고는 30분마다 반복되지만 이건 평생 한 번이다.
 *
 * **원래는 사다리 첫 칸(그때 400)을 바로 살 수 있는 값이었다.** 2026-08-09에 가격이
 * 5배가 되면서 첫 칸이 2000이 되어 그 뜻이 사라졌다 — 지금은 "판 서너 번어치를
 * 앞당겨 준다" 정도다. 같이 올릴지는 아직 정하지 않았다.
 */
const FOLLOW_REWARD_COINS = 500;
/**
 * 광고 사이 최소 간격(ms). **30분** (2026-08-04 사용자 지시). 하루 상한을 없앤 뒤
 * 남은 유일한 게이트라, 이게 코인 총량을 정한다(30분마다 200 = 시간당 최대 400).
 * **클라이언트도 이 값을 알아야** 버튼 안에 남은 시간을 표시한다
 * (`game/src/account/account.ts` 의 `AD_COOLDOWN_MS` 와 맞춰 둘 것). */
const AD_COOLDOWN_MS = 30 * 60 * 1000;

function num(v) {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

/** 아는 유료 항목만 남기고 중복을 없앤다. 모르는 값이 저장본에 쌓이지 않게. */
function cleanEntitlements(v) {
  if (!Array.isArray(v)) return [];
  return [...new Set(v.filter((x) => PREMIUM_ITEMS.includes(x)))];
}

/** `num()` 과 달리 값이 없을 때 0이 아니라 지정한 기본값으로 떨어진다 (레이팅 기본값용). */
function numOr(v, fallback) {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : fallback;
}


// ── PVP 점수 (Elo) ───────────────────────────────────────────────
//
// 화면에는 이 숫자가 그대로 나간다. 티어 구간을 뒀다가 걷어냈다 (2026-08-01, 사용자
// 지시) — 되살리지 말 것. 구간이 있으면 같은 티어 안의 변동이 안 보여서 점수를 봐도
// 올랐는지 내렸는지 모른다.

/** 새 계정의 시작 점수. `game/src/account/account.ts` 의 같은 이름과 맞춰 둔다. */
const DEFAULT_RATING = 1000;
/** 한 판의 최대 변동폭. 표준 Elo 값이다. 승률 반영 속도를 조절하려면 이 값만 만지면 된다. */
const RATING_K = 32;

/**
 * 봇의 가상 점수는 매 경기 플레이어의 현재 점수와 같다.
 * 봇전 변동폭은 K=8이므로 승리 +4, 무승부 0, 패배 -4로 일정하다.
 */
const RATING_K_SOLO = 8;

/** 표준 Elo 기대승률. */
function eloExpected(mine, theirs) {
  return 1 / (1 + Math.pow(10, (theirs - mine) / 400));
}

/**
 * 한 판 뒤 변동량(반올림 정수). `score` 는 승 1 / 무 0.5 / 패 0.
 *
 * **`±k` 로 한 번 더 자른다.** 수식상 이미 그 안에 들어오지만, 점수 스냅샷이 어딘가에서
 * 이상한 값으로 오염되면(옛 룸 상태, 손댄 저장본) 한 판에 사다리가 통째로 뒤집힌다.
 * 자르는 비용이 0이라 그냥 잘라 둔다.
 */
function eloDelta(mine, theirs, score, k) {
  const raw = Math.round(k * (score - eloExpected(mine, theirs)));
  return Math.max(-k, Math.min(k, raw));
}

/**
 * 매칭 때 허용하는 점수 차. **오래 기다린 방일수록 넓어진다** — §-1이 "강화 폭이
 * 판을 끝낸다"에 남겨 둔 완화책이 이것이다(전투력 기반 매치메이킹). 실력차가 큰
 * 상대와 즉시 붙지 않게 막다가, 그래도 안 되면 봇전보다는 사람과 붙는 쪽을 우선한다.
 *
 * 마지막 칸을 `Infinity` 로 둔 것은 `SOLO_FALLBACK_MS`(12000) 전에 사실상 누구든
 * 받도록 하기 위해서다 — 사람과 붙을 여지를 봇 폴백 직전까지 최대로 준다.
 */
const RATING_BAND_STEPS = [
  // 첫 칸이 ±100 이었는데, 12초짜리 창에서 그 폭으로 첫 3번을 헛돌면 남는 기회가
  // 얼마 없다. 사람이 붙을 확률이 봇전보다 값지고, 맵이 완전 대칭이라 점수 차가
  // 곧 유불리도 아니다 — ±150 으로 조금 넓힌다 (2026-08-06 사용자 지시).
  { afterMs: 0, band: 150 },
  { afterMs: 4000, band: 250 },
  { afterMs: 8000, band: 600 },
  { afterMs: 10000, band: Infinity },
];

function ratingBandFor(waitedMs) {
  let band = RATING_BAND_STEPS[0].band;
  for (const step of RATING_BAND_STEPS) if (waitedMs >= step.afterMs) band = step.band;
  return band;
}

/**
 * 순위표에 남기는 인원.
 *
 * 전체 계정을 훑어 정렬하는 방법은 안 쓴다. Verse8 유저 상태에는 "전부 읽기"가 없고,
 * 있더라도 계정 수에 비례해 느려진다. 판이 끝날 때마다 이 크기의 표를 고치는 편이 싸다.
 *
 * **10 → 50 으로 늘렸다** (2026-08-09 사용자 지시). 화면이 상위 3명을 시상대로 크게
 * 세우고 나머지를 스크롤 목록으로 보여주게 바뀌어서, 10명이면 목록이 일곱 줄뿐이라
 * 스크롤이 생기지 않는다. 한 줄이 여덟 필드(프로필 카드용)라 50줄이라도 응답이 작다.
 */
const BOARD_SIZE = 50;
/** Verse8 Global Collection used for scalable sorting/filtering. */
const BOARD_COLLECTION = 'rankings';

/**
 * 이 시간(ms)보다 짧게 끝난 판은 **점수에 안 센다.** 코인과 전적은 그대로 준다.
 *
 * 서버가 시뮬레이션을 안 돌려서 승패를 클라이언트 보고로 믿는다(§7의 "서버 권위" 항목).
 * 그 상태에서 가장 싼 치팅이 **부계정이 즉시 항복하고 본계정이 점수를 먹는 것**이다 —
 * 판 하나가 몇 초면 끝나므로 사다리를 통째로 밀어 올릴 수 있다.
 *
 * 값의 근거(실측, `sim/` 을 헤드리스로 30시드씩 돌려 잼):
 *   - 양쪽이 다 싸운 판의 최단 결판 **48.8초**
 *   - 한쪽이 아무 명령도 안 낸 판(가장 빨리 쓸리는 경우)의 최단 **32.4초**
 *
 * 그래서 10초 밑으로 끝나는 판은 **정상 플레이로는 안 나온다.** 유일하게 걸리는 것이
 * 초반 항복승인데, 그건 막으려는 바로 그 경로다. "상대가 10초 안에 나가떨어진 판은
 * 점수에 안 센다"는 규칙 자체가 납득 가능하기도 하다.
 *
 * **10초로 내렸다** (2026-08-04 사용자 지시). 위 실측(최단 결판 32~48초)을 보면 10초든
 * 20초든 정상 판은 다 넘으므로, 초반 항복 치팅을 막는 효과는 같고 문턱만 낮아진다.
 */
const MIN_RATED_MS = 10000;

/** 닉네임 길이 상한. 화면 상단 HUD에 들어가야 해서 짧게 잡는다. */
const NAME_MAX = 12;

/**
 * 고를 수 있는 프로필 아바타. **클라이언트의 `src/profiles.ts` 와 같아야 한다.**
 *
 * 서버가 목록을 들고 있는 이유: 없는 id를 저장해 두면 상대 화면에서 아바타가
 * 영원히 안 뜨고, 왜 안 뜨는지 알 방법이 없다. 여기서 걸러 기본값으로 떨어뜨린다.
 *
 * 2026-07-31에 캐릭터 고르기가 **배경색 고르기**로 바뀌었다 — 그림은 BeerGang 하나로
 * 고정이고 id 는 뒤에 깔리는 원의 색이다. 옛 id(`bayc`·`ryan` 등)는 여기서 걸러져
 * 기본값으로 떨어진다.
 */
const PROFILE_IDS = [
  'slate',
  'blue',
  'cyan',
  'green',
  'gold',
  'orange',
  'red',
  'purple',
  'pink',
];

/** `game/src/profiles.ts` 의 `DEFAULT_PROFILE` 과 같아야 한다. */
const DEFAULT_PROFILE = 'slate';

function cleanProfile(v) {
  return PROFILE_IDS.includes(v) ? v : DEFAULT_PROFILE;
}

/**
 * 닉네임 정리. **클라이언트와 서버가 같은 규칙을 쓴다** — 화면에 보이는 것과
 * 저장되는 것이 다르면 왜 이름이 바뀌었는지 알 수가 없다.
 *
 * 제어문자를 지우는 이유: 줄바꿈이나 방향 제어 문자가 들어오면 HUD가 깨진다.
 */
function cleanName(v) {
  return String(v ?? '')
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NAME_MAX);
}

function defaultAccount(account) {
  return {
    account,
    name: '',
    profile: DEFAULT_PROFILE,
    coins: 0,
    wins: 0,
    losses: 0,
    draws: 0,
    ownedUnits: [],
    // `units.ts` 의 DEFAULT_UNIT_KIND 와 같아야 한다. 어긋나면 접속하는 순간
    // 서버 값이 클라이언트를 덮어써서(§-10) 상점에서 고른 것이 되돌아간 것처럼 보인다.
    unitKind: DEFAULT_UNIT_KIND,
    ownedTowers: [],
    towerKind: DEFAULT_TOWER_KIND,
    // 봇 대체는 화면에 안 알리지만(§-7) 전적은 갈라 둔다.
    // 안 그러면 나중에 밸런스를 볼 때 표본이 뭐였는지 알 수 없다.
    soloWins: 0,
    soloLosses: 0,
    soloDraws: 0,
    // 점수(Elo). 봇전도 현재 플레이어와 동점인 상대로 계산한다.
    rating: DEFAULT_RATING,
    // 유료(VX)로 열린 것들. 코인으로 산 `ownedUnits` 와 갈라 둔다 — 획득 경로가 다르고,
    // 코인 목록에 섞으면 환불·초기화 때 무엇이 유료였는지 구분이 안 된다.
    entitlements: [],
    // VXShop purchase IDs already applied. Prevents duplicate webhook delivery.
    vxPurchaseIds: [],
    // 광고 보상 기록. 마지막으로 받은 시각과, 그날 몇 번 받았는지.
    adAt: 0,
    adCount: 0,
    adDay: 0,
    // 이미 보상으로 쓴 광고 requestId. 같은 광고 시청 하나로 두 번(또는
    // claimAdCoins·claimDoubleReward 양쪽) 받는 것을 막는다. vxPurchaseIds와 같은 자물쇠.
    adRequestIds: [],
    // 제작자 팔로우 보상을 받았는가. **계정당 한 번**의 자물쇠다 (`claimFollowReward`).
    followRewarded: false,
  };
}

/** 저장된 값이 깨졌거나 손으로 고쳐졌어도 말이 되는 계정으로 만든다. */
function normalizeAccount(raw, account) {
  const d = defaultAccount(account);
  if (!raw || typeof raw !== 'object') return d;
  // `in` 이 아니라 hasOwnProperty 다 — `'toString'` 같은 상속 키가 통과하면 안 된다
  // (`cleanUnitKind` 의 같은 주석 참고).
  const owned = Array.isArray(raw.ownedUnits)
    ? [...new Set(raw.ownedUnits.filter((k) => Object.prototype.hasOwnProperty.call(UNIT_PRICES, k)))]
    : [];
  const entitlements = cleanEntitlements(raw.entitlements);
  const kind = isKnownUnit(raw.unitKind) ? raw.unitKind : DEFAULT_UNIT_KIND;
  // 위 ownedUnits 와 같은 이유로 hasOwnProperty 다.
  const ownedTowers = Array.isArray(raw.ownedTowers)
    ? [...new Set(raw.ownedTowers.filter((k) => Object.prototype.hasOwnProperty.call(TOWER_PRICES, k)))]
    : [];
  const tkind = isKnownTower(raw.towerKind) ? raw.towerKind : DEFAULT_TOWER_KIND;
  return {
    account,
    name: cleanName(raw.name),
    profile: cleanProfile(raw.profile),
    coins: num(raw.coins),
    wins: num(raw.wins),
    losses: num(raw.losses),
    draws: num(raw.draws),
    ownedUnits: owned,
    // 안 가진 것이 착용돼 있으면 기본으로 되돌린다.
    unitKind: UNIT_PRICES[kind] === 0 || owned.includes(kind) || entitlements.includes(kind)
      ? kind
      : DEFAULT_UNIT_KIND,
    ownedTowers,
    // 안 가진 것이 착용돼 있으면 기본으로 되돌린다. 유닛과 같은 규칙이다.
    towerKind: TOWER_PRICES[tkind] === 0 || ownedTowers.includes(tkind) || entitlements.includes(tkind)
      ? tkind
      : DEFAULT_TOWER_KIND,
    soloWins: num(raw.soloWins),
    soloLosses: num(raw.soloLosses),
    soloDraws: num(raw.soloDraws),
    // 없으면(마이그레이션 전 계정) 0이 아니라 기본 점수로 떨어진다 — `num()` 은
    // 여기 못 쓴다. 0은 "많이 져서 0점"과 "한 번도 안 쟀음"을 구분 못 한다.
    rating: numOr(raw.rating, DEFAULT_RATING),
    entitlements,
    vxPurchaseIds: Array.isArray(raw.vxPurchaseIds)
      ? [...new Set(raw.vxPurchaseIds.filter((id) => typeof id === 'string'))].slice(-50)
      : [],
    adAt: num(raw.adAt),
    adCount: num(raw.adCount),
    adDay: num(raw.adDay),
    adRequestIds: Array.isArray(raw.adRequestIds)
      ? [...new Set(raw.adRequestIds.filter((id) => typeof id === 'string'))].slice(-50)
      : [],
    followRewarded: raw.followRewarded === true,
  };
}

function makeRoomCode() {
  let out = '';
  for (let i = 0; i < ROOM_CODE_LEN; i++) {
    out += ROOM_CODE_ALPHABET[Math.floor(Math.random() * ROOM_CODE_ALPHABET.length)];
  }
  return out;
}

/** 손으로 친 코드를 받아들인다. 대문자화하고 알파벳 밖 문자는 버린다. */
function normalizeRoomCode(raw) {
  return String(raw || '')
    .toUpperCase()
    .split('')
    .filter((c) => ROOM_CODE_ALPHABET.includes(c))
    .join('')
    .slice(0, ROOM_CODE_LEN);
}

class Server {
  // ── 매치메이킹 ─────────────────────────────────────────────────

  /** 연결 확인용. 배포가 실제로 반영됐는지 보는 데 쓴다. */
  ping() {
    return { ok: true, at: Date.now(), account: $sender.account };
  }

  // ── 계정 ───────────────────────────────────────────────────────

  /** 내 계정. 없으면 만들어서 돌려준다. */
  async getAccount() {
    return await this.#loadAccount();
  }

  /**
   * 상위 `BOARD_SIZE` 명. 점수 내림차순이고, 부른 사람 자신은 `me` 로 표시된다 —
   * **이름은 안 겹치는 값이 아니라서** 클라이언트가 이름으로 자기를 찾으면 안 된다.
   *
   * 계정 id는 안 내려준다. 순위 표시에 필요 없고, 내려주면 남의 계정 주소가 퍼진다.
   */
  async getLeaderboard() {
    await this.#migrateLegacyBoard();
    // 내 칸을 먼저 최신으로 맞추고 읽는다. 안 그러면 방금 갈아입은 장비가 다음 판까지
    // 안 보인다 (2026-08-09 사용자 지시).
    await this.#refreshMyBoardRow();
    const rows = await $global.getCollectionItems(BOARD_COLLECTION, {
      orderBy: [{ field: 'rating', direction: 'desc' }],
      limit: BOARD_SIZE,
    });
    return rows.map((e) => ({
      name: cleanName(e.name),
      rating: numOr(e.rating, DEFAULT_RATING),
      me: e.account === $sender.account,
      // 프로필 카드용. **옛 기록에는 없다** — 표는 점수가 움직일 때만 갱신되므로
      // 이 필드가 붙기 전에 오른 사람은 다음 판까지 비어 있다. 클라이언트가 기본값으로
      // 떨어뜨린다 (그림 폴백과 같은 규칙).
      profile: typeof e.profile === 'string' ? e.profile : '',
      unitKind: typeof e.unitKind === 'string' ? e.unitKind : '',
      towerKind: typeof e.towerKind === 'string' ? e.towerKind : '',
      wins: num(e.wins),
      losses: num(e.losses),
    }));
  }

  /**
   * 닉네임 설정. 정리 규칙은 `cleanName` 이고 **클라이언트도 같은 규칙을 쓴다** —
   * 화면에 보이는 것과 저장되는 것이 다르면 왜 이름이 바뀌었는지 알 수가 없다.
   *
   * 빈 이름은 거부한다. 상대에게 빈칸으로 보이면 누구와 붙었는지 알 수 없다.
   */
  async setName(name) {
    const clean = cleanName(name);
    if (clean.length === 0) throw new Error('닉네임을 입력하세요');
    const a = await this.#loadAccount();
    return await this.#saveAccount({ ...a, name: clean });
  }

  /**
   * 프로필 아바타 설정. 모르는 id는 기본값으로 떨어진다 — 던지지 않는다.
   * 아바타는 순수 외형이라 못 골랐다고 게임을 막을 이유가 없다.
   */
  async setProfile(profile) {
    const a = await this.#loadAccount();
    return await this.#saveAccount({ ...a, profile: cleanProfile(profile) });
  }

  /**
   * 전적만 초기화. **점수(rating)·코인·유닛은 그대로 둔다** (사용자 지시:
   * "전적만 초기화, 점수 초기화는 아니야"). 화면에 뜨는 승/패/무만 0으로.
   * 봇전 밸런스 분석용 solo 통계(§-7)는 안 건드린다 — 화면에 안 뜨는 별개 축이다.
   *
   * **서버가 진짜다** (§-10). 여기서 안 지우면 온라인 사용자는 로컬만 0이 됐다가
   * 다음 접속에 서버 값으로 되돌아온다.
   */
  async resetRecord() {
    return await $lock(`acct:${$sender.account}`, async () => {
      const a = await this.#loadAccount();
      return await this.#saveAccount({ ...a, wins: 0, losses: 0, draws: 0 });
    });
  }

  /** 유닛 생김새 구매. 사면 바로 착용한다. 순수 외형이라 판에는 영향이 없다. */
  async buyUnitKind(kind) {
    return await $lock(`acct:${$sender.account}`, async () => {
      const a = await this.#loadAccount();
      // 상속 키(`toString` 등)는 `UNIT_PRICES[kind]` 가 `Object.prototype` 의 함수를
      // 돌려줘 아래 `undefined`/`0`/코인 비교를 전부 피해 간다 — 먼저 막는다
      // (`isKnownUnit` 은 hasOwnProperty 기준).
      if (!isKnownUnit(kind)) throw new Error('그런 유닛이 없습니다');
      // 유료 종류는 코인으로 못 산다. 여기서 안 막으면 `UNIT_PRICES[kind]` 가
      // `undefined` 라 '그런 유닛이 없습니다' 로 새어 나가 이유가 안 읽힌다.
      if (PREMIUM_UNITS.includes(kind)) throw new Error('코인으로 살 수 없습니다');
      const price = UNIT_PRICES[kind];
      if (price === undefined) throw new Error('그런 유닛이 없습니다');
      if (price === 0 || a.ownedUnits.includes(kind)) throw new Error('이미 가지고 있습니다');
      if (a.coins < price) throw new Error('코인이 모자랍니다');
      return await this.#saveAccount({
        ...a,
        coins: a.coins - price,
        ownedUnits: [...a.ownedUnits, kind],
        unitKind: kind,
      });
    });
  }

  /** Verse8 calls this server-side after a verified VXShop purchase. */
  async $onItemPurchased({ account, purchaseId, productId }) {
    if (!account || !purchaseId || !PREMIUM_ITEMS.includes(productId)) {
      return { success: false };
    }
    await $lock(`acct:${account}`, async () => {
      const raw = await $global.getUserState(account);
      const a = normalizeAccount(raw, account);
      if (a.vxPurchaseIds.includes(purchaseId)) return;
      const entitlements = a.entitlements.includes(productId)
        ? a.entitlements
        : [...a.entitlements, productId];
      await $global.updateUserState(account, {
        ...a,
        entitlements,
        vxPurchaseIds: [...a.vxPurchaseIds, purchaseId].slice(-50),
      });
    });
    return { success: true };
  }

  /**
   * 광고를 보고 코인을 받는다.
   *
   * **서버 사이드 검증(`ads-verifier`)을 안 쓴다** (2026-08-04, 사용자 결정).
   * 클라이언트가 광고를 끝까지 본(`rewarded`) 뒤에만 이 호출이 오고, 서버는 바로
   * 지급한다 — 랜덤디펜스(같은 계정의 다른 게임)가 이 방식으로 잘 도므로 맞춘 것이다.
   *
   * 전에는 `ads-verifier` 로 비동기 검증을 했는데(§-55), 검증이 광고 직후엔 `pending`
   * 이라 딜레이 재시도가 필요했다. `server.js` 는 `setTimeout` 을 못 써서 즉시 재시도만
   * 했고, 그래서 실물 광고를 끝까지 봐도 계속 `pending` 에 걸려 보상이 안 나갔다.
   * **트레이드오프**: 조작된 클라이언트가 이 RPC를 콘솔에서 직접 부르면 광고 없이
   * 코인을 받을 수 있다. 그래도 금액·간격·하루 상한은 서버가 그대로 쥐고 있다 —
   * "무한"은 막고, "봤는지"만 안 본다.
   *
   * `requestId` 인자는 옛 시그니처 호환으로 받기만 하고 안 쓴다.
   */
  /**
   * 제작자를 팔로우한 사람에게 주는 코인. **계정당 한 번.**
   *
   * ── 이 기능이 성립하는 이유는 `$sender.isFollower` 하나다 ──────
   *
   * 팔로우 여부를 **서버가 직접 읽는다.** 클라이언트가 보낼 값이 아예 없으므로 위조할
   * 통로가 없다 — 광고 보상(`claimAdCoins`)이 "봤다"는 클라이언트 말을 믿는 것과
   * 근본적으로 다르다. 그래서 금액을 광고(60)보다 훨씬 크게 잡을 수 있다.
   *
   * **팔로우를 끊어도 회수하지 않는다.** 되돌릴 근거가 없고, 회수하면 "받았다 뺏겼다"가
   * 되어 더 나쁘다. `followRewarded` 는 "준 적이 있다"는 기록이지 "지금 팔로워다"가 아니다.
   *
   * **팔로우 다이얼로그를 여는 것은 클라이언트 몫이다.** 부모 프레임에
   * `OPEN_FOLLOW_DIALOG` 를 보내면 셸이 띄운다 (`app/settings-scene.ts`).
   * `@verse8/platform` 2.1.0 에 타입이 없고 문서에도 없어서 한동안 그런 것이 없는 줄
   * 알았다 — 다른 Verse8 게임이 쓰고 있는 것을 보고 알았다 (2026-08-07).
   * 서버는 그것과 무관하게 성립한다 — 팔로우하고 오기만 하면 이 함수가 준다.
   *
   * **기계가 읽는 코드로 던진다.** 화면 문구는 언어마다 달라야 한다 (§-40).
   */
  async claimFollowReward() {
    return await $lock(`acct:${$sender.account}`, async () => {
      const a = await this.#loadAccount();
      if (a.followRewarded) throw new Error('already_claimed');
      // **락 안에서 읽는다.** 밖에서 읽고 들어오면 그 사이에 값이 바뀔 수 있다.
      if (!$sender.isFollower) throw new Error('not_following');
      return await this.#saveAccount({
        ...a,
        coins: a.coins + FOLLOW_REWARD_COINS,
        followRewarded: true,
      });
    });
  }

  /**
   * 팔로우 상태. **화면이 버튼에 뭘 쓸지 정하려고 묻는 것이다.**
   *
   * 전에는 이걸 알 방법이 없어서 버튼이 항상 '받기'였고, 팔로우 안 한 사람은 눌러 봐야
   * `not_following` 만 받았다. 게임 안에서 팔로우하러 갈 길도 없었다 — 이제 화면이
   * `isFollower` 가 거짓이면 팔로우 페이지로 보내고, 참이면 '받기'를 띄운다.
   *
   * **락을 안 쓴다.** 읽기뿐이고, 값이 조금 낡아도 손해가 없다. 실제 지급은
   * `claimFollowReward` 가 자기 락 안에서 `$sender.isFollower` 를 **다시** 읽으므로
   * 여기가 틀려도 코인이 새지 않는다. 이 함수는 그림을 그리는 데만 쓰인다.
   *
   * **`followRewarded` 를 같이 준다.** 이미 받았으면 팔로우를 끊었더라도 '받음'으로
   * 잠긴 채 둬야 한다 — 회수하지 않기로 한 결정(`claimFollowReward`)과 짝이다.
   */
  async getFollowState() {
    const a = await this.#loadAccount();
    return { isFollower: $sender.isFollower === true, followRewarded: a.followRewarded === true };
  }

  async claimAdCoins() {
    return await $lock(`acct:${$sender.account}`, async () => {
      const a = await this.#loadAccount();
      const now = Date.now();
      // 남은 게이트는 30초 쿨다운 하나뿐이다 (하루 상한 제거, 2026-08-04).
      // **기계가 읽는 코드로 던진다.** 화면 문구는 언어마다 달라야 한다(§-40).
      if (now - a.adAt < AD_COOLDOWN_MS) throw new Error('ad_cooldown');
      return await this.#saveAccount({ ...a, coins: a.coins + AD_COINS, adAt: now });
    });
  }

  /**
   * 판이 끝난 뒤 광고를 보고 **보상을 한 번 더** 받는다 (합쳐서 2배).
   *
   * **금액은 방 상태에 적힌 값을 쓴다** (`#grantReward` 가 지불하면서 남긴다).
   * 클라이언트가 액수를 보내면 무한 코인이 되고, 다시 계산하면 그때의 타워 수를
   * 또 믿어야 한다 — 이미 서버가 잘라서 지불한 값을 그대로 한 번 더 주는 것이 가장 좁다.
   *
   * **판당 한 번.** `doubled` 가 그 자물쇠다 (`rewarded` 와 같은 방식).
   *
   * `claimAdCoins` 과 같은 이유로 **서버 사이드 광고 검증은 안 한다** (2026-08-04).
   * `requestId` 인자는 옛 시그니처 호환으로 받기만 하고 안 쓴다.
   */
  async claimDoubleReward() {
    const state = await $room.getRoomState();
    if (!state || state.phase !== PHASE_FINISHED) throw new Error('not_finished_match');

    const account = $sender.account;
    const paid = num((state.paid || {})[account]);
    if (paid <= 0) throw new Error('no_reward');

    const doubled = { ...(state.doubled || {}) };
    if (doubled[account]) throw new Error('already_claimed');

    doubled[account] = true;
    await $room.updateRoomState({ doubled });

    return await $lock(`acct:${account}`, async () => {
      const a = await this.#loadAccount();
      return await this.#saveAccount({ ...a, coins: a.coins + paid });
    });
  }

  /** 가진 것만 착용할 수 있다. */
  async selectUnitKind(kind) {
    const a = await this.#loadAccount();
    // 상속 키가 `UNIT_PRICES[kind]` 를 함수로 돌려줘 아래 검사를 피해 가지 않도록
    // 먼저 막는다 (`isKnownUnit` 은 hasOwnProperty 기준).
    if (!isKnownUnit(kind)) throw new Error('그런 유닛이 없습니다');
    if (DEBUG_UNLOCK_ALL) {
      return await this.#saveAccount({ ...a, unitKind: kind });
    }
    if (PREMIUM_UNITS.includes(kind)) {
      if (!a.entitlements.includes(kind)) throw new Error('가지고 있지 않습니다');
      return await this.#saveAccount({ ...a, unitKind: kind });
    }
    const price = UNIT_PRICES[kind];
    if (price === undefined) throw new Error('그런 유닛이 없습니다');
    if (price !== 0 && !a.ownedUnits.includes(kind)) throw new Error('가지고 있지 않습니다');
    return await this.#saveAccount({ ...a, unitKind: kind });
  }

  /**
   * 타워 외형 구매. 사면 바로 착용한다.
   *
   * **순수 외형이 아니다** — 착용한 것이 생산속도를 정한다. 그래서 소유 판정이
   * 유닛과 똑같이 서버에 있어야 한다.
   */
  async buyTowerKind(kind) {
    return await $lock(`acct:${$sender.account}`, async () => {
      const a = await this.#loadAccount();
      // 상속 키는 `TOWER_PRICES[kind]` 가 함수를 돌려줘 아래 `undefined`/`0`/코인
      // 비교를 전부 피해 간다 — 먼저 막는다 (`isKnownTower` 는 hasOwnProperty 기준).
      if (!isKnownTower(kind)) throw new Error('그런 타워가 없습니다');
      if (PREMIUM_TOWERS.includes(kind)) throw new Error('코인으로 살 수 없습니다');
      const price = TOWER_PRICES[kind];
      if (price === undefined) throw new Error('그런 타워가 없습니다');
      if (price === 0 || a.ownedTowers.includes(kind)) throw new Error('이미 가지고 있습니다');
      if (a.coins < price) throw new Error('코인이 모자랍니다');
      return await this.#saveAccount({
        ...a,
        coins: a.coins - price,
        ownedTowers: [...a.ownedTowers, kind],
        towerKind: kind,
      });
    });
  }

  /** 가진 외형만 착용할 수 있다. 유료 외형은 `entitlements` 가 소유를 든다. */
  async selectTowerKind(kind) {
    return await $lock(`acct:${$sender.account}`, async () => {
      const a = await this.#loadAccount();
      if (DEBUG_UNLOCK_ALL) {
        if (!isKnownTower(kind)) throw new Error('그런 타워가 없습니다');
        return await this.#saveAccount({ ...a, towerKind: kind });
      }
      if (PREMIUM_TOWERS.includes(kind)) {
        if (!a.entitlements.includes(kind)) throw new Error('가지고 있지 않습니다');
        return await this.#saveAccount({ ...a, towerKind: kind });
      }
      const price = TOWER_PRICES[kind];
      if (price === undefined) throw new Error('그런 타워가 없습니다');
      if (price !== 0 && !a.ownedTowers.includes(kind)) throw new Error('가지고 있지 않습니다');
      return await this.#saveAccount({ ...a, towerKind: kind });
    });
  }

  /**
   * 무작위 매칭. 대기 중이고 자리가 남은 방에 들어가거나, 없으면 새로 판다.
   *
   * `countRoomUsers` 는 **Promise를 돌려준다.** await 없이 비교하면 항상 false가 되어
   * 꽉 찬 방을 그대로 통과시킨다.
   *
   * 코드 방(`private`)은 후보에서 뺀다. 친구를 기다리는 방에 낯선 사람을 넣으면 안 된다.
   */
  /**
   * 점수가 너무 다른 상대와는 즉시 안 붙는다. 방을 만든 사람이 오래 기다렸을수록
   * 대역을 넓힌다 (`ratingBandFor`) — 실력차 매칭과 "그래도 봇보다는 사람"이라는
   * §-7의 우선순위를 함께 만족시키는 지점이다.
   *
   * 대역 밖이면 이 방은 건너뛰고 계속 찾는다. 끝까지 못 찾으면 전과 같이 내가
   * 새 대기방을 판다 — 그 방은 나중에 다른 사람의 findMatch 후보가 된다.
   */
  /**
   * 빈 방을 찾아 들어간다. 없으면 새로 판다.
   *
   * @param waitedMs  내가 지금까지 매칭을 기다린 시간. **클라이언트가 보낸 값이라
   *   `SOLO_FALLBACK_MS` 로 자른다** — 부풀려도 12초 뒤에 저절로 되는 것보다 더 얻을 게 없다.
   *   대역 판정에 **상대의 대기와 내 대기 중 큰 쪽**을 쓴다. 전에는 상대 것만 봐서,
   *   늦게 들어온 사람은 아무리 오래 기다려도 대역이 안 넓어졌다 — 두 사람이 동시에
   *   대기 중인데도 서로를 지나치는 원인이었다.
   * @param retry  주기 재시도인가. **참이면 후보가 없을 때 새 방을 안 판다** —
   *   이미 내 방에서 기다리는 중이라, 새로 파면 그때까지 쌓인 대기가 통째로 날아간다.
   *   그때는 `null` 을 돌려주고 클라이언트는 그냥 하던 대기를 이어 간다.
   */
  async findMatch(waitedMs, retry) {
    const ids = (await $global.getAllRoomIds()) || [];
    const me = await this.#loadAccount();
    const now = Date.now();
    const myWaited = Math.min(num(waitedMs), SOLO_FALLBACK_MS);
    for (const id of ids) {
      const state = await $global.getRoomState(id);
      if (state && state.private) continue;
      if (state && state.phase && state.phase !== PHASE_WAITING) continue;
      if ((await $global.countRoomUsers(id)) >= ROOM_MAX_USER) continue;

      const players = (state && state.players) || {};
      // **내가 이미 있는 방은 건너뛴다.** 재시도에서 자기 방을 다시 집으면
      // `#enterRoom` 이 `joinedAt` 을 지금으로 덮어써 대기 시간이 초기화되고,
      // 봇 폴백 타이머와 대역 확장이 함께 리셋된다.
      if (players[$sender.account]) continue;

      const creator = Object.keys(players)[0];
      if (creator) {
        const waited = Math.max(now - (players[creator].joinedAt || 0), myWaited);
        const creatorRating = numOr(players[creator].rating, DEFAULT_RATING);
        if (Math.abs(me.rating - creatorRating) > ratingBandFor(waited)) continue;
      }
      return await this.#enterRoom(id);
    }
    if (retry) return null;
    return await this.#enterRoom(undefined);
  }

  /**
   * 친구를 부를 방을 판다. 코드를 발급해 돌려준다.
   *
   * **코드 발급은 락 안에서 한다.** 두 사람이 같은 코드를 동시에 잡으면
   * 한쪽 친구가 남의 방으로 들어간다.
   *
   * 코드 방은 무작위 매칭 후보가 아니고, 봇 폴백도 받지 않는다 —
   * 친구를 기다리는 중에 판이 시작돼 버리면 코드를 준 의미가 없다.
   */
  async createRoom() {
    const entered = await this.#enterRoom(undefined);
    const code = await $lock(CODE_LOCK, async () => {
      const g = (await $global.getGlobalState()) || {};
      const codes = { ...(g.codes || {}) };
      let picked = null;
      for (let i = 0; i < 8; i++) {
        const c = makeRoomCode();
        if (!codes[c]) {
          picked = c;
          break;
        }
      }
      if (!picked) throw new Error('방 코드를 만들지 못했습니다');
      codes[picked] = entered.roomId;
      await $global.updateGlobalState({ codes });
      return picked;
    });

    await $room.updateRoomState({ code, private: true });
    return { ...entered, code };
  }

  /** 코드로 친구 방에 들어간다. 실패는 전부 던진다 — 왜 못 들어갔는지 화면에 보여야 한다. */
  async joinRoomByCode(rawCode) {
    const code = normalizeRoomCode(rawCode);
    if (code.length !== ROOM_CODE_LEN) throw new Error(`방 코드는 ${ROOM_CODE_LEN}자입니다`);

    const g = (await $global.getGlobalState()) || {};
    const roomId = (g.codes || {})[code];
    if (!roomId) throw new Error('그런 방이 없습니다');

    const state = await $global.getRoomState(roomId);
    if (state && state.phase && state.phase !== PHASE_WAITING) {
      throw new Error('이미 시작된 방입니다');
    }
    if ((await $global.countRoomUsers(roomId)) >= ROOM_MAX_USER) {
      throw new Error('방이 가득 찼습니다');
    }
    return await this.#enterRoom(roomId);
  }

  /**
   * 방을 나간다. 진행 중이던 판은 상대의 부전승으로 닫는다 —
   * 그냥 두면 남은 쪽이 오지 않는 입력을 계속 기다린다.
   */
  async leaveMatch() {
    const state = await $room.getRoomState();
    if (state) {
      const players = { ...(state.players || {}) };
      delete players[$sender.account];
      if (state.phase === PHASE_PLAYING) {
        const other = Object.keys(players)[0] ?? null;
        await $room.updateRoomState({
          phase: PHASE_FINISHED,
          winner: other,
          reason: 'left',
          endedAt: Date.now(),
          players,
        });
      } else {
        await $room.updateRoomState({ players });
      }
    }
    return await $global.leaveRoom();
  }

  /**
   * 준비 토글. 양쪽이 준비되면 다음 `$roomTick` 이 판을 시작한다.
   *
   * **판에 영향을 주는 값은 전부 서버 계정에서 읽어 방 상태에 박는다** (유닛 종류·배속).
   * 클라이언트가 각자 자기 계정을 읽어 쓰면 두 쪽이 서로 다른 보정으로 시뮬레이션해
   * 첫 틱부터 갈라지고, 클라이언트가 값을 보내면 안 산 것을 자칭할 수 있다.
   *
   * (공속 강화 단계 `speedLevel` 이 여기 있었는데, 2026-08-06에 강화를 없애면서 뺐다.
   * 생산속도를 타워 외형이 이어받으면 그 종류 이름이 유닛 종류 옆에 들어온다.)
   */
  async setReady(ready) {
    const state = (await $room.getRoomState()) || {};
    // **강화 단계는 서버 계정에서 읽는다.** 클라이언트가 보낸 값을 쓰면 만렙을 자칭할 수 있다.
    const me = await this.#loadAccount();
    await $room.updateRoomState({
      players: this.#patchPlayer(state, $sender.account, {
        ready: !!ready,
        // 유닛 종류도 서버 계정에서 읽는다. 2026-07-31부터 종류가 유닛의 힘을 정하므로
        // (`units.ts` 의 `power`) 클라이언트가 보내면 안 산 유닛의 힘을 자칭할 수 있다.
        // `#loadAccount` 가 소유 검사까지 마친 값이라 여기서 더 볼 것이 없다.
        unitKind: me.unitKind,
        // 타워 외형도 서버 계정에서 읽는다. 외형이 생산속도를 정하므로(towers.ts)
        // 클라이언트가 보내면 안 산 속도를 자칭할 수 있다.
        towerKind: me.towerKind,
        // 닉네임·아바타도 서버 계정에서 읽는다. 클라이언트가 보내면 남의 것을 자칭할 수 있다.
        name: me.name,
        profile: me.profile,
        // 매칭 대역(`findMatch`)과 매치 시작 시 점수 스냅샷(`#start`)이 이 값을 본다.
        rating: me.rating,
        // 유료 소유. `#start` 가 여기서 읽어 방 상태의 `tempo` 를 만든다.
        entitlements: me.entitlements,
        seenAt: Date.now(),
      }),
    });
    return true;
  }

  /**
   * 자동 매칭 클라이언트가 12초 대기 뒤 요청하는 AI 전환 보조 경로.
   * 클라이언트 시계는 신뢰하지 않고 서버에 기록된 joinedAt과 현재 방 상태를 다시 검사한다.
   * `$roomTick`이 지연되거나 누락돼도 이 요청으로 같은 서버 권위 판정을 실행할 수 있다.
   */
  async requestSoloFallback() {
    const roomId = $sender.roomId;
    if (!roomId) return false;

    const state = (await $room.getRoomState()) || {};
    const player = (state.players || {})[$sender.account];
    if (
      state.phase !== PHASE_WAITING ||
      state.private ||
      (await $global.countRoomUsers(roomId)) !== 1 ||
      !player ||
      !player.ready
    ) return false;

    if (Date.now() - (player.joinedAt || state.createdAt || Date.now()) < SOLO_FALLBACK_MS) {
      return false;
    }

    return await this.#startSolo(roomId, $sender.account);
  }

  // ── 판 진행 ────────────────────────────────────────────────────

  /**
   * 명령 배치. **명령이 없어도 보내야 한다** (위 주석 참고).
   *
   * @param batch.execTick  이 배치의 명령들이 실행될 틱. 클라이언트가
   *                        `현재틱 + INPUT_DELAY_TICKS` 로 계산해 보낸다
   * @param batch.commands  `sim/types.ts` 의 Command 배열. 서버는 내용을 해석하지 않는다
   * @param batch.hash      선택. 상태 해시 `{ tick, value }` — 데싱크 감지용
   *
   * 클라이언트는 `needResponse: false` 로 부르고 결과는 `MSG_INPUTS` 구독으로 받는다.
   * 응답을 기다리면 왕복이 한 번 더 붙어 입력 지연만 늘어난다.
   */
  async sendInputs(batch) {
    const state = await $room.getRoomState();
    if (!state || state.phase !== PHASE_PLAYING) return false;

    const account = $sender.account;
    const player = (state.slots || {})[account];
    if (!player) return false;

    const execTick = Math.max(0, Math.floor(Number(batch && batch.execTick) || 0));
    const commands = Array.isArray(batch && batch.commands) ? batch.commands : [];

    // 명령에 어느 쪽이 낸 것인지 서버가 박는다. 클라이언트가 보낸 player 를 믿으면
    // 남의 번호로 명령을 낼 수 있다.
    const stamped = commands.map((c) => ({ ...c, player }));
    $room.broadcastToRoom(MSG_INPUTS, { from: account, player, execTick, commands: stamped });

    // ackTick 이 "상대가 이 틱까지는 시뮬레이션해도 안전하다"는 약속이다.
    const players = this.#patchPlayer(state, account, { ackTick: execTick, seenAt: Date.now() });
    const patch = { players };
    if (batch && batch.hash) Object.assign(patch, this.#desyncPatch(state, account, batch.hash));
    await $room.updateRoomState(patch);
    return true;
  }

  /**
   * 판 도중에 소켓이 끊겼다 붙은 사람을 방에 다시 넣는다.
   *
   * **SDK 재연결은 소켓만 다시 붙인다.** `useGameServerStore` 의 재연결 경로는
   * `connect()` 하나만 다시 부르고 방 참가도 구독도 복구하지 않는다. 그래서 "Reconnection
   * successful!" 이 찍힌 뒤에도 클라이언트는 방 밖이라 배치가 오가지 않고, 화면은 멈춘 채로
   * 남는다 (2026-08-06 실기 콘솔). 클라이언트가 정지를 감지하면 이걸 부른다.
   *
   * **이 방에 슬롯이 있는 사람만 받는다.** 슬롯은 `#start` 가 정한 뒤로 안 바뀌므로,
   * 이걸로 "원래 이 판의 사람인가"가 가려진다 — 남이 남의 판에 끼어들 수 없다.
   * 인원 상한도 안 본다: 이미 자기 자리가 있는 사람이라 새로 차지하는 것이 없다.
   */
  async rejoinRoom(roomId) {
    const state = await $global.getRoomState(roomId);
    if (!state) return { ok: false, phase: null, winnerSlot: 0 };

    // **닫힌 방은 되살리지 않는다. 대신 판정을 돌려준다.**
    //
    // 끊겨 있는 동안 방이 닫히는 일이 실제로 흔하다(양쪽이 동시에 조용해지면
    // `abandoned`). 그때 `false` 만 돌려주면 클라이언트는 될 때까지 계속 재시도하고,
    // 방 상태 재구독으로도 못 알아챈다 — `subscribeRoomState` 는 **변경이 있을 때**
    // 부르는데 이미 닫힌 방에는 더 올 변경이 없다. 그래서 지금 상태를 실어 보낸다
    // (2026-08-06 실기 콘솔: 복구 8번이 25초 동안 헛돌았다).
    const phase = state.phase || null;
    if (phase !== PHASE_PLAYING) {
      return { ok: false, phase, winnerSlot: state.winnerSlot || 0 };
    }
    if (!(state.slots || {})[$sender.account]) {
      return { ok: false, phase, winnerSlot: 0 };
    }

    await $global.joinRoom(roomId);
    // `seenAt` 을 지금으로 되돌린다. 끊겨 있는 동안 안 갱신됐으므로 그대로 두면
    // 돌아오자마자 `$roomTick` 이 나를 조용한 쪽으로 보고 부전패로 닫는다.
    await $room.updateRoomState({
      players: this.#patchPlayer(state, $sender.account, { seenAt: Date.now() }),
    });
    return { ok: true, phase, winnerSlot: 0 };
  }

  /**
   * 판이 끝났다고 알린다. 먼저 도착한 보고가 결과가 된다 —
   * 결정론이 지켜졌다면 양쪽이 같은 값을 보내므로 누가 먼저든 상관없다.
   * 어긋났다면 그건 데싱크이고 `desync` 필드에 이미 잡혀 있다.
   *
   * @param winner 플레이어 번호 1 | 2, 무승부면 0
   */
  async reportResult(winner, towers) {
    const state = await $room.getRoomState();
    if (!state) return false;
    // **끝난 판에서도 받아야 한다.** 양쪽이 각자 보고하는데, 먼저 온 보고가 방을
    // finished 로 바꾼다. 여기서 거절하면 두 번째 사람은 보상을 못 받는다.
    if (state.phase !== PHASE_PLAYING && state.phase !== PHASE_FINISHED) return false;
    // 시작한 적 없는 방은 보고를 못 받는다. `#start`/`#soloStart` 만 이 값을 찍는다 —
    // 방을 만들어 놓고 곧바로 결과부터 보내는 경로를 여기서 끊는다.
    if (!state.startedAt) return false;

    const account = $sender.account;
    const slot = (state.slots || {})[account];
    if (!slot) return false;

    const rewarded = { ...(state.rewarded || {}) };
    const first = !rewarded[account];
    rewarded[account] = true;

    const said = Number(winner) || 0;
    // 양쪽이 서로 다른 승자를 댔다. 결정론이 지켜졌다면 있을 수 없으므로 **데싱크이거나
    // 한쪽이 거짓말한 것이다.** 지금은 지불을 바꾸지 않고 기록만 남긴다 — 서버가
    // 시뮬레이션을 안 돌려서 어느 쪽이 맞는지 가릴 방법이 없다 (§-34의 남은 구멍).
    const reports = { ...(state.reports || {}), [slot]: said };
    const mismatch =
      state.resultMismatch ||
      Object.values(reports).some((v) => v !== said);

    await $room.updateRoomState({
      phase: PHASE_FINISHED,
      // 승자는 먼저 온 보고로 정한다. 결정론이 지켜졌다면 양쪽 값이 같다 —
      // 어긋났다면 그건 데싱크이고 `desync` 에 이미 잡혀 있다.
      winner: state.winner ?? this.#accountOfPlayer(state, winner),
      winnerSlot: state.winnerSlot || said,
      reason: state.reason ?? 'reported',
      endedAt: state.endedAt ?? Date.now(),
      rewarded,
      reports,
      resultMismatch: !!mismatch,
    });

    // 판당 한 사람 한 번. rewarded 가 그 자물쇠다.
    return first ? await this.#grantReward(state, slot, said, towers) : false;
  }

  // ── 주기 작업 ──────────────────────────────────────────────────

  /**
   * 200~1000ms 주기로 활성 방마다 자동 실행된다. `setTimeout` 이 금지라
   * 시간에 걸린 판단은 전부 여기 있다.
   *
   * `$sender` 도 `$room` 도 없다. 방은 `$global` 로 지목한다.
   */
  async $roomTick(deltaMillis, roomId) {
    const state = await $global.getRoomState(roomId);
    if (!state) return;

    const now = Date.now();
    const users = state.$users || [];
    const players = state.players || {};

    if (state.phase === PHASE_PLAYING) {
      const accounts = Object.keys(players);
      const silent = accounts.filter((a) => now - (players[a].seenAt || 0) > PEER_TIMEOUT_MS);

      // 봇전은 배치를 안 보내므로 seenAt 이 안 갱신된다. 모두 조용해졌을 때만 닫는다 —
      // 안 닫으면 방이 playing 인 채로 영원히 남는다.
      //
      // **`endedAt` 은 여기서 찍지 않는다.** 봇전 방은 시작(`#startSolo`) 직후 seenAt 이
      // 이미 낡아 다음 틱에 바로 이리로 떨어진다. 여기서 `endedAt` 을 찍으면 클라이언트가
      // ~90초 뒤 판을 끝내고 `reportResult` 를 해도 `endedAt: state.endedAt ?? now` 가
      // 이 조기 값을 유지해 `played≈0` 이 되고 → `MIN_RATED_MS` 를 못 넘겨 **봇전 점수가
      // 영영 안 오른다** (2026-08-04 사용자 신고로 찾음). 방만 닫고 종료시각은 실제
      // 보고가 찍게 둔다 — 보고가 영영 안 와도 `played` 는 그때만 계산되므로 안전하다.
      if (silent.length === accounts.length) {
        await $global.updateRoomState(roomId, {
          phase: PHASE_FINISHED,
          reason: 'abandoned',
        });
        return;
      }

      // 한쪽만 조용해졌으면 남은 쪽 승리로 닫는다. 안 닫으면 오지 않는 입력을 계속 기다린다.
      if (silent.length > 0 && silent.length < accounts.length) {
        const alive = accounts.find((a) => !silent.includes(a));
        await $global.updateRoomState(roomId, {
          phase: PHASE_FINISHED,
          winner: alive ?? null,
          winnerSlot: (state.slots || {})[alive] || 0,
          reason: 'timeout',
          endedAt: now,
        });
      }
      return;
    }

    if (state.phase === PHASE_FINISHED) return;

    // 대기 중: 둘 다 들어와 있고 둘 다 준비했으면 시작한다.
    if (users.length >= ROOM_MAX_USER) {
      const ready = users.filter((a) => players[a] && players[a].ready);
      if (ready.length >= ROOM_MAX_USER) {
        // 판이 열리면 코드는 쓸모가 없다. 일찍 놓아 줘야 코드 공간이 안 마른다.
        await this.#releaseCode(state.code);
        await this.#start(roomId, users, players);
        return;
      }
    }

    // 혼자 오래 기다렸으면 봇전으로 확정한다. 여기서 정해야 상대가 같은 순간에
    // 들어오는 경합이 안 생긴다 (SOLO_FALLBACK_MS 주석 참고).
    // 코드 방은 예외다 — 친구를 기다리는 중에 판이 시작되면 코드를 준 의미가 없다.
    if (!state.private && users.length === 1 && players[users[0]] && players[users[0]].ready) {
      const waited = now - (players[users[0]].joinedAt || state.createdAt || now);
      if (waited >= SOLO_FALLBACK_MS) {
        await this.#releaseCode(state.code);
        await this.#startSolo(roomId, users[0]);
        return;
      }
    }

    // 아무도 안 오는 방은 오래 두지 않는다. 코드 방도 여기서 정리된다 —
    // 안 그러면 코드 표가 영원히 자란다.
    const idleTooLong = now - (state.createdAt || now) > LOBBY_TIMEOUT_MS;
    if (users.length === 0 || idleTooLong) {
      await this.#releaseCode(state.code);
      await $global.updateRoomState(roomId, { phase: PHASE_FINISHED, reason: 'abandoned' });
    }
  }

  /**
   * 코드를 표에서 뺀다. 방이 닫힐 때마다 부른다 —
   * 안 빼면 글로벌 상태가 죽은 코드로 계속 커지고, 코드 공간도 줄어든다.
   */
  async #releaseCode(code) {
    if (!code) return;
    await $lock(CODE_LOCK, async () => {
      const g = (await $global.getGlobalState()) || {};
      const codes = { ...(g.codes || {}) };
      if (!(code in codes)) return;
      delete codes[code];
      await $global.updateGlobalState({ codes });
    });
  }

  // ── 내부 ───────────────────────────────────────────────────────

  async #enterRoom(roomId) {
    const id = await $global.joinRoom(roomId);
    const state = (await $room.getRoomState()) || {};

    // 방이 갓 만들어졌으면 초기화한다. 이미 있으면 남의 판 정보를 덮어쓰지 않는다.
    const now = Date.now();
    // joinedAt 은 봇 폴백 타이머의 기준이다. 방 createdAt 을 쓰면, 오래된 방에
    // 뒤늦게 들어온 사람이 기다리지도 않고 곧바로 봇전으로 떨어진다.
    const patch = {
      players: this.#patchPlayer(state, $sender.account, {
        ready: false,
        ackTick: 0,
        seenAt: now,
        joinedAt: now,
      }),
    };
    if (!state.phase) {
      patch.phase = PHASE_WAITING;
      patch.createdAt = Date.now();
      patch.slots = {};
    }
    await $room.updateRoomState(patch);
    return { roomId: id, account: $sender.account };
  }

  /**
   * 판 시작. **시드와 플레이어 번호를 서버가 정한다** —
   * 클라이언트가 정하면 둘이 다른 맵을 만들거나 둘 다 P1이 되어 버린다.
   */
  async #start(roomId, users, players) {
    // **번호를 무작위로 준다** (2026-08-06 사용자 지시). 맵이 P1을 아래, P2를 위에 놓으므로
    // (`maps.ts`) 번호가 곧 화면에서의 위아래다. 계정 문자열 순으로 주던 때는 같은 두 사람이
    // 붙으면 **늘 같은 쪽**이었다.
    //
    // **재접속에 안전하다.** 여기서 한 번 뽑아 `slots` 로 방 상태에 박고, 그 뒤로는 아무도
    // 다시 계산하지 않는다 — 클라이언트도 `rejoinRoom` 도 저장된 값을 읽는다. 계정 순
    // 정렬은 원래 "접속 순서로 주면 재접속 때 뒤집힌다"를 막으려던 것인데, 저장해 두는
    // 이상 정렬이 그 역할을 하고 있던 것이 아니다.
    //
    // 정렬을 먼저 하는 것은 남겨 둔다. 뒤집기 전 순서가 접속 순서에 안 흔들려야
    // 무작위성이 오롯이 아래 동전에서만 나온다.
    const order = [...users].sort();
    if (Math.random() < 0.5) order.reverse();

    const slots = {};
    const names = {};
    const profiles = {};
    const kinds = {};
    const towerKinds = {};
    const ratings = {};
    const tempo = {};
    order.forEach((account, i) => {
      const slot = i + 1;
      slots[account] = slot;
      profiles[slot] = cleanProfile((players[account] || {}).profile);
      // 강화 단계와 닉네임을 슬롯 번호로 옮겨 담는다. 양쪽 클라이언트가 계정 주소를
      // 몰라도 "P1은 몇 단계·누구, P2는 몇 단계·누구"만 보고 같은 판을 만들 수 있어야 한다.
      names[slot] = cleanName((players[account] || {}).name);
      kinds[slot] = cleanUnitKind((players[account] || {}).unitKind);
      towerKinds[slot] = cleanTowerKind((players[account] || {}).towerKind);
      // 점수 변동 계산의 기준값이다. **판 도중 점수가 바뀌어도 이 스냅샷은 안 바뀐다** —
      // `reportResult` 가 매 판 정확히 같은 두 숫자로 Elo를 계산해야 하기 때문이다.
      ratings[slot] = numOr((players[account] || {}).rating, DEFAULT_RATING);
      // 배속 권한. **서버가 계정에서 읽어 내려야 한다** — 각자 자기 계정을 읽으면
      // 같은 `setTempo` 명령을 한쪽만 받아들여 판이 갈라진다.
      tempo[slot] =
        DEBUG_UNLOCK_ALL ||
        ((players[account] || {}).entitlements || []).includes(TEMPO_ITEM);
    });

    await $global.updateRoomState(roomId, {
      phase: PHASE_PLAYING,
      solo: false,
      names,
      profiles,
      kinds,
      towerKinds,
      ratings,
      tempo,
      // maps.ts 의 generateMap 이 16비트 시드를 받는다.
      seed: Math.floor(Math.random() * 0x10000),
      slots,
      startedAt: Date.now(),
      inputDelayTicks: INPUT_DELAY_TICKS,
      desyncCheckTicks: DESYNC_CHECK_TICKS,
      desync: null,
      hashes: {},
      winner: null,
      winnerSlot: 0,
      // 점수 반영은 `rewarded` 가 함께 막는다. 보상과 점수가 같은 한 번에 붙어 있어서
      // 자물쇠를 따로 둘 이유가 없다 (`#grantReward`).
      rewarded: {},
    });
  }

  /**
   * 상대를 못 찾아 봇전으로 확정. 방은 그대로 두고 `solo` 만 세운다.
   *
   * **클라이언트는 이 사실을 화면에 드러내지 않는다** (사용자 결정). 그래도 서버가
   * 표시를 남기는 이유는 두 가지다: `findMatch` 가 이 방을 후보에서 빼야 하고,
   * 나중에 전적을 PVP와 갈라 볼 수 있어야 한다.
   *
   * 시드는 여기서 정한다. 클라이언트가 정하게 두면 봇전과 PVP의 시작 경로가 갈려
   * 한쪽에만 있는 버그가 생긴다.
   */
  async #startSolo(roomId, account) {
    const state = (await $global.getRoomState(roomId)) || {};
    const mine = cleanName(((state.players || {})[account] || {}).name);
    const seed = Math.floor(Math.random() * 0x10000);
    await $global.updateRoomState(roomId, {
      phase: PHASE_PLAYING,
      solo: true,
      seed,
      slots: { [account]: 1 },
      // 사람 이름만 내려준다. 상대(봇) 이름은 클라이언트가 만든다 —
      // 봇이라는 것을 화면에 안 알리기로 했으므로(§-7) 서버가 'BOT' 같은 값을
      // 내려주면 그 결정이 무너진다.
      names: { 1: mine },
      profiles: { 1: cleanProfile(((state.players || {})[account] || {}).profile) },
      // 봇전도 생산속도를 정하는 값이라 방 상태에 실어야 한다(§-24.7). PVP와 같은 필드
      // 이름을 써서 클라이언트가 solo·PVP를 가리지 않고 같은 경로로 읽게 한다.
      towerKinds: { 1: cleanTowerKind(((state.players || {})[account] || {}).towerKind) },
      startedAt: Date.now(),
      winner: null,
      winnerSlot: 0,
    });
    return seed;
  }

  async #loadAccount() {
    return normalizeAccount(await $global.getMyState(), $sender.account);
  }

  /** 유저 상태는 덮어쓰기라 **항상 계정 전체**를 쓴다. 일부만 넘기면 나머지가 날아간다. */
  async #saveAccount(a) {
    await $global.updateMyState(a);
    return a;
  }

  /**
   * 매치 보상.
   *
   * **승패와 타워 수는 클라이언트가 보고한 값이다.** 지금은 서버가 시뮬레이션을 안 돌려서
   * 검증할 방법이 없다 — 타워 수를 상한으로 자르는 정도가 전부다.
   * 제대로 막으려면 `sim/` 을 서버에서 돌려야 한다 (§-5의 서버 권위 항목).
   *
   * 봇 대체 판(`solo`)은 전적을 따로 센다. 화면에는 안 알리지만(§-7) 나중에 밸런스를
   * 볼 때 표본이 뭐였는지 알 수 있어야 한다.
   *
   * **친구 방(`private`)은 아무것도 안 준다** (2026-08-08 사용자 지시) — 코인도 점수도
   * 전적도. 코드를 주고받아 만나는 자리라 상대를 고를 수 있고, 둘이 짜고 번갈아 져
   * 주면 무엇이든 무한히 불릴 수 있다. **막는 곳은 여기 하나다** — 클라이언트가 보고를
   * 안 하게 두는 것은 우회가 되므로 지불 지점에서 끊는다.
   */
  async #grantReward(state, slot, winnerSlot, towers) {
    // 친구끼리 잡은 방인가. 방을 만들 때 `private: true` 가 찍힌다 (`hostRoom`).
    const priv = state.private === true;
    // 이 판이 점수에 셀 만큼 길었는가 (`MIN_RATED_MS`). `endedAt` 은 첫 보고가 찍고
    // 두 번째 보고는 그 값을 그대로 읽으므로, 양쪽이 같은 판정을 받는다.
    const played = (state.endedAt || Date.now()) - (state.startedAt || 0);
    const rated = !priv && state.startedAt > 0 && played >= MIN_RATED_MS;
    // 락 밖에서도 지불액을 알아야 한다 — 광고 2배가 이 값을 그대로 한 번 더 준다.
    let paid = 0;
    return await $lock(`acct:${$sender.account}`, async () => {
      const a = await this.#loadAccount();
      const outcome = winnerSlot === 0 ? 'draw' : winnerSlot === slot ? 'win' : 'loss';
      const base = outcome === 'win' ? REWARD_WIN : outcome === 'draw' ? REWARD_DRAW : REWARD_LOSS;
      const kept = Math.min(MAX_TOWERS, num(towers));
      // 친구 방은 0원이다. `paid` 가 0이면 광고 2배(`claimDoubleReward`)도 `no_reward`
      // 로 막히므로 그쪽에 따로 조건을 달 필요가 없다.
      const total = priv ? 0 : base + kept * REWARD_PER_TOWER;
      paid = total;
      const solo = !!state.solo;
      // 친구 방은 전적에도 안 센다 — 짜고 두면 승수가 그대로 거짓말이 되고, 순위표
      // 프로필 카드가 그 숫자를 보여준다.
      const counts = !priv;
      return await this.#saveAccount({
        ...a,
        coins: a.coins + total,
        // 봇 대체전도 로비의 일반 전적에 합산한다. solo 필드는 밸런스 분석용으로 함께 유지한다.
        wins: a.wins + (counts && outcome === 'win' ? 1 : 0),
        losses: a.losses + (counts && outcome === 'loss' ? 1 : 0),
        draws: a.draws + (counts && outcome === 'draw' ? 1 : 0),
        soloWins: a.soloWins + (counts && solo && outcome === 'win' ? 1 : 0),
        soloLosses: a.soloLosses + (counts && solo && outcome === 'loss' ? 1 : 0),
        soloDraws: a.soloDraws + (counts && solo && outcome === 'draw' ? 1 : 0),
        rating: rated ? this.#ratingAfter(state, slot, outcome, a.rating) : a.rating,
      });
    }).then(async (saved) => {
      // **얼마를 줬는지 방에 적어 둔다.** 광고 2배(`claimDoubleReward`)가 이 값을
      // 그대로 한 번 더 준다 — 클라이언트가 액수를 보내면 무한 코인이 된다.
      await $room.updateRoomState({ paid: { ...(state.paid || {}), [$sender.account]: paid } });
      // 순위표는 계정 자물쇠 **밖에서** 고친다. 안에서 부르면 계정 락을 쥔 채로
      // 순위표 락을 기다리게 되고, 두 사람이 동시에 보고하면 서로를 막는다.
      //
      // 봇전도 올린다. 점수가 움직이는데 표에 안 오르면 어디서 밀렸는지 알 수가 없고,
      // 인구가 적을 때도 봇전 결과를 반영해 순위표가 비지 않게 한다.
      //
      // **점수가 안 움직인 판은 표도 안 건드린다.** 짧은 판으로 순위만 갱신되면
      // `MIN_RATED_MS` 를 세운 의미가 없다.
      if (rated) await this.#recordOnBoard(saved);
      return saved;
    });
  }

  /**
   * 순위표에 이미 있는 내 칸을 지금 계정 값으로 맞춘다.
   *
   * **표에 없으면 아무것도 안 한다.** 이것이 `#recordOnBoard` 와 갈리는 점이다 —
   * 순위표는 누구나 열 수 있어서, 없을 때 넣어 버리면 점수가 낮아 못 든 사람까지
   * 전부 컬렉션에 쌓인다. `BOARD_SIZE` 는 읽기 제한이지 저장 제한이 아니라서
   * 표가 계속 커지고 정렬 조회가 느려진다.
   *
   * 그래서 쓰기가 도는 것은 **상위권이 순위표를 열 때**뿐이다. 갈아입는 시점에
   * 맞추는 방법도 있었는데, 상점은 이것저것 눌러 보는 화면이라 클릭마다 쓰기가
   * 생긴다. 보는 순간 최신이면 체감은 같고 쓰기는 훨씬 적다.
   */
  async #refreshMyBoardRow() {
    const account = $sender.account;
    await $lock(`board:${account}`, async () => {
      const mine = await $global.getCollectionItems(BOARD_COLLECTION, {
        filters: [{ field: 'account', operator: '==', value: account }],
      });
      if (!mine[0]) return;
      const a = await this.#loadAccount();
      // 이름이 사라진 계정은 표에서도 빠져야 한다 (`#recordOnBoard` 와 같은 규칙).
      if (!a.name) {
        for (const row of mine) await $global.deleteCollectionItem(BOARD_COLLECTION, row.__id);
        return;
      }
      await $global.updateCollectionItem(BOARD_COLLECTION, {
        ...mine[0],
        name: a.name,
        rating: a.rating,
        profile: a.profile,
        unitKind: a.unitKind,
        towerKind: a.towerKind,
        wins: a.wins,
        losses: a.losses,
        updatedAt: Date.now(),
      });
    });
  }

  /**
   * 순위표에 내 점수를 반영한다. 계정당 한 칸이라 먼저 빼고 다시 넣는다 —
   * 안 그러면 같은 사람이 이길 때마다 표를 채운다.
   *
   * **점수가 내려가면 표에서 밀려난다.** 최고 기록이 아니라 지금 점수의 순위표다.
   * 최고 기록으로 두면 한 번 올라간 사람이 안 내려와 표가 굳는다.
   *
   * 이미 표에 있는 사람의 칸을 최신으로 맞추기만 하는 것은 `#refreshMyBoardRow` 다.
   */
  async #recordOnBoard(a) {
    await this.#migrateLegacyBoard();
    await $lock(`board:${a.account}`, async () => {
      const mine = await $global.getCollectionItems(BOARD_COLLECTION, {
        filters: [{ field: 'account', operator: '==', value: a.account }],
      });
      // 이름 없는 계정은 표에 안 넣는다. 기존 기록이 있으면 함께 지운다.
      if (!a.name) {
        for (const row of mine) await $global.deleteCollectionItem(BOARD_COLLECTION, row.__id);
        return;
      }
      // **프로필 카드에 쓸 값을 여기 같이 적어 둔다.** 순위표를 누르면 그 사람의
      // 아바타·착용 장비·전적이 보이는데, 그걸 계정에서 따로 읽으려면 남의 계정
      // 주소를 클라이언트에 내려야 한다 (`getLeaderboard` 주석이 막아 둔 것이다).
      // 표에 미리 실어 두면 그 원칙을 안 깨고도 보여줄 수 있다.
      //
      // 값이 갱신되는 시점은 **점수가 움직인 판 뒤**다. 그래서 상점에서 갈아입어도
      // 다음 판까지는 옛 장비가 보인다 — 갈아입을 때마다 표를 쓰면 상점을 만질 때마다
      // 순위표 락을 잡게 되어 그쪽이 더 비싸다.
      const entry = {
        account: a.account,
        name: a.name,
        rating: a.rating,
        profile: a.profile,
        unitKind: a.unitKind,
        towerKind: a.towerKind,
        wins: a.wins,
        losses: a.losses,
        updatedAt: Date.now(),
      };
      if (mine[0]) {
        await $global.updateCollectionItem(BOARD_COLLECTION, { ...entry, __id: mine[0].__id });
        for (const duplicate of mine.slice(1)) {
          await $global.deleteCollectionItem(BOARD_COLLECTION, duplicate.__id);
        }
      } else {
        await $global.addCollectionItem(BOARD_COLLECTION, { ...entry, createdAt: Date.now() });
      }
    });
  }

  /** One-time migration for rankings written by builds before Global Collections. */
  async #migrateLegacyBoard() {
    if ((await $global.countCollectionItems(BOARD_COLLECTION)) > 0) return;
    await $lock('board:migrate', async () => {
      if ((await $global.countCollectionItems(BOARD_COLLECTION)) > 0) return;
      const g = (await $global.getGlobalState()) || {};
      for (const row of Array.isArray(g.board) ? g.board : []) {
        if (!row || !row.account || !cleanName(row.name)) continue;
        await $global.addCollectionItem(BOARD_COLLECTION, {
          account: row.account,
          name: cleanName(row.name),
          rating: numOr(row.rating, DEFAULT_RATING),
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
      }
    });
  }

  /**
   * 이 판 뒤의 내 점수. 0 아래로는 안 내려간다.
   *
   * **사람전은 판이 시작될 때 찍어 둔 `state.ratings` 로만 계산한다** — 두 사람이
   * 각자 보고하는데 계정의 지금 값을 읽으면 먼저 보고한 쪽의 변동이 나중 쪽 계산에
   * 섞여 들어와 합이 0이 안 된다.
   *
   * **봇전은 지금 값(`current`)을 양쪽 점수로 쓴다.** 플레이어 점수와 같은 가상 봇을
   * 상대하므로 점수대와 관계없이 동점 Elo 기준의 동일한 변동폭을 적용한다.
   */
  #ratingAfter(state, slot, outcome, current) {
    const score = outcome === 'win' ? 1 : outcome === 'draw' ? 0.5 : 0;
    if (state.solo) {
      return Math.max(0, current + eloDelta(current, current, score, RATING_K_SOLO));
    }
    const ratings = state.ratings || {};
    const mine = numOr(ratings[slot], DEFAULT_RATING);
    const theirs = numOr(ratings[slot === 1 ? 2 : 1], DEFAULT_RATING);
    return Math.max(0, mine + eloDelta(mine, theirs, score, RATING_K));
  }

  /** `players` 맵을 통째로 다시 만든다. 룸 상태 갱신이 얕은 병합이라 중첩 객체는 직접 합쳐야 한다. */
  #patchPlayer(state, account, patch) {
    const players = { ...(state.players || {}) };
    players[account] = { ...(players[account] || {}), ...patch };
    return players;
  }

  /** 플레이어 번호(1|2) → 계정. 무승부(0)나 모르는 값이면 null. */
  #accountOfPlayer(state, player) {
    const slots = state.slots || {};
    for (const account of Object.keys(slots)) {
      if (slots[account] === Number(player)) return account;
    }
    return null;
  }

  /**
   * 같은 틱의 해시가 다르면 결정론이 깨진 것이다. 판을 끊지는 않고 기록만 남긴다 —
   * 어긋난 판을 끝까지 보여 주는 편이 원인을 찾기 쉽다.
   *
   * 지나간 틱의 해시는 버린다. 안 그러면 룸 상태가 판 내내 계속 커진다.
   */
  #desyncPatch(state, account, hash) {
    const tick = Math.floor(Number(hash.tick) || 0);
    if (tick <= 0 || tick % DESYNC_CHECK_TICKS !== 0) return {};
    if (state.desync) return {}; // 이미 갈라졌다. 첫 지점만 남긴다

    const key = String(tick);
    const bucket = { ...((state.hashes || {})[key] || {}), [account]: hash.value };
    const values = Object.values(bucket);

    if (values.length >= ROOM_MAX_USER && new Set(values).size > 1) {
      return { desync: { tick, hashes: bucket } };
    }
    return { hashes: { [key]: bucket } };
  }
}
