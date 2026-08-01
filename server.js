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
 * 상점 공속 강화의 최대 단계. `sim/config.ts` 의 `SPEED_LEVEL_MAX` 와 같아야 한다.
 *
 * **배수 공식은 서버에 두지 않는다.** 서버는 정수 단계만 자르고, 배수로 바꾸는 것은
 * 클라이언트의 `speedMulFor` 가 한다 — 공식을 양쪽에 복사하면 언젠가 어긋나고,
 * 어긋나는 순간 두 클라이언트가 다른 판을 돌게 된다.
 */
const SPEED_LEVEL_MAX = 5;

function clampSpeedLevel(v) {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? Math.min(SPEED_LEVEL_MAX, Math.max(0, n)) : 0;
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
  return Object.prototype.hasOwnProperty.call(UNIT_PRICES, v) ? v : DEFAULT_UNIT_KIND;
}

/** 매치 보상. `account.ts` 의 값과 같아야 한다. */
const REWARD_WIN = 100;
const REWARD_DRAW = 50;
const REWARD_LOSS = 30;
const REWARD_PER_TOWER = 8;
/** 한 판에서 들고 있을 수 있는 타워 수 상한. 보고가 부풀려져도 여기서 잘린다. */
const MAX_TOWERS = 12;

function num(v) {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

/** `num()` 과 달리 값이 없을 때 0이 아니라 지정한 기본값으로 떨어진다 (레이팅 기본값용). */
function numOr(v, fallback) {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : fallback;
}

// ── PVP 점수 (Elo) ───────────────────────────────────────────────
//
// `game/src/rating.ts` 가 이 숫자를 티어로 바꾼다. 서버는 숫자만 안다 — 구간은
// 순수 표시용이라 클라이언트 한 곳에만 있다.

/** 새 계정의 시작 점수. `game/src/account/account.ts` 의 같은 이름과 맞춰 둔다. */
const DEFAULT_RATING = 1000;
/** 한 판의 최대 변동폭. 표준 Elo 값이다. 승률 반영 속도를 조절하려면 이 값만 만지면 된다. */
const RATING_K = 32;

/** 표준 Elo 기대승률. */
function eloExpected(mine, theirs) {
  return 1 / (1 + Math.pow(10, (theirs - mine) / 400));
}

/** 한 판 뒤 변동량(반올림 정수). `score` 는 승 1 / 무 0.5 / 패 0. */
function eloDelta(mine, theirs, score) {
  return Math.round(RATING_K * (score - eloExpected(mine, theirs)));
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
    // PVP 점수(Elo). 봇전은 안 건드린다 — solo 전적을 갈라 둔 것과 같은 이유다.
    rating: DEFAULT_RATING,
  };
}

/** 저장된 값이 깨졌거나 손으로 고쳐졌어도 말이 되는 계정으로 만든다. */
function normalizeAccount(raw, account) {
  const d = defaultAccount(account);
  if (!raw || typeof raw !== 'object') return d;
  const owned = Array.isArray(raw.ownedUnits)
    ? [...new Set(raw.ownedUnits.filter((k) => k in UNIT_PRICES))]
    : [];
  const kind = raw.unitKind in UNIT_PRICES ? raw.unitKind : DEFAULT_UNIT_KIND;
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
    unitKind: UNIT_PRICES[kind] === 0 || owned.includes(kind) ? kind : DEFAULT_UNIT_KIND,
    soloWins: num(raw.soloWins),
    soloLosses: num(raw.soloLosses),
    soloDraws: num(raw.soloDraws),
    // 없으면(마이그레이션 전 계정) 0이 아니라 기본 점수로 떨어진다 — `num()` 은
    // 여기 못 쓴다. 0은 "많이 져서 0점"과 "한 번도 안 쟀음"을 구분 못 한다.
    rating: numOr(raw.rating, DEFAULT_RATING),
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
   * 강화 한 단계 구매.
   *
   * **가격과 잔액 검사가 여기 있다.** 클라이언트의 같은 함수는 버튼을 회색으로
   * 만드는 용도일 뿐이고, 실제로 깎는 것은 이쪽이다.
   */
  async buyUpgrade(kind) {
    return await $lock(`acct:${$sender.account}`, async () => {
      const a = await this.#loadAccount();
      const costs = UPGRADE_COSTS[kind];
      if (!costs) throw new Error('그런 강화가 없습니다');
      const level = kind === 'speed' ? a.speedLevel : 0;
      if (level >= Math.min(SPEED_LEVEL_MAX, costs.length)) throw new Error('이미 최대입니다');
      const cost = costs[level];
      if (a.coins < cost) throw new Error('코인이 모자랍니다');
      return await this.#saveAccount({ ...a, coins: a.coins - cost, speedLevel: level + 1 });
    });
  }

  /** 유닛 생김새 구매. 사면 바로 착용한다. 순수 외형이라 판에는 영향이 없다. */
  async buyUnitKind(kind) {
    return await $lock(`acct:${$sender.account}`, async () => {
      const a = await this.#loadAccount();
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

  /** 가진 것만 착용할 수 있다. */
  async selectUnitKind(kind) {
    const a = await this.#loadAccount();
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
  async findMatch() {
    const ids = (await $global.getAllRoomIds()) || [];
    const me = await this.#loadAccount();
    const now = Date.now();
    for (const id of ids) {
      const state = await $global.getRoomState(id);
      if (state && state.private) continue;
      if (state && state.phase && state.phase !== PHASE_WAITING) continue;
      if ((await $global.countRoomUsers(id)) >= ROOM_MAX_USER) continue;

      const players = (state && state.players) || {};
      const creator = Object.keys(players)[0];
      if (creator) {
        const waited = now - (players[creator].joinedAt || 0);
        const creatorRating = numOr(players[creator].rating, DEFAULT_RATING);
        if (Math.abs(me.rating - creatorRating) > ratingBandFor(waited)) continue;
      }
      return await this.#enterRoom(id);
    }
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
        seenAt: Date.now(),
      }),
    });
    return true;
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

    const account = $sender.account;
    const slot = (state.slots || {})[account];
    if (!slot) return false;

    const rewarded = { ...(state.rewarded || {}) };
    const first = !rewarded[account];
    rewarded[account] = true;

    await $room.updateRoomState({
      phase: PHASE_FINISHED,
      // 승자는 먼저 온 보고로 정한다. 결정론이 지켜졌다면 양쪽 값이 같다 —
      // 어긋났다면 그건 데싱크이고 `desync` 에 이미 잡혀 있다.
      winner: state.winner ?? this.#accountOfPlayer(state, winner),
      winnerSlot: state.winnerSlot || Number(winner) || 0,
      reason: state.reason ?? 'reported',
      endedAt: state.endedAt ?? Date.now(),
      rewarded,
    });

    // 판당 한 사람 한 번. rewarded 가 그 자물쇠다.
    return first ? await this.#grantReward(state, slot, Number(winner) || 0, towers) : false;
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
    });

    await $global.updateRoomState(roomId, {
      phase: PHASE_PLAYING,
      solo: false,
      levels,
      names,
      profiles,
      kinds,
      ratings,
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
    await $global.updateRoomState(roomId, {
      phase: PHASE_PLAYING,
      solo: true,
      seed: Math.floor(Math.random() * 0x10000),
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
    return await $lock(`acct:${$sender.account}`, async () => {
      const a = await this.#loadAccount();
      const outcome = winnerSlot === 0 ? 'draw' : winnerSlot === slot ? 'win' : 'loss';
      const base = outcome === 'win' ? REWARD_WIN : outcome === 'draw' ? REWARD_DRAW : REWARD_LOSS;
      const kept = Math.min(MAX_TOWERS, num(towers));
      const total = base + kept * REWARD_PER_TOWER;
      const solo = !!state.solo;
      return await this.#saveAccount({
        ...a,
        coins: a.coins + total,
        wins: a.wins + (!solo && outcome === 'win' ? 1 : 0),
        losses: a.losses + (!solo && outcome === 'loss' ? 1 : 0),
        draws: a.draws + (!solo && outcome === 'draw' ? 1 : 0),
        soloWins: a.soloWins + (solo && outcome === 'win' ? 1 : 0),
        soloLosses: a.soloLosses + (solo && outcome === 'loss' ? 1 : 0),
        soloDraws: a.soloDraws + (solo && outcome === 'draw' ? 1 : 0),
        rating: solo ? a.rating : this.#ratingAfter(state, slot, outcome),
      });
    });
  }

  /**
   * 이 판 뒤의 내 PVP 점수. **판이 시작될 때 찍어 둔 `state.ratings` 로만 계산한다** —
   * 두 사람이 각자 보고하는데 계정의 지금 값을 읽으면 먼저 보고한 쪽의 변동이
   * 나중 쪽 계산에 섞여 들어와 합이 0이 안 된다.
   *
   * 0 아래로는 안 내려간다. 음수 점수는 티어 표시(`game/src/rating.ts`)에 자리가 없다.
   */
  #ratingAfter(state, slot, outcome) {
    const ratings = state.ratings || {};
    const mine = numOr(ratings[slot], DEFAULT_RATING);
    const theirs = numOr(ratings[slot === 1 ? 2 : 1], DEFAULT_RATING);
    const score = outcome === 'win' ? 1 : outcome === 'draw' ? 0.5 : 0;
    return Math.max(0, mine + eloDelta(mine, theirs, score));
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
