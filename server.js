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
 * 배치 주기(~100ms = 3틱)에 왕복 지연을 더한 값보다 커야 한다. 작으면 상대 입력이
 * 제때 안 와서 판이 멈추고, 크면 조작이 굼떠진다. 실측하고 조일 것.
 */
const INPUT_DELAY_TICKS = 12;

/** 몇 틱마다 상태 해시를 비교할 것인가. 30Hz 기준 30틱 = 1초. */
const DESYNC_CHECK_TICKS = 30;

/**
 * 상대가 이 시간(ms) 넘게 아무 배치도 안 보내면 끊긴 것으로 본다.
 * `$roomTick` 이 200~1000ms 주기라 그보다 넉넉해야 한다.
 */
const PEER_TIMEOUT_MS = 10000;

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

/**
 * 공속 강화 단계 정리. **상한이 없다** (2026-08-04 사용자 지시로 5단계 제한 제거).
 * 음수·NaN 만 막는다.
 *
 * **배수 공식은 서버에 두지 않는다.** 서버는 정수 단계만 정리하고, 배수로 바꾸는 것은
 * 클라이언트의 `speedMulFor` 가 한다 — 공식을 양쪽에 복사하면 언젠가 어긋나고,
 * 어긋나는 순간 두 클라이언트가 다른 판을 돌게 된다.
 */
function clampSpeedLevel(v) {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

// ── 계정 ──────────────────────────────────────────────────────────
//
// 재화와 강화가 **서버에 산다.** 전에는 클라이언트의 localStorage 가 유일한 저장소라
// 콘솔에서 코인을 고쳐 쓸 수 있었고, PVP 강화도 클라이언트가 보낸 숫자를 그대로 믿었다.
//
// 유저 상태는 **덮어쓰기**다 (글로벌 상태의 병합과 다르다). 그래서 저장할 때마다
// 계정 객체 전체를 쓴다 — 일부 필드만 넘기면 나머지가 날아갈 수 있다.

/** 가격표. **클라이언트에도 같은 표가 있다** (화면 표시용). 여기가 진짜다. */
const UPGRADE_COSTS = { speed: [300, 700, 1300, 2200, 3500] };
/**
 * 표를 넘어선 단계의 가격 증가율. **`game/src/account/account.ts` 의 같은 이름과
 * 반드시 같아야 한다** — 어긋나면 "보이는 값과 깎이는 값이 다름"이 된다 (§-10).
 */
const SPEED_COST_GROWTH = 1.5;

/**
 * `level` 단계에서 다음 단계로 갈 때의 가격. 상한이 없어서(2026-08-04) 표가 끝나면
 * 증가율로 이어 만든다. 클라이언트의 `speedCostAt` 과 같은 계산이어야 한다.
 */
function speedCostAt(level) {
  const table = UPGRADE_COSTS.speed;
  if (level < table.length) return table[level];
  let cost = table[table.length - 1];
  for (let i = table.length; i <= level; i++) {
    cost = Math.round((cost * SPEED_COST_GROWTH) / 100) * 100;
  }
  return cost;
}
/**
 * 유닛 생김새 가격. **`game/src/units.ts` 의 `UNIT_KIND_META` 와 같아야 한다.**
 * 어긋나면 "상점에는 보이는데 못 입는" 또는 그 반대가 된다.
 *
 * 2026-07-31에 BeerGang 색 변형 4종이 붙었다 (하의·머리 색만 다르다).
 */
const UNIT_PRICES = {
  beergang: 0,
  beergang_white: 400,
  beergang_gold: 900,
  beergang_green: 1500,
  beergang_purple: 2400,
};

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
const PREMIUM_ITEMS = [...PREMIUM_UNITS, TEMPO_ITEM];

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
// 검증 하네스는 이 값을 꺼서 돌린다 (`tools/server-harness.mjs`) — 켜 둔 채로 재면
// "안 산 것을 못 입는다" 같은 검사가 통째로 무의미해진다. 프로덕션에서 항상 꺼지도록
// `false` 로 박는다 (이전의 `__TW_NO_DEBUG_UNLOCK` 분기는 테스트 하네스 전용이었다).
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

/** 광고 한 번에 주는 코인. 승리 보상(100)보다 낮게 잡았다 — 판을 이기는 편이 낫다. */
const AD_COINS = 60;
/** 광고 사이 최소 간격(ms). 연타로 하루치를 몇 초에 소진하지 못하게 한다. */
const AD_COOLDOWN_MS = 90000;
/** 하루 상한. 이걸로 광고 코인의 총량이 정해진다. */
const AD_DAILY_MAX = 10;
/** 하루의 길이(ms). UTC 기준으로 자른다 — 서버가 시간대를 모른다. */
const DAY_MS = 86400000;

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
  { afterMs: 0, band: 100 },
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
 * 순위표에 남기는 인원. **글로벌 상태에 통째로 산다** — 방 코드표(`codes`)와 같은 자리다.
 *
 * 전체 계정을 훑어 정렬하는 방법은 안 쓴다. Verse8 유저 상태에는 "전부 읽기"가 없고,
 * 있더라도 계정 수에 비례해 느려진다. 판이 끝날 때마다 10칸짜리 표를 고치는 편이 싸다.
 */
const BOARD_SIZE = 10;
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
 * 그래서 20초 밑으로 끝나는 판은 **정상 플레이로는 안 나온다.** 유일하게 걸리는 것이
 * 초반 항복승인데, 그건 막으려는 바로 그 경로다. "상대가 20초 안에 나가떨어진 판은
 * 점수에 안 센다"는 규칙 자체가 납득 가능하기도 하다.
 */
const MIN_RATED_MS = 20000;

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
    speedLevel: 0,
    ownedUnits: [],
    // `units.ts` 의 DEFAULT_UNIT_KIND 와 같아야 한다. 어긋나면 접속하는 순간
    // 서버 값이 클라이언트를 덮어써서(§-10) 상점에서 고른 것이 되돌아간 것처럼 보인다.
    unitKind: DEFAULT_UNIT_KIND,
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
  };
}

/** 저장된 값이 깨졌거나 손으로 고쳐졌어도 말이 되는 계정으로 만든다. */
function normalizeAccount(raw, account) {
  const d = defaultAccount(account);
  if (!raw || typeof raw !== 'object') return d;
  const owned = Array.isArray(raw.ownedUnits)
    ? [...new Set(raw.ownedUnits.filter((k) => k in UNIT_PRICES))]
    : [];
  const entitlements = cleanEntitlements(raw.entitlements);
  const kind = isKnownUnit(raw.unitKind) ? raw.unitKind : DEFAULT_UNIT_KIND;
  return {
    account,
    name: cleanName(raw.name),
    profile: cleanProfile(raw.profile),
    coins: num(raw.coins),
    wins: num(raw.wins),
    losses: num(raw.losses),
    draws: num(raw.draws),
    speedLevel: clampSpeedLevel(raw.speedLevel),
    ownedUnits: owned,
    // 안 가진 것이 착용돼 있으면 기본으로 되돌린다.
    unitKind: UNIT_PRICES[kind] === 0 || owned.includes(kind) || entitlements.includes(kind)
      ? kind
      : DEFAULT_UNIT_KIND,
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
    const rows = await $global.getCollectionItems(BOARD_COLLECTION, {
      orderBy: [{ field: 'rating', direction: 'desc' }],
      limit: BOARD_SIZE,
    });
    return rows.map((e) => ({
      name: cleanName(e.name),
      rating: numOr(e.rating, DEFAULT_RATING),
      me: e.account === $sender.account,
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

  /**
   * 강화 한 단계 구매.
   *
   * **가격과 잔액 검사가 여기 있다.** 클라이언트의 같은 함수는 버튼을 회색으로
   * 만드는 용도일 뿐이고, 실제로 깎는 것은 이쪽이다.
   */
  async buyUpgrade(kind) {
    return await $lock(`acct:${$sender.account}`, async () => {
      const a = await this.#loadAccount();
      if (kind !== 'speed') throw new Error('그런 강화가 없습니다');
      const level = a.speedLevel;
      // **만렙이 없다** (2026-08-04). 표를 넘어선 단계는 `speedCostAt` 이 값을 이어 만든다 —
      // 가격이 단계마다 1.5배씩 뛰므로 제동은 경제 쪽에서 걸린다.
      const cost = speedCostAt(level);
      if (a.coins < cost) throw new Error('코인이 모자랍니다');
      return await this.#saveAccount({ ...a, coins: a.coins - cost, speedLevel: level + 1 });
    });
  }

  /** 유닛 생김새 구매. 사면 바로 착용한다. 순수 외형이라 판에는 영향이 없다. */
  async buyUnitKind(kind) {
    return await $lock(`acct:${$sender.account}`, async () => {
      const a = await this.#loadAccount();
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
  async claimAdCoins() {
    return await $lock(`acct:${$sender.account}`, async () => {
      const a = await this.#loadAccount();
      const now = Date.now();
      // UTC 기준 날짜. 서버가 사용자 시간대를 모르므로 한 기준으로 잘라야
      // 사람마다 상한이 달라지지 않는다.
      const day = Math.floor(now / DAY_MS);
      const count = a.adDay === day ? a.adCount : 0;

      // **기계가 읽는 코드로 던진다.** 화면 문구는 언어마다 달라야 한다(§-40).
      if (count >= AD_DAILY_MAX) throw new Error('ad_limit');
      if (now - a.adAt < AD_COOLDOWN_MS) throw new Error('ad_cooldown');

      return await this.#saveAccount({
        ...a,
        coins: a.coins + AD_COINS,
        adAt: now,
        adDay: day,
        adCount: count + 1,
      });
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
    if (DEBUG_UNLOCK_ALL) {
      if (!isKnownUnit(kind)) throw new Error('그런 유닛이 없습니다');
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
   * `speedLevel` 은 그 사람의 상점 강화 단계다. **서버를 거치는 이유가 두 가지다:**
   *
   * 1. **결정론.** 클라이언트가 각자 자기 계정 값을 읽어 쓰면 두 쪽이 서로 다른 보정으로
   *    시뮬레이션한다 — 첫 틱부터 갈라진다. 서버가 정한 값을 양쪽이 똑같이 읽어야 한다
   * 2. 정수 범위를 여기서 자른다
   *
   * **아직 위조를 막지는 못한다.** 클라이언트가 보낸 숫자를 그대로 믿는다.
   * 제대로 막으려면 계정을 Verse8 글로벌 유저 상태로 옮겨 서버가 직접 읽어야 한다.
   */
  async setReady(ready) {
    const state = (await $room.getRoomState()) || {};
    // **강화 단계는 서버 계정에서 읽는다.** 클라이언트가 보낸 값을 쓰면 만렙을 자칭할 수 있다.
    const me = await this.#loadAccount();
    await $room.updateRoomState({
      players: this.#patchPlayer(state, $sender.account, {
        ready: !!ready,
        speedLevel: me.speedLevel,
        // 유닛 종류도 서버 계정에서 읽는다. 2026-07-31부터 종류가 유닛의 힘을 정하므로
        // (`units.ts` 의 `power`) 클라이언트가 보내면 안 산 유닛의 힘을 자칭할 수 있다.
        // `#loadAccount` 가 소유 검사까지 마친 값이라 여기서 더 볼 것이 없다.
        unitKind: me.unitKind,
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
      if (silent.length === accounts.length) {
        await $global.updateRoomState(roomId, {
          phase: PHASE_FINISHED,
          reason: 'abandoned',
          endedAt: now,
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
    // 계정 문자열 순으로 번호를 준다. 접속 순서로 주면 재접속 때 번호가 뒤집힌다.
    const slots = {};
    const levels = {};
    const names = {};
    const profiles = {};
    const kinds = {};
    const ratings = {};
    const tempo = {};
    [...users].sort().forEach((account, i) => {
      const slot = i + 1;
      slots[account] = slot;
      profiles[slot] = cleanProfile((players[account] || {}).profile);
      // 강화 단계와 닉네임을 슬롯 번호로 옮겨 담는다. 양쪽 클라이언트가 계정 주소를
      // 몰라도 "P1은 몇 단계·누구, P2는 몇 단계·누구"만 보고 같은 판을 만들 수 있어야 한다.
      levels[slot] = clampSpeedLevel((players[account] || {}).speedLevel);
      names[slot] = cleanName((players[account] || {}).name);
      kinds[slot] = cleanUnitKind((players[account] || {}).unitKind);
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
      levels,
      names,
      profiles,
      kinds,
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
      levels: { 1: clampSpeedLevel(((state.players || {})[account] || {}).speedLevel) },
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
   */
  async #grantReward(state, slot, winnerSlot, towers) {
    // 이 판이 점수에 셀 만큼 길었는가 (`MIN_RATED_MS`). `endedAt` 은 첫 보고가 찍고
    // 두 번째 보고는 그 값을 그대로 읽으므로, 양쪽이 같은 판정을 받는다.
    const played = (state.endedAt || Date.now()) - (state.startedAt || 0);
    const rated = state.startedAt > 0 && played >= MIN_RATED_MS;
    // 락 밖에서도 지불액을 알아야 한다 — 광고 2배가 이 값을 그대로 한 번 더 준다.
    let paid = 0;
    return await $lock(`acct:${$sender.account}`, async () => {
      const a = await this.#loadAccount();
      const outcome = winnerSlot === 0 ? 'draw' : winnerSlot === slot ? 'win' : 'loss';
      const base = outcome === 'win' ? REWARD_WIN : outcome === 'draw' ? REWARD_DRAW : REWARD_LOSS;
      const kept = Math.min(MAX_TOWERS, num(towers));
      const total = base + kept * REWARD_PER_TOWER;
      paid = total;
      const solo = !!state.solo;
      return await this.#saveAccount({
        ...a,
        coins: a.coins + total,
        // 봇 대체전도 로비의 일반 전적에 합산한다. solo 필드는 밸런스 분석용으로 함께 유지한다.
        wins: a.wins + (outcome === 'win' ? 1 : 0),
        losses: a.losses + (outcome === 'loss' ? 1 : 0),
        draws: a.draws + (outcome === 'draw' ? 1 : 0),
        soloWins: a.soloWins + (solo && outcome === 'win' ? 1 : 0),
        soloLosses: a.soloLosses + (solo && outcome === 'loss' ? 1 : 0),
        soloDraws: a.soloDraws + (solo && outcome === 'draw' ? 1 : 0),
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
   * 순위표에 내 점수를 반영한다. 계정당 한 칸이라 먼저 빼고 다시 넣는다 —
   * 안 그러면 같은 사람이 이길 때마다 표를 채운다.
   *
   * **점수가 내려가면 표에서 밀려난다.** 최고 기록이 아니라 지금 점수의 순위표다.
   * 최고 기록으로 두면 한 번 올라간 사람이 안 내려와 표가 굳는다.
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
      const entry = { account: a.account, name: a.name, rating: a.rating, updatedAt: Date.now() };
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
