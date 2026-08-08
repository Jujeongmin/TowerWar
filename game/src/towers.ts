/**
 * 타워 카탈로그.
 *
 * **`units.ts` 와 같은 구조다** — 종류가 외형이자 성능이다. 여기서는 `speed` 가
 * `PlayerMods.speedMul` 로 sim 에 들어간다. 상점에서 고르는 값이자 렌더러가 그리는
 * 값이자 규칙까지 정하는 값이라 `account/`도 `render/`도 아닌 여기 있다.
 * (**`sim/`은 이 파일을 몰라야 한다** — 숫자만 건네받는다.)
 *
 * ── 그림은 옛 레벨 사다리를 되살린 것이다 ──────────────────────
 *
 * `assets/tower/{p1,p2,neutral}/lv1~lv5.png` 는 2026-07-30에 타워 레벨을 없애면서
 * `lv3` 하나만 쓰게 된 옛 사다리다(작은 집 → 큰 집 → 병영 → 석탑 → 성채).
 * 그림 자체가 이미 "셀수록 세 보이는" 순서라 새 에셋 없이 여섯 단계를 채운다.
 *
 * ── 크기는 종류별로 안 바꾼다 ────────────────────────────────
 *
 * 유닛은 `sizeFactorOf` 로 센 것을 크게 그리지만 타워는 그러면 안 된다. 타워 반경은
 * 병력 수가 정하고 **그것이 게임 규칙이다** — 경로가 그 원에 걸리면 개설할 수 없다.
 * 성채라고 크게 그리면 그림과 판정이 어긋나 "왜 여기 경로가 안 그어지지"가 된다.
 */
import { t } from './i18n';

export const TOWER_KINDS = [
  'tower_hut',
  'tower_house',
  'tower_barracks',
  'tower_keep',
  'tower_citadel',
  'tower_prime',
] as const;
export type TowerKind = (typeof TOWER_KINDS)[number];

/**
 * 계정 없이도 쓸 수 있는 기본 외형. 가격 0이고 상점에서 잠기지 않는다.
 *
 * **중립 타워도 이 그림으로 그린다** (`render/sprites.ts`). 가장 낮은 것을 중립에
 * 두어야 무과금 플레이어의 타워가 주인 없는 타워보다 초라해 보이지 않는다.
 */
export const DEFAULT_TOWER_KIND: TowerKind = 'tower_hut';

export interface TowerKindMeta {
  /** 그림 파일 이름(확장자 없이). `assets/tower/<진영>/<art>.png` 를 읽는다. */
  art: string;
  /** 코인 가격. 0이면 기본 제공. */
  price: number;
  /**
   * 생산속도 배수. `PlayerMods.speedMul` 로 sim 에 들어간다.
   *
   * **밸런스 손잡이가 여기 한 줄이다.** 서버·봇·상점 표시가 전부 이 값을 따라온다.
   */
  speed: number;
  /**
   * 코인으로 못 사는 유료 종류인가. 사는 곳은 Verse8 CrossRamp 상점이고
   * (`net/vx.ts`), 소유는 계정의 `entitlements` 가 든다. **`price` 는 무시된다.**
   */
  premium?: true;
  /** 그림이 없어서 다른 종류의 그림을 빌려 쓰는 경우 그 종류. */
  spriteOf?: TowerKind;
  /** 코드로 그리는 아우라. 유료 종류를 그림 없이 구분하는 수단이다. */
  aura?: 'rainbow';
  /**
   * 왕관과 궤도 반짝임을 얹는가. **최상위 하나를 "누가 봐도 제일 좋은 것"으로 만든다**
   * (2026-08-07 사용자 지시).
   *
   * 그림을 새로 굽지 않고 코드로 꾸미는 이유: 최상위는 성채 그림을 빌려 쓰므로
   * (`spriteOf`) 아우라만으로는 성채와 거의 같아 보였다. **스프라이트를 물들이지는
   * 않는다** — 타워 그림의 색이 "누구 편인가"의 신호라(p1/p2 폴더가 다른 색이다)
   * 금색으로 덮으면 진영 구분이 죽는다. 그래서 건물 위에 **얹기만** 한다.
   */
  regal?: true;
  /** 상점 카드 강조색. 진영색(파랑 `#3fbdf1`·빨강 `#f2555f`)을 피한다. */
  accent?: string;
}

/**
 * **가격표가 `server.js` 의 `TOWER_PRICES` 에도 있다.** 서버가 소유·착용을 판정하므로
 * 어긋나면 "상점에는 보이는데 못 입는"이 된다. 고칠 때 양쪽을 같이 고칠 것.
 *
 * `speed` 는 서버에 없다 — 서버는 이름만 내려주고 배수 변환은 여기서만 한다.
 *
 * ── 사다리는 `lv` 번호 순이 아니다 (2026-08-07 사용자 지시) ──────
 *
 * 옛 레벨 사다리를 그대로 쓰면 **석탑(`lv4`)이 병영(`lv3`) 뒤에 와서 약해 보인다** —
 * 석탑은 높지만 좁고, 병영은 넓어서 화면에서 더 크게 읽힌다. 그래서 석탑을 두 번째로
 * 올렸다: 오두막 → **석탑** → 집 → 병영 → 성채.
 *
 * **이름과 그림은 안 옮겼다** (석탑은 언제나 `lv4`다). 옮긴 것은 `price` 와 `speed` 뿐이다 —
 * 사다리의 자리는 그 두 값이 정하고, `SPEED_ORDER`·`towerTierOf`·`stepDownTower` 가
 * 전부 `speed` 에서 파생되므로 여기만 고치면 봇 보정도 등급 표시도 따라온다.
 */
export const TOWER_KIND_META: Record<TowerKind, TowerKindMeta> = {
  // 유닛과 같은 사다리다 — 2026-08-09에 함께 5배로 올렸다 (사용자 지시).
  tower_hut: { art: 'lv1', price: 0, speed: 1 },
  tower_keep: { art: 'lv4', price: 2000, speed: 1.25, accent: '#e8eef5' },
  tower_house: { art: 'lv2', price: 4500, speed: 1.5, accent: '#f5c542' },
  tower_barracks: { art: 'lv3', price: 7500, speed: 1.75, accent: '#34d399' },
  tower_citadel: { art: 'lv5', price: 12000, speed: 2, accent: '#a78bfa' },
  tower_prime: {
    art: 'lv5',
    price: 0,
    speed: 2.5,
    premium: true,
    spriteOf: 'tower_citadel',
    aura: 'rainbow',
    regal: true,
    accent: '#f2f7fb',
  },
};

/** 화면에 보이는 이름. **언어 표에 있다** (`i18n.ts`) — 카탈로그는 규칙만 든다. */
export function towerLabelOf(kind: TowerKind): string {
  return t().towerLabels[kind] ?? kind;
}

/** 상점 카드의 한 줄 설명. 이름과 같은 이유로 언어 표에 있다. */
export function towerBlurbOf(kind: TowerKind): string {
  return t().towerBlurbs[kind] ?? '';
}

export function isTowerKind(v: unknown): v is TowerKind {
  return typeof v === 'string' && (TOWER_KINDS as readonly string[]).includes(v);
}

/** 코인으로 못 사는 종류인가. 상점이 이걸 보고 다른 줄에 놓는다. */
export function isPremiumTower(kind: TowerKind): boolean {
  return TOWER_KIND_META[kind]?.premium === true;
}

/** 실제로 파일을 읽을 종류. 그림이 없는 종류는 빌려 쓴다 (`spriteOf`). */
export function towerSpriteKindOf(kind: TowerKind): TowerKind {
  return TOWER_KIND_META[kind]?.spriteOf ?? kind;
}

/**
 * 종류 → 생산속도. **모르는 값이 오면 기본값으로 떨어뜨린다.**
 *
 * 여기서 던지면 안 된다 — PVP에서 상대가 내 카탈로그에 없는 종류를 들고 있을 때
 * (배포 시점이 어긋난 클라이언트) 판이 시작도 못 하고 죽는다.
 */
export function towerSpeedOf(kind: TowerKind): number {
  return TOWER_KIND_META[kind]?.speed ?? TOWER_KIND_META[DEFAULT_TOWER_KIND].speed;
}

/** 코인으로 사는 종류. 상점 격자 순서다. */
export const SHOP_TOWER_ORDER: readonly TowerKind[] = [
  'tower_hut',
  'tower_keep',
  'tower_house',
  'tower_barracks',
  'tower_citadel',
];

/** 유료 종류. 코인 목록과 갈라 둔다 — 살 수 있는 곳이 다르다. */
export const SHOP_PREMIUM_TOWER_ORDER: readonly TowerKind[] = ['tower_prime'];

/**
 * 속도 오름차순 전체 목록. 상점 순서와 달리 **유료 종류도 포함한다** —
 * "한 단계 아래"를 셀 때 유료(2.5)에서 성채(2.0)로 내려갈 수 있어야 한다.
 *
 * 카탈로그에서 만들어 낸다. 손으로 적어 두면 종류를 추가할 때 조용히 어긋난다.
 */
export const SPEED_ORDER: readonly TowerKind[] = [...TOWER_KINDS].sort(
  (a, b) => TOWER_KIND_META[a].speed - TOWER_KIND_META[b].speed,
);

/** 등급. `SPEED_ORDER` 에서의 자리다 — 기본이 0, 가장 빠른 것이 마지막. */
export function towerTierOf(kind: TowerKind): number {
  return Math.max(0, SPEED_ORDER.indexOf(kind));
}

/** 등급 사다리의 끝. 아우라 넓이·진하기의 분모다 (`renderer.drawTierAura`). */
export const MAX_TOWER_TIER = TOWER_KINDS.length - 1;

/**
 * 카탈로그에서 가장 빠른 값. **상점 카드 속도 막대의 분모다** (`shop-scene.ts`).
 *
 * 유닛의 `MAX_UNIT_POWER` 와 같은 자리다 — 손으로 적어 두면 종류를 추가할 때
 * 조용히 어긋나므로 표에서 만들어 낸다.
 */
export const MAX_TOWER_SPEED = Math.max(
  ...Object.values(TOWER_KIND_META).map((m) => m.speed),
);

/**
 * 한 단계 아래 종류. 봇이 사람보다 한 단계 낮은 타워를 쓰는 데 쓴다
 * (`app/difficulty.ts`). 가장 낮은 것에서는 자기 자신이 나온다 —
 * 부르는 쪽이 그때 바닥값을 따로 쓴다.
 */
export function stepDownTower(kind: TowerKind): TowerKind {
  const i = SPEED_ORDER.indexOf(kind);
  if (i <= 0) return SPEED_ORDER[0] ?? DEFAULT_TOWER_KIND;
  return SPEED_ORDER[i - 1];
}
