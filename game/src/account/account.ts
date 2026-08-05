/**
 * 계정 데이터 — 재화와 전적. localStorage에 저장한다.
 *
 * 서버가 아니라 localStorage인 이유: 서버 저장은 Verse8 PVP 네트코드 작업에 딸려 오는
 * 것이라 그때 같이 옮기는 게 맞다. 프로토타입 단계에서 서버부터 붙이면 검증이 느려진다.
 * 옮길 때 손댈 곳이 이 파일 하나가 되도록 저장/불러오기를 여기로 몰아뒀다.
 *
 * `sim/`은 이 모듈을 몰라야 한다. 계정 상태가 시뮬레이션에 흘러들면 서버 권위 PVP에서
 * 클라이언트마다 결과가 갈라진다.
 */
import { speedMulFor } from '../sim/config';
import type { MatchState, PlayerId, PlayerMods } from '../sim/types';
import { DEFAULT_PROFILE, isProfileId, type ProfileId } from '../profiles';
import { DEFAULT_UNIT_KIND, UNIT_KIND_META, isPremiumKind, isUnitKind, unitPowerOf, type UnitKind } from '../units';

const STORAGE_KEY = 'towerwar.account.v1';

/**
 * 저장 형식이 바뀌면 올린다.
 * v1 = 강화 없음, v2 = 전투력+공속, v3 = 공속만, v4 = 유닛 생김새,
 * v5 = 봇전 전적 분리, v6 = 닉네임, v7 = 프로필 아바타, v8 = 기본 생김새가 BeerGang,
 * v9 = PVP 점수, v10 = 유료(VX) 소유.
 */
const SCHEMA_VERSION = 10;

/** 읽어서 살릴 수 있는 형식들. 여기 없는 값이면 기본값으로 되돌린다. */
const KNOWN_VERSIONS = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, SCHEMA_VERSION]);

/** 닉네임 길이 상한. HUD에 들어가야 해서 짧다. `server.js` 의 `NAME_MAX` 와 같아야 한다. */
export const NAME_MAX = 12;

/**
 * **디버그: 상점의 모든 것을 열어 둔다** (2026-08-03 사용자 지시).
 *
 * 유닛 5종 + 유료 무지개 + 배속이 전부 가진 것으로 보인다. 코인도 강화도 안 건드린다 —
 * 여기서 여는 것은 **소유 판정뿐**이다.
 *
 * **화면에만 먹는다.** 서버는 이 값을 모르므로 온라인에서 실제로 입으려 하면
 * `selectUnitKind` 가 거절한다 (오프라인·봇전에서는 그대로 먹는다).
 *
 * **출시 전에 `false` 로 되돌릴 것. 여기 하나만 고치면 된다.**
 */
export const DEBUG_UNLOCK_ALL = false;

/** 배속을 여는 유료 항목의 id. `server.js` 의 `PREMIUM_ITEMS` 와 같아야 한다. */
export const TEMPO_ITEM = 'tempo_boost';

/**
 * 새 계정의 시작 점수. **`server.js` 의 `DEFAULT_RATING` 과 같아야 한다.**
 *
 * 화면에는 이 숫자가 그대로 나간다. 티어 구간(브론즈·실버…)을 뒀다가 걷어냈다
 * (2026-08-01, 사용자 지시) — 되살리지 말 것. 구간이 있으면 같은 티어 안의 변동이
 * 안 보여서 점수를 봐도 올랐는지 내렸는지 모른다.
 */
export const DEFAULT_RATING = 1000;

/**
 * 닉네임 정리. **`server.js` 의 `cleanName` 과 같은 규칙이다** —
 * 화면에 보이는 것과 저장되는 것이 다르면 왜 이름이 바뀌었는지 알 수가 없다.
 *
 * 제어문자를 지우는 이유: 줄바꿈이나 방향 제어 문자가 들어오면 HUD가 깨진다.
 */
export function cleanName(v: unknown): string {
  return String(v ?? '')
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NAME_MAX);
}

export interface Account {
  version: number;
  /** 닉네임. 빈 문자열이면 아직 안 정한 것 — 첫 실행에서 설정 화면이 뜬다. */
  name: string;
  /** 프로필 아바타. 순수 외형이라 시뮬레이션은 모른다 (src/profiles.ts). */
  profile: ProfileId;
  coins: number;
  wins: number;
  losses: number;
  draws: number;
  /** 상점에서 산 공속 강화 단계. speedMulFor가 배수로 바꾼다. */
  speedLevel: number;
  /** 상점에서 산 유닛 생김새들. 기본 생김새는 여기 없어도 쓸 수 있다. */
  ownedUnits: UnitKind[];
  /** 지금 판에 나갈 생김새. */
  unitKind: UnitKind;
  /**
   * 봇 대체 판의 전적. 화면에는 안 드러내지만(§-7) 따로 센다 —
   * 안 그러면 나중에 밸런스를 볼 때 이 표본이 사람이었는지 봇이었는지 알 수 없다.
   */
  soloWins: number;
  soloLosses: number;
  soloDraws: number;
  /**
   * 점수(Elo). **서버가 정하는 값이다.** 봇전에서도 움직인다 — 플레이어는 봇인 것을
   * 모르므로(§-7) 봇전만 안 움직이면 "이겼는데 왜 안 올라"가 된다. 봇 상대 점수와
   * 봇의 가상 점수는 플레이어의 현재 점수와 같고, 변동폭은 `RATING_K_SOLO` 에 있다.
   *
   * **오프라인 경로에서는 안 바뀐다** (`applyReward`). 서버가 없으면 점수를 매길
   * 근거가 없고, 로컬에서 올려 봐야 서버에 안 올라간다 (`store.ts` 머리말).
   */
  rating: number;
  /**
   * 유료(VX)로 열린 것들. **코인으로 산 `ownedUnits` 와 갈라 둔다** — 획득 경로가
   * 다르고, 섞으면 나중에 무엇이 유료였는지 구분이 안 된다.
   *
   * **유닛 종류가 아닌 것도 들어온다** (`TEMPO_ITEM`). 그래서 `UnitKind[]` 가 아니라
   * `string[]` 이다 — 유료 항목이 늘 유닛인 것은 아니다.
   *
   * **서버가 진짜다.** 오프라인에서는 절대 안 채워진다 — 결제는 Verse8 쪽에서
   * 일어나고 서버 계정에만 기록된다 (`net/vx.ts`).
   */
  entitlements: string[];
}

export function defaultAccount(): Account {
  return {
    version: SCHEMA_VERSION,
    name: '',
    profile: DEFAULT_PROFILE,
    coins: 0,
    wins: 0,
    losses: 0,
    draws: 0,
    speedLevel: 0,
    ownedUnits: [],
    unitKind: DEFAULT_UNIT_KIND,
    soloWins: 0,
    soloLosses: 0,
    soloDraws: 0,
    rating: DEFAULT_RATING,
    entitlements: [],
  };
}

/**
 * `num()` 과 달리 값이 없을 때 0이 아니라 기본 점수로 떨어진다.
 * **점수에는 `num()` 을 쓰면 안 된다** — 0은 "많이 져서 0점"과 "한 번도 안 쟀음"을
 * 구분하지 못한다. `server.js` 의 `numOr` 과 같은 규칙이다.
 */
function ratingOr(v: unknown, fallback: number): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : fallback;
}

/**
 * 서버가 든 계정을 로컬 형태로. 서버가 붙어 있을 때는 **이쪽이 진짜다** —
 * localStorage 는 오프라인용 사본으로만 남는다.
 */
export function fromRemote(r: {
  name?: string;
  profile?: string;
  coins: number; wins: number; losses: number; draws: number;
  speedLevel: number; ownedUnits: string[]; unitKind: string;
  soloWins: number; soloLosses: number; soloDraws: number;
  rating?: number;
  entitlements?: string[];
}): Account {
  const owned = r.ownedUnits.filter(isUnitKind);
  const kind = isUnitKind(r.unitKind) ? r.unitKind : DEFAULT_UNIT_KIND;
  const a: Account = {
    version: SCHEMA_VERSION,
    name: cleanName(r.name),
    profile: isProfileId(r.profile) ? r.profile : DEFAULT_PROFILE,
    coins: num(r.coins),
    wins: num(r.wins),
    losses: num(r.losses),
    draws: num(r.draws),
    speedLevel: num(r.speedLevel),
    ownedUnits: [...new Set(owned)],
    unitKind: kind,
    soloWins: num(r.soloWins),
    soloLosses: num(r.soloLosses),
    soloDraws: num(r.soloDraws),
    rating: ratingOr(r.rating, DEFAULT_RATING),
    entitlements: [...new Set(r.entitlements ?? [])],
  };
  return { ...a, unitKind: unitKindOf(a) };
}

// ── 로비 상점 ─────────────────────────────────────────────────────

/**
 * 살 수 있는 축. **지금은 공속 하나뿐이다.**
 *
 * 멤버가 하나인 유니온을 남겨 둔 이유는 상점 UI와 저장 코드가 축을 매개변수로 받게
 * 짜여 있어서다 — 축이 다시 늘 때 여기만 늘리면 된다.
 * 전투력 축은 두 번 만들고 두 번 제거했다. 되살리지 말 것 (sim/config.ts 참고).
 */
export type UpgradeKind = 'speed';

/**
 * 앞쪽 단계의 코인 가격. **이 표가 끝나도 강화는 계속 살 수 있다** —
 * 그 뒤로는 `SPEED_COST_GROWTH` 로 이어 붙인다 (`speedCostAt`).
 *
 * **잠정치다.** 승리 보상이 100 + 타워×8 이라 판당 대략 150~180이 들어온다.
 */
export const UPGRADE_COSTS: Record<UpgradeKind, readonly number[]> = {
  speed: [300, 700, 1300, 2200, 3500],
};

/**
 * 표를 넘어선 단계의 가격 증가율. 표의 증가폭(400→600→900→1300, 약 1.5배)을 그대로 잇는다.
 *
 * **상한을 없앤 뒤로 이것이 유일한 제동장치다** (2026-08-04 사용자 지시로 단계 제한 제거).
 * 값을 낮추면 후반 강화가 싸져서 판이 빨리 기운다.
 */
const SPEED_COST_GROWTH = 1.5;

/**
 * `level` 단계에서 다음 단계로 갈 때의 가격. **`server.js` 의 같은 이름과 반드시 같아야 한다** —
 * 서버가 진짜 가격이고 여기는 화면 표시용이다 (§-10). 어긋나면 "보이는 값과 깎이는 값이 다름"이 된다.
 *
 * 100원 단위로 반올림해 값이 지저분해지지 않게 한다.
 */
export function speedCostAt(level: number): number {
  const table = UPGRADE_COSTS.speed;
  if (level < table.length) return table[level];
  let cost = table[table.length - 1];
  for (let i = table.length; i <= level; i++) {
    cost = Math.round((cost * SPEED_COST_GROWTH) / 100) * 100;
  }
  return cost;
}

export const UPGRADE_LABEL: Record<UpgradeKind, string> = {
  speed: '생산 속도',
};

/** 저장값이 오염돼 있어도 0 이상으로 잘라서 돌려준다. **상한은 없다.** */
export function upgradeLevelOf(a: Account, _kind: UpgradeKind): number {
  return Math.max(0, Math.floor(num(a.speedLevel)));
}

/**
 * 다음 단계 가격. **`null` 을 돌려주는 일이 없다 — 상한이 없어졌다** (2026-08-04).
 * 부르는 쪽이 아직 `null` 을 만렙으로 다루고 있어도 그 분기가 안 밟힐 뿐이라 안전하다.
 */
export function upgradeCostOf(a: Account, kind: UpgradeKind): number | null {
  if (kind !== 'speed') return null;
  return speedCostAt(upgradeLevelOf(a, kind));
}

/**
 * 한 단계 구매한 새 계정. 만렙이거나 코인이 모자라면 null.
 *
 * 원본을 바꾸지 않는다 — 호출부가 반환값을 저장해야 실제로 적용된다.
 */
export function buyUpgrade(a: Account, kind: UpgradeKind): Account | null {
  const cost = upgradeCostOf(a, kind);
  if (cost === null || a.coins < cost) return null;
  return { ...a, coins: a.coins - cost, speedLevel: upgradeLevelOf(a, kind) + 1 };
}

/**
 * 계정 강화를 매치가 이해하는 형태로. 이 함수가 계정과 시뮬레이션 사이의 유일한 통로다.
 * `sim/`이 계정을 모르게 유지하려면 변환이 반드시 이쪽에 있어야 한다.
 */
export function modsFor(a: Account): PlayerMods {
  return {
    speedMul: speedMulFor(upgradeLevelOf(a, 'speed')),
    // 착용한 종류가 유닛의 힘이다. `unitKindOf` 로 읽는 이유: 저장본이 오염됐거나
    // 안 가진 것이 착용돼 있으면 여기서 기본값으로 떨어져야 sim 에 들어가지 않는다.
    unitPower: unitPowerOf(unitKindOf(a)),
  };
}

// ── 유닛 종류 ─────────────────────────────────────────────────────
//
// **2026-07-31부터 외형만이 아니다** (사용자 지시). 종류가 `power`(체력=공격력)를 들고
// 그 값이 `modsFor` 를 통해 sim 으로 간다. 카탈로그는 src/units.ts.

/**
 * 기본 생김새는 가격 0이라 사지 않아도 가지고 있다.
 *
 * **유료 종류는 `price` 를 안 본다.** 무지개 비어갱도 `price: 0` 이라 가격만 보면
 * "기본 제공"으로 읽혀 공짜가 된다 — 소유는 `entitlements` 가 든다.
 */
export function ownsUnitKind(a: Account, kind: UnitKind): boolean {
  if (DEBUG_UNLOCK_ALL) return true;
  if (isPremiumKind(kind)) return a.entitlements.includes(kind);
  return UNIT_KIND_META[kind].price === 0 || a.ownedUnits.includes(kind);
}

/**
 * 한 종류 구매한 새 계정. 이미 가졌거나 코인이 모자라면 null. 사면 바로 착용한다.
 *
 * **유료 종류는 여기로 안 온다** — 코인으로 살 수 없다 (`server.js` 의 `buyUnitKind`).
 */
export function buyUnitKind(a: Account, kind: UnitKind): Account | null {
  if (isPremiumKind(kind)) return null;
  const price = UNIT_KIND_META[kind].price;
  if (ownsUnitKind(a, kind) || a.coins < price) return null;
  return { ...a, coins: a.coins - price, ownedUnits: [...a.ownedUnits, kind], unitKind: kind };
}

/** 가진 것만 착용할 수 있다. 못 고르면 원본 그대로 — 호출부가 분기하지 않게 한다. */
export function selectUnitKind(a: Account, kind: UnitKind): Account {
  return ownsUnitKind(a, kind) ? { ...a, unitKind: kind } : a;
}

/**
 * 배속을 켤 수 있는가 (유료 항목).
 *
 * **`DEBUG_UNLOCK_ALL` 이 켜져 있으면 언제나 참이다** — 개발 중에 매번 결제를 태울
 * 수는 없다. PVP에서는 서버가 내려준 값이 이걸 덮으므로(`MatchSetup.tempo`)
 * 이 플래그로 남의 판을 빠르게 만들 수는 없다.
 */
export function canUseTempo(a: Account): boolean {
  return DEBUG_UNLOCK_ALL || a.entitlements.includes(TEMPO_ITEM);
}

/** 저장값이 오염됐거나 안 가진 것이 착용돼 있으면 기본 생김새로 떨어진다. */
export function unitKindOf(a: Account): UnitKind {
  return ownsUnitKind(a, a.unitKind) ? a.unitKind : DEFAULT_UNIT_KIND;
}


/** 매치 하나가 끝났을 때 무엇을 얼마나 주는가. 순수 함수 — 저장소를 모른다. */
export interface Reward {
  outcome: 'win' | 'loss' | 'draw';
  /** 승패로 주는 기본 보상. */
  base: number;
  /** 끝까지 들고 있던 타워 수에 붙는 보너스. */
  towerBonus: number;
  towers: number;
  total: number;
}

const BASE_WIN = 100;
const BASE_DRAW = 50;
const BASE_LOSS = 30;
/** 남은 타워 1개당. 이겨도 간신히 이긴 판과 압도한 판을 가른다. */
const PER_TOWER = 8;

export function rewardFor(state: MatchState, local: PlayerId): Reward {
  const outcome: Reward['outcome'] =
    state.winner === 0 ? 'draw' : state.winner === local ? 'win' : 'loss';
  const base = outcome === 'win' ? BASE_WIN : outcome === 'draw' ? BASE_DRAW : BASE_LOSS;
  const towers = state.towers.filter((t) => t.owner === local).length;
  const towerBonus = towers * PER_TOWER;
  return { outcome, base, towerBonus, towers, total: base + towerBonus };
}

/** 보상을 계정에 반영한 새 계정. 원본을 바꾸지 않는다. */
export function applyReward(account: Account, reward: Reward): Account {
  // 오프라인 경로에서만 쓴다. 서버가 붙어 있으면 서버가 계산해 계정을 돌려준다.
  // 오프라인은 언제나 봇전이다. 일반 전적에도 합산하되 밸런스 분석용 solo 통계도 남긴다.
  return {
    ...account,
    coins: account.coins + reward.total,
    wins: account.wins + (reward.outcome === 'win' ? 1 : 0),
    losses: account.losses + (reward.outcome === 'loss' ? 1 : 0),
    draws: account.draws + (reward.outcome === 'draw' ? 1 : 0),
    soloWins: account.soloWins + (reward.outcome === 'win' ? 1 : 0),
    soloLosses: account.soloLosses + (reward.outcome === 'loss' ? 1 : 0),
    soloDraws: account.soloDraws + (reward.outcome === 'draw' ? 1 : 0),
  };
}

/**
 * 전적만 초기화한 새 계정. **점수(rating)·코인·유닛은 그대로 둔다** (사용자 지시:
 * "전적만 초기화, 점수 초기화는 아니야"). 화면에 뜨는 승/패/무(`wins/losses/draws`)만
 * 0으로. **봇전 밸런스 분석용 solo 통계(§-7)는 건드리지 않는다** — 화면에 안 뜨는
 * 별개 축이고, 초기화하면 표본 이력이 사라진다.
 */
export function resetRecord(account: Account): Account {
  return { ...account, wins: 0, losses: 0, draws: 0 };
}

/**
 * 저장본의 생김새를 지금 형식으로 옮긴다.
 *
 * 카탈로그(`units.ts`)에서 사라진 종류는 전부 기본값으로 떨어진다. Tiny Swords 5종을
 * 걷어냈을 때(2026-07-30) 옛 저장본의 `warrior`·`pawn` 등이 여기서 걸러진다.
 *
 * **거기 쓴 코인은 환불하지 않는다.** §-3에서 전투력 축을 지웠을 때와 같은 처리다 —
 * 프로토타입이라 실사용자가 없고, 환불 경로를 만들면 그것대로 유지 비용이 붙는다.
 */
function migrateUnitKind(raw: unknown): UnitKind {
  return isUnitKind(raw) ? raw : DEFAULT_UNIT_KIND;
}

/**
 * 저장된 계정. 없거나 깨졌으면 기본값.
 *
 * localStorage는 사생활 보호 모드나 스토리지 차단 설정에서 접근만 해도 던진다.
 * 그때 게임이 멈추면 안 되므로 전부 삼키고 기본값으로 간다.
 */
export function loadAccount(): Account {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultAccount();
    const parsed = JSON.parse(raw) as Partial<Account> & { unitPowerLevel?: unknown };
    // 아는 버전이면 전부 살린다. 재화를 날리지 않으려는 것 —
    // v1은 강화가 없던 형식, v2는 전투력 강화가 있던 형식이라 필드가 남아 있을 수 있다.
    // v2의 unitPowerLevel은 그냥 버린다(전투력 축 제거). 거기 쓴 코인은 환불하지 않는다.
    if (!KNOWN_VERSIONS.has(parsed.version as number)) return defaultAccount();
    const owned = Array.isArray(parsed.ownedUnits) ? parsed.ownedUnits.filter(isUnitKind) : [];
    const account: Account = {
      version: SCHEMA_VERSION,
      name: cleanName(parsed.name),
      profile: isProfileId(parsed.profile) ? parsed.profile : DEFAULT_PROFILE,
      coins: num(parsed.coins),
      wins: num(parsed.wins),
      losses: num(parsed.losses),
      draws: num(parsed.draws),
      speedLevel: num(parsed.speedLevel),
      // 중복이 쌓이면 소유 목록이 무한히 길어진다. 저장할 때가 아니라 읽을 때 정리한다.
      ownedUnits: [...new Set(owned)],
      unitKind: migrateUnitKind(parsed.unitKind),
      soloWins: num(parsed.soloWins),
      soloLosses: num(parsed.soloLosses),
      soloDraws: num(parsed.soloDraws),
      // v8 이하 저장본에는 없다. 그때는 0이 아니라 시작 점수에서 출발해야 한다.
      rating: ratingOr(parsed.rating, DEFAULT_RATING),
      // **로컬 사본은 참고용이다.** 유료 소유의 진짜 출처는 서버다 — 여기 값을
      // 손으로 넣어도 착용은 서버가 거절한다 (`selectUnitKind`).
      entitlements: [...new Set(Array.isArray(parsed.entitlements) ? parsed.entitlements : [])],
    };
    // 안 가진 것이 착용돼 있으면(손으로 고친 저장본 등) 기본으로 되돌린다.
    return { ...account, unitKind: unitKindOf(account) };
  } catch {
    return defaultAccount();
  }
}

export function saveAccount(account: Account): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(account));
  } catch {
    // 저장 실패는 판을 막을 이유가 아니다. 이번 세션 동안은 메모리에만 남는다.
  }
}

export function clearAccount(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // 무시
  }
}

/** 저장된 값이 문자열·null·NaN이어도 0으로 떨어지게 한다. */
function num(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}
