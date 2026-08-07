# 타워 외형이 생산속도를 정한다 — 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 타워 외형을 상점에서 팔고, 산 외형이 그 사람의 생산속도(`PlayerMods.speedMul`)를 정하게 한다.

**Architecture:** 유닛 종류(`units.ts`)가 이미 "외형이 성능을 정한다"를 구현하고 있다. 그 구조를 타워로 복제한다 — 카탈로그는 `towers.ts`, 소유·착용은 서버 계정, 판 조건은 서버가 방 상태에 박아 양쪽이 똑같이 읽는다. `sim/` 은 카탈로그를 모르고 숫자만 받는다.

**Tech Stack:** TypeScript(클라이언트, Vite), 단일 파일 JS(`server.js`, Verse8 샌드박스), 검증은 `npm run verify`(tsc + `tools/server-harness.mjs` + vite build).

## Global Constraints

- **설계 문서**: `docs/superpowers/specs/2026-08-06-tower-skin-speed-design.md` — 충돌하면 그쪽이 기준이다.
- **`sim/` 은 `towers.ts` 를 import 하면 안 된다.** 숫자만 `PlayerMods.speedMul` 로 건네받는다.
- **서버는 종류 이름만 내려준다.** 이름 → 배수 변환(`towerSpeedOf`)은 클라이언트에만 둔다. 공식을 서버에 복사하지 말 것.
- **모르는 종류에 `throw` 금지.** 기본값(`tower_hut`)으로 떨어뜨린다 — 배포 시점이 어긋난 클라이언트 때문이다.
- **가격표가 두 곳에 있다.** `game/src/towers.ts` 의 `TOWER_KIND_META.price` 와 `server.js` 의 `TOWER_PRICES` 가 같아야 한다. 서버가 진짜다.
- **생산속도 값** (설계 확정): `tower_hut` 1.00 / `tower_house` 1.25 / `tower_barracks` 1.50 / `tower_keep` 1.75 / `tower_citadel` 2.00 / `tower_prime` 2.50
- **가격** (설계 확정): 0 / 400 / 900 / 1500 / 2400 / VX 전용
- **그림 파일** (이미 저장소에 있다): `game/public/assets/tower/{p1,p2,neutral}/lv1.png` ~ `lv5.png`
- **클라이언트에는 테스트 러너가 없다.** 클라이언트 과제의 검증은 `npx tsc --noEmit` + `npx vite build` + (시각 변경이면) 프리뷰 스크린샷이다. 진짜 TDD 가 가능한 곳은 `server.js`(과제 3) 뿐이다 — 거기서는 하네스 검사를 **먼저** 쓴다.
- **커밋 메시지**는 한국어, 기존 저장소 관례를 따른다. 끝에 `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

## 파일 구조

| 파일 | 책임 |
|---|---|
| `game/src/towers.ts` (신규) | 타워 카탈로그. 종류·가격·속도·그림 이름·등급. 규칙만 들고 문자열은 `i18n` 에서 읽는다 |
| `game/src/account/account.ts` | 소유·착용 판정, `modsFor` 가 속도를 뽑는다 |
| `game/src/account/store.ts` | `pickTower` — 온라인이면 서버, 오프라인이면 로컬 |
| `server.js` | 가격·소유의 **진짜 판정**, 방 상태에 `towerKinds` 를 박는다 |
| `game/src/net/types.ts`·`agent8.ts` | 서버 ↔ 클라이언트 경계에 `towerKinds` 추가 |
| `game/src/app/difficulty.ts` | 봇이 한 단계 낮은 타워를 쓴다 |
| `game/src/app/match-scene.ts` | 종류 → `speedMul` 변환, 렌더러에 종류 전달 |
| `game/src/render/sprites.ts`·`renderer.ts` | 종류별 타워 그림, 중립 `lv1`, 유료 아우라 |
| `game/src/app/shop-scene.ts`·`index.html`·`i18n.ts` | 상점 카드와 3개 언어 문자열 |
| `tools/server-harness.mjs` | 서버 판정 검사 |
| `game/src/net/lockstep-check.ts` | 양쪽 속도가 달라도 결정론이 유지되는지 |

---

### Task 1: 타워 카탈로그

**Files:**
- Create: `game/src/towers.ts`

**Interfaces:**
- Consumes: `game/src/i18n.ts` 의 `t()` (기존)
- Produces:
  - `TOWER_KINDS: readonly TowerKind[]`, `type TowerKind`
  - `DEFAULT_TOWER_KIND: TowerKind` (= `'tower_hut'`)
  - `interface TowerKindMeta { art: string; price: number; speed: number; premium?: true; spriteOf?: TowerKind; aura?: 'rainbow'; accent?: string }`
  - `TOWER_KIND_META: Record<TowerKind, TowerKindMeta>`
  - `isTowerKind(v: unknown): v is TowerKind`
  - `isPremiumTower(kind: TowerKind): boolean`
  - `towerSpriteKindOf(kind: TowerKind): TowerKind`
  - `towerSpeedOf(kind: TowerKind): number`
  - `stepDownTower(kind: TowerKind): TowerKind`
  - `towerLabelOf(kind: TowerKind): string`, `towerBlurbOf(kind: TowerKind): string`
  - `SHOP_TOWER_ORDER: readonly TowerKind[]`, `SHOP_PREMIUM_TOWER_ORDER: readonly TowerKind[]`
  - `SPEED_ORDER: readonly TowerKind[]`, `towerTierOf(kind: TowerKind): number`, `MAX_TOWER_TIER: number`

- [ ] **Step 1: 카탈로그 파일을 만든다**

`game/src/towers.ts`:

```ts
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
  /** 상점 카드 강조색. 진영색(파랑 `#3fbdf1`·빨강 `#f2555f`)을 피한다. */
  accent?: string;
}

/**
 * **가격표가 `server.js` 의 `TOWER_PRICES` 에도 있다.** 서버가 소유·착용을 판정하므로
 * 어긋나면 "상점에는 보이는데 못 입는"이 된다. 고칠 때 양쪽을 같이 고칠 것.
 *
 * `speed` 는 서버에 없다 — 서버는 이름만 내려주고 배수 변환은 여기서만 한다.
 */
export const TOWER_KIND_META: Record<TowerKind, TowerKindMeta> = {
  tower_hut: { art: 'lv1', price: 0, speed: 1 },
  tower_house: { art: 'lv2', price: 400, speed: 1.25, accent: '#e8eef5' },
  tower_barracks: { art: 'lv3', price: 900, speed: 1.5, accent: '#f5c542' },
  tower_keep: { art: 'lv4', price: 1500, speed: 1.75, accent: '#34d399' },
  tower_citadel: { art: 'lv5', price: 2400, speed: 2, accent: '#a78bfa' },
  tower_prime: {
    art: 'lv5',
    price: 0,
    speed: 2.5,
    premium: true,
    spriteOf: 'tower_citadel',
    aura: 'rainbow',
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
  'tower_house',
  'tower_barracks',
  'tower_keep',
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
 * 한 단계 아래 종류. 봇이 사람보다 한 단계 낮은 타워를 쓰는 데 쓴다
 * (`app/difficulty.ts`). 가장 낮은 것에서는 자기 자신이 나온다 —
 * 부르는 쪽이 그때 바닥값을 따로 쓴다.
 */
export function stepDownTower(kind: TowerKind): TowerKind {
  const i = SPEED_ORDER.indexOf(kind);
  if (i <= 0) return SPEED_ORDER[0] ?? DEFAULT_TOWER_KIND;
  return SPEED_ORDER[i - 1];
}
```

- [ ] **Step 2: 언어 표에 자리를 만든다**

`game/src/i18n.ts` 의 `Strings` 인터페이스에서 `unitBlurbs` 바로 아래에 추가:

```ts
  // 타워 카탈로그
  towerLabels: Record<string, string>;
  towerBlurbs: Record<string, string>;
```

세 언어 각각에 값을 넣는다. `en` 의 `unitBlurbs` 블록 바로 뒤:

```ts
  towerLabels: {
    tower_hut: 'Hut',
    tower_house: 'House',
    tower_barracks: 'Barracks',
    tower_keep: 'Keep',
    tower_citadel: 'Citadel',
    tower_prime: 'Prime Citadel',
  },
  towerBlurbs: {
    tower_hut: 'The tower everyone starts with.',
    tower_house: 'A little more room, a little more output.',
    tower_barracks: 'Built to keep troops moving.',
    tower_keep: 'Stone walls, steady supply.',
    tower_citadel: 'The fastest tower coins can buy.',
    tower_prime: 'Fastest of all. VX only.',
  },
```

`ko`:

```ts
  towerLabels: {
    tower_hut: '오두막',
    tower_house: '집',
    tower_barracks: '병영',
    tower_keep: '석탑',
    tower_citadel: '성채',
    tower_prime: '왕성',
  },
  towerBlurbs: {
    tower_hut: '누구나 여기서 시작한다.',
    tower_house: '조금 넓어지고, 조금 더 나온다.',
    tower_barracks: '병력을 계속 내보내려고 지은 것.',
    tower_keep: '돌벽에 꾸준한 보급.',
    tower_citadel: '코인으로 살 수 있는 가장 빠른 타워.',
    tower_prime: '가장 빠르다. VX 전용.',
  },
```

`zh`:

```ts
  towerLabels: {
    tower_hut: '小屋',
    tower_house: '房屋',
    tower_barracks: '兵营',
    tower_keep: '石塔',
    tower_citadel: '城堡',
    tower_prime: '王城',
  },
  towerBlurbs: {
    tower_hut: '所有人的起点。',
    tower_house: '空间大一点，产量多一点。',
    tower_barracks: '为持续出兵而建。',
    tower_keep: '石墙与稳定补给。',
    tower_citadel: '金币能买到的最快塔。',
    tower_prime: '最快的塔。仅限 VX。',
  },
```

- [ ] **Step 3: 타입 검사와 빌드**

```bash
npx tsc --noEmit && npx vite build
```

기대: 오류 0. (아직 아무도 `towers.ts` 를 안 쓰므로 통과만 확인하면 된다.)

- [ ] **Step 4: 커밋**

```bash
git add game/src/towers.ts game/src/i18n.ts
git commit -m "feat: 타워 카탈로그 — 외형이 생산속도를 정한다"
```

---

### Task 2: 계정의 소유·착용

**Files:**
- Modify: `game/src/account/account.ts`
- Modify: `game/src/account/store.ts`

**Interfaces:**
- Consumes: Task 1 의 `TowerKind`·`DEFAULT_TOWER_KIND`·`TOWER_KIND_META`·`isTowerKind`·`isPremiumTower`·`towerSpeedOf`
- Produces:
  - `Account.ownedTowers: TowerKind[]`, `Account.towerKind: TowerKind`
  - `ownsTowerKind(a: Account, kind: TowerKind): boolean`
  - `buyTowerKind(a: Account, kind: TowerKind): Account | null`
  - `selectTowerKind(a: Account, kind: TowerKind): Account`
  - `towerKindOf(a: Account): TowerKind`
  - `AccountStore.pickTower(kind: TowerKind): Promise<void>`

- [ ] **Step 1: 계정 필드를 추가한다**

`game/src/account/account.ts` 의 `import` 에 추가:

```ts
import {
  DEFAULT_TOWER_KIND,
  TOWER_KIND_META,
  isPremiumTower,
  isTowerKind,
  towerSpeedOf,
  type TowerKind,
} from '../towers';
```

`SCHEMA_VERSION` 을 올리고 주석에 줄을 더한다:

```ts
/**
 * 저장 형식이 바뀌면 올린다.
 * v1 = 강화 없음, v2 = 전투력+공속, v3 = 공속만, v4 = 유닛 생김새,
 * v5 = 봇전 전적 분리, v6 = 닉네임, v7 = 프로필 아바타, v8 = 기본 생김새가 BeerGang,
 * v9 = PVP 점수, v10 = 유료(VX) 소유, v11 = 타워 외형(생산속도).
 */
const SCHEMA_VERSION = 11;

/** 읽어서 살릴 수 있는 형식들. 여기 없는 값이면 기본값으로 되돌린다. */
const KNOWN_VERSIONS = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, SCHEMA_VERSION]);
```

`Account` 인터페이스의 `unitKind` 바로 아래에 추가:

```ts
  /**
   * 상점에서 산 타워 외형들. 기본 외형은 여기 없어도 쓸 수 있다.
   *
   * **순수 외형이 아니다** — 착용한 것이 생산속도를 정한다 (`towers.ts`).
   */
  ownedTowers: TowerKind[];
  /** 지금 판에 나갈 타워 외형. 내 타워 **전부**가 이 그림으로 그려진다. */
  towerKind: TowerKind;
```

`defaultAccount()` 의 `unitKind: DEFAULT_UNIT_KIND,` 바로 아래:

```ts
    ownedTowers: [],
    towerKind: DEFAULT_TOWER_KIND,
```

- [ ] **Step 2: 서버 계정 변환에 필드를 잇는다**

같은 파일 `fromRemote` 의 매개변수 타입에서 `ownedUnits: string[]; unitKind: string;` 아래에 추가:

```ts
  ownedTowers?: string[]; towerKind?: string;
```

`fromRemote` 본문에서 `const kind = ...` 아래에 추가:

```ts
  const ownedT = (r.ownedTowers ?? []).filter(isTowerKind);
  const tkind = isTowerKind(r.towerKind) ? r.towerKind : DEFAULT_TOWER_KIND;
```

돌려주는 객체의 `unitKind: kind,` 아래에 추가:

```ts
    ownedTowers: [...new Set(ownedT)],
    towerKind: tkind,
```

마지막 줄을 고친다 (착용값 정리를 타워까지 확장):

```ts
  return { ...a, unitKind: unitKindOf(a), towerKind: towerKindOf(a) };
```

- [ ] **Step 3: `modsFor` 가 타워에서 속도를 뽑게 한다**

같은 파일:

```ts
/**
 * 계정 강화를 매치가 이해하는 형태로. 이 함수가 계정과 시뮬레이션 사이의 유일한 통로다.
 * `sim/`이 계정을 모르게 유지하려면 변환이 반드시 이쪽에 있어야 한다.
 *
 * **두 축 다 "종류가 성능"이다.** 유닛 종류가 `unitPower` 를, 타워 외형이 `speedMul` 을
 * 정한다. 추상적인 단계 강화(`speedLevel`)는 2026-08-06에 없앴다 (HANDOFF §-73).
 */
export function modsFor(a: Account): PlayerMods {
  return {
    // 착용한 외형이 생산속도다. `towerKindOf` 로 읽는 이유는 아래 유닛과 같다 —
    // 안 가진 것이 착용돼 있으면 여기서 기본값으로 떨어져야 sim 에 안 들어간다.
    speedMul: towerSpeedOf(towerKindOf(a)),
    unitPower: unitPowerOf(unitKindOf(a)),
  };
}
```

- [ ] **Step 4: 소유·구매·착용 함수를 더한다**

같은 파일, `unitKindOf` 바로 아래에:

```ts
// ── 타워 외형 ─────────────────────────────────────────────────────
//
// 유닛 종류와 **정확히 같은 구조다.** 외형이 성능(`speed`)을 들고 그 값이 `modsFor` 를
// 통해 sim 으로 간다. 카탈로그는 src/towers.ts.

/** 기본 외형은 가격 0이라 사지 않아도 가지고 있다. 유료 외형은 `entitlements` 가 든다. */
export function ownsTowerKind(a: Account, kind: TowerKind): boolean {
  if (DEBUG_UNLOCK_ALL) return true;
  if (isPremiumTower(kind)) return a.entitlements.includes(kind);
  return TOWER_KIND_META[kind].price === 0 || a.ownedTowers.includes(kind);
}

/**
 * 한 외형 구매한 새 계정. 이미 가졌거나 코인이 모자라면 null. **사면 바로 착용한다** —
 * 한 번 더 눌러야 입는 구조면 "샀는데 왜 그대로지"가 된다.
 */
export function buyTowerKind(a: Account, kind: TowerKind): Account | null {
  if (isPremiumTower(kind)) return null;
  const price = TOWER_KIND_META[kind].price;
  if (ownsTowerKind(a, kind) || a.coins < price) return null;
  return { ...a, coins: a.coins - price, ownedTowers: [...a.ownedTowers, kind], towerKind: kind };
}

/** 가진 것만 착용할 수 있다. 못 고르면 원본 그대로 — 호출부가 분기하지 않게 한다. */
export function selectTowerKind(a: Account, kind: TowerKind): Account {
  return ownsTowerKind(a, kind) ? { ...a, towerKind: kind } : a;
}

/** 실제로 쓸 외형. 안 가진 것이 저장돼 있으면 기본으로 되돌린다. */
export function towerKindOf(a: Account): TowerKind {
  return ownsTowerKind(a, a.towerKind) ? a.towerKind : DEFAULT_TOWER_KIND;
}
```

- [ ] **Step 5: 저장본 읽기에서 새 필드를 채운다**

같은 파일의 `loadAccount()` 안, `unitKind` 를 읽는 줄 근처에 같은 꼴로 추가한다. 값이 없으면(v10 이하 저장본) 기본값으로 떨어진다:

```ts
      ownedTowers: Array.isArray(parsed.ownedTowers)
        ? parsed.ownedTowers.filter(isTowerKind)
        : [],
      towerKind: isTowerKind(parsed.towerKind) ? parsed.towerKind : DEFAULT_TOWER_KIND,
```

- [ ] **Step 6: 스토어에 `pickTower` 를 더한다**

`game/src/account/store.ts` 의 import 에 `buyTowerKind`·`ownsTowerKind`·`selectTowerKind` 를 더하고, `import type { UnitKind }` 옆에 `import type { TowerKind } from '../towers';` 를 더한다. `pickUnit` 바로 아래에:

```ts
  /** 안 가진 외형이면 사고, 가진 것이면 착용한다. `pickUnit` 과 같은 규칙이다. */
  async pickTower(kind: TowerKind): Promise<void> {
    if (this.net) {
      const owned = ownsTowerKind(this.account, kind);
      await this.mutate(
        () => (owned ? this.net!.selectTowerKind(kind) : this.net!.buyTowerKind(kind)),
        () => null,
      );
      return;
    }
    this.setLocal(buyTowerKind(this.account, kind) ?? selectTowerKind(this.account, kind));
  }
```

(`this.net!.selectTowerKind`·`buyTowerKind` 는 Task 4 에서 만든다. 이 과제만으로는 타입 오류가 난다 — 그래서 Task 4 까지가 한 덩어리다. 지금은 이 메서드를 **주석 처리하지 말고** 그대로 두고, 아래 Step 7 에서 Task 4 를 먼저 하라는 뜻이 아니라 **Task 4 의 `Agent8Client` 메서드를 이 과제에서 같이 만든다**: `game/src/net/agent8.ts` 에 아래 두 메서드를 추가한다.)

```ts
  async buyTowerKind(kind: string): Promise<RemoteAccount> {
    return await withTimeout(this.server.remoteFunction('buyTowerKind', [kind]), '타워 구매');
  }

  async selectTowerKind(kind: string): Promise<RemoteAccount> {
    return await withTimeout(this.server.remoteFunction('selectTowerKind', [kind]), '타워 착용');
  }
```

그리고 `RemoteAccount` 인터페이스에 두 줄을 더한다:

```ts
  /** 산 타워 외형들. 유닛과 같은 규칙이다. */
  ownedTowers: string[];
  /** 착용한 타워 외형. 생산속도를 정한다. */
  towerKind: string;
```

- [ ] **Step 7: 타입 검사와 빌드**

```bash
npx tsc --noEmit && npx vite build
```

기대: 오류 0.

- [ ] **Step 8: 커밋**

```bash
git add game/src/account/account.ts game/src/account/store.ts game/src/net/agent8.ts
git commit -m "feat: 계정에 타워 외형 소유·착용"
```

---

### Task 3: 서버 판정 (TDD)

**Files:**
- Modify: `server.js`
- Test: `tools/server-harness.mjs`

**Interfaces:**
- Consumes: 없음 (서버는 클라이언트 모듈을 못 읽는다 — 단일 파일 샌드박스)
- Produces:
  - `Server.buyTowerKind(kind)` → 계정 객체
  - `Server.selectTowerKind(kind)` → 계정 객체
  - 계정 필드 `ownedTowers: string[]`, `towerKind: string`
  - 방 상태 `towerKinds: Record<number, string>`

- [ ] **Step 1: 실패하는 검사를 먼저 쓴다**

`tools/server-harness.mjs` 의 유닛 종류 검사(24.5절) **바로 뒤**에 붙인다. 앞선 절이 남긴 방을 정리하고 시작한다:

```js
// 24.6) 타워 외형도 슬롯 번호로 내려온다 — 유닛 종류와 같은 규칙이다.
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

// 24.7) 타워 구매·착용
as(A); await server.leaveMatch().catch(() => {});
as(B); await server.leaveMatch().catch(() => {});
const T = { account: '0xTTT', roomId: null };
as(T);
userStates.set('0xTTT', { ...defaultsFor('0xTTT'), coins: 1000 });
let te = null;
try { await server.buyTowerKind('tower_hut'); } catch (e) { te = e.message; }
check('기본 타워는 이미 가진 것', te === '이미 가지고 있습니다', te);
te = null;
try { await server.buyTowerKind('tower_prime'); } catch (e) { te = e.message; }
check('유료 타워는 코인으로 못 산다', te === '코인으로 살 수 없습니다', te);
te = null;
try { await server.buyTowerKind('castle'); } catch (e) { te = e.message; }
check('카탈로그에 없는 타워 거부', te === '그런 타워가 없습니다', te);
const bought = await server.buyTowerKind('tower_house');
check('타워 구매: 1000 - 400', bought.coins === 600, bought.coins);
check('사면 바로 착용된다', bought.towerKind === 'tower_house', bought);
te = null;
try { await server.buyTowerKind('tower_citadel'); } catch (e) { te = e.message; }
check('코인 모자라면 거부', te === '코인이 모자랍니다', te);
te = null;
try { await server.selectTowerKind('tower_citadel'); } catch (e) { te = e.message; }
check('안 산 타워는 착용 거부', te === '가지고 있지 않습니다', te);
const worn = await server.selectTowerKind('tower_hut');
check('가진 것은 착용된다', worn.towerKind === 'tower_hut', worn);
```

- [ ] **Step 2: 검사가 실패하는지 확인한다**

```bash
node tools/server-harness.mjs
```

기대: `server.buyTowerKind is not a function` 으로 죽거나 새 검사들이 FAIL.

- [ ] **Step 3: 서버에 가격표와 정리 함수를 더한다**

`server.js` 의 `UNIT_PRICES` 블록 **바로 아래**에:

```js
/**
 * 타워 외형 가격. **`game/src/towers.ts` 의 `TOWER_KIND_META.price` 와 같아야 한다.**
 * 어긋나면 "상점에는 보이는데 못 사는" 또는 그 반대가 된다.
 *
 * **속도 값은 여기 없다.** 서버는 이름만 내려주고 이름 → 배수 변환은 클라이언트가
 * 한다 — 공식을 양쪽에 복사하면 언젠가 어긋나고, 어긋나면 두 클라이언트가 다른 판을 돈다.
 */
const TOWER_PRICES = {
  tower_hut: 0,
  tower_house: 400,
  tower_barracks: 900,
  tower_keep: 1500,
  tower_citadel: 2400,
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
```

- [ ] **Step 4: 계정 기본값과 정규화에 필드를 잇는다**

`server.js` 의 `defaultAccount(account)` 에서 `unitKind: DEFAULT_UNIT_KIND,` 아래에:

```js
    ownedTowers: [],
    towerKind: DEFAULT_TOWER_KIND,
```

`normalizeAccount(raw, account)` 안에서 `const kind = ...` 아래에:

```js
  const ownedTowers = Array.isArray(raw.ownedTowers)
    ? [...new Set(raw.ownedTowers.filter((k) => k in TOWER_PRICES))]
    : [];
  const tkind = isKnownTower(raw.towerKind) ? raw.towerKind : DEFAULT_TOWER_KIND;
```

돌려주는 객체의 `unitKind: ...` 블록 아래에:

```js
    ownedTowers,
    // 안 가진 것이 착용돼 있으면 기본으로 되돌린다. 유닛과 같은 규칙이다.
    towerKind: TOWER_PRICES[tkind] === 0 || ownedTowers.includes(tkind) || entitlements.includes(tkind)
      ? tkind
      : DEFAULT_TOWER_KIND,
```

- [ ] **Step 5: 구매·착용 함수를 더한다**

`server.js` 의 `selectUnitKind` 바로 아래에:

```js
  /**
   * 타워 외형 구매. 사면 바로 착용한다.
   *
   * **순수 외형이 아니다** — 착용한 것이 생산속도를 정한다. 그래서 소유 판정이
   * 유닛과 똑같이 서버에 있어야 한다.
   */
  async buyTowerKind(kind) {
    return await $lock(`acct:${$sender.account}`, async () => {
      const a = await this.#loadAccount();
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
```

- [ ] **Step 6: 방 상태에 `towerKinds` 를 싣는다**

`setReady` 의 `#patchPlayer` 인자에서 `unitKind: me.unitKind,` 아래에:

```js
        // 타워 외형도 서버 계정에서 읽는다. 외형이 생산속도를 정하므로(towers.ts)
        // 클라이언트가 보내면 안 산 속도를 자칭할 수 있다.
        towerKind: me.towerKind,
```

`#start` 에서 `const kinds = {};` 아래에 `const towerKinds = {};` 를 더하고, `forEach` 안의 `kinds[slot] = ...` 아래에:

```js
      towerKinds[slot] = cleanTowerKind((players[account] || {}).towerKind);
```

`updateRoomState` 인자의 `kinds,` 아래에 `towerKinds,` 를 더한다.

`#startSolo` 의 `updateRoomState` 인자에서 `kinds: { 1: ... }` 옆에:

```js
      towerKinds: { 1: cleanTowerKind(((state.players || {})[account] || {}).towerKind) },
```

- [ ] **Step 7: 검사가 통과하는지 확인한다**

```bash
node tools/server-harness.mjs
```

기대: `PASS` 만, 총계가 이전보다 11개 늘어 있어야 한다.

- [ ] **Step 8: 커밋**

```bash
git add server.js tools/server-harness.mjs
git commit -m "feat: 서버가 타워 외형 소유·착용을 판정하고 방 상태에 싣는다"
```

---

### Task 4: 네트워크 경계

**Files:**
- Modify: `game/src/net/types.ts`
- Modify: `game/src/net/agent8.ts`

**Interfaces:**
- Consumes: Task 1 의 `TowerKind`·`DEFAULT_TOWER_KIND`·`isTowerKind`; Task 3 의 방 상태 `towerKinds`
- Produces: `MatchSetup.towerKinds: Record<PlayerId, TowerKind>`

- [ ] **Step 1: `MatchSetup` 에 자리를 만든다**

`game/src/net/types.ts` 의 import 에 `import type { TowerKind } from '../towers';` 를 더하고, `kinds` 필드 바로 아래에:

```ts
  /**
   * 플레이어별 타워 외형. **`kinds` 와 정확히 같은 이유로 서버가 정한다** —
   * 외형이 생산속도(`towers.ts` 의 `speed`)를 정하므로 순수 외형이 아니다.
   * 각자 자기 계정에서 읽으면 두 쪽이 다른 `PlayerMods` 로 돌아 첫 틱부터 갈라진다.
   *
   * 서버는 **이름만** 내려준다. 이름 → 배수 변환은 클라이언트에만 있다 (`towerSpeedOf`).
   */
  towerKinds: Record<PlayerId, TowerKind>;
```

- [ ] **Step 2: 방 상태에서 읽어 온다**

`game/src/net/agent8.ts` 의 import 에 추가:

```ts
import { DEFAULT_TOWER_KIND, isTowerKind, type TowerKind } from '../towers';
```

`toKind` 함수 바로 아래에:

```ts
/**
 * 서버가 모르는 타워 외형을 내려줘도 판이 시작되게 기본값으로 떨어뜨린다.
 * **여기서 던지면 안 된다** — `toKind` 와 정확히 같은 이유다.
 */
function toTowerKind(v: unknown): TowerKind {
  return isTowerKind(v) ? v : DEFAULT_TOWER_KIND;
}
```

`RoomSnapshot` 의 `kinds?` 아래에:

```ts
  /** 슬롯 번호 → 타워 외형. 생산속도를 정하는 값이라 서버 계정에서 읽어 내려준다. */
  towerKinds?: Record<number, string>;
```

`setupFrom` 의 돌려주는 객체에서 `kinds: {...}` 아래에:

```ts
      towerKinds: {
        1: toTowerKind(state.towerKinds?.[1]),
        2: toTowerKind(state.towerKinds?.[2]),
      },
```

- [ ] **Step 3: 봇전 방에서도 읽는다**

같은 파일의 `soloProfileFrom` 아래에:

```ts
  /** 봇전 방에서 서버가 내려준 내 타워 외형. 봇 것은 클라이언트가 만든다. */
  soloTowerFrom(state: RoomSnapshot): TowerKind {
    return toTowerKind(state.towerKinds?.[1]);
  }
```

- [ ] **Step 4: 타입 검사와 빌드**

```bash
npx tsc --noEmit && npx vite build
```

기대: `match-scene.ts` 와 `lockstep-check.ts` 가 `towerKinds` 를 안 채워서 오류가 난다. **그게 맞다** — Task 5 가 채운다. 오류가 그 두 파일에서만 나는지 확인한다.

- [ ] **Step 5: 커밋**

이 과제만으로는 빌드가 안 되므로 **커밋하지 않고 Task 5 로 이어간다.** (Task 5 의 커밋이 둘을 함께 담는다.)

---

### Task 5: 매치 배선과 봇 보정

**Files:**
- Modify: `game/src/app/match-scene.ts`
- Modify: `game/src/app/difficulty.ts`
- Modify: `game/src/app/scene.ts` (봇전 계획에 외형을 싣는다)
- Modify: `game/src/app/pvp-scene.ts` (봇전 전환에 외형 전달)
- Modify: `game/src/main.ts`
- Modify: `game/src/net/lockstep-check.ts`

**Interfaces:**
- Consumes: Task 1 의 `towerSpeedOf`·`stepDownTower`·`TowerKind`; Task 2 의 `towerKindOf`; Task 4 의 `MatchSetup.towerKinds`
- Produces: `MatchScene` 이 렌더러에 `setTowerKinds({1,2})` 를 넘긴다 (Task 6 이 그 메서드를 만든다)

- [ ] **Step 1: 봇 보정을 외형 기준으로 바꾼다**

`game/src/app/difficulty.ts` 의 import 에 추가:

```ts
import { stepDownTower, towerSpeedOf, type TowerKind } from '../towers';
```

`botModsFor` 를 고친다:

```ts
/**
 * 봇에게 줄 보정. **유닛의 힘도 타워의 속도도 사람보다 한 단계 아래다.**
 *
 * 위 실측표가 이 값의 근거다. 다만 **바닥이 필요하다** — 기본 타워(`tower_hut`)를
 * 쓰면 아래가 없어 봇이 사람과 동등해지고, 표의 "지연 0 → 40%" 로 떨어진다.
 * 신규가 가장 많이 겪을 상태인데 거기서 가장 어려워진다. 그때만 `BOT_SPEED_MUL` 을 쓴다.
 */
export function botModsFor(a: Account): PlayerMods {
  const mine = towerKindOf(a);
  const down = stepDownTower(mine);
  return {
    speedMul: down === mine ? BOT_SPEED_MUL : towerSpeedOf(down),
    unitPower: unitPowerOf(botUnitKindFor(a)),
  };
}

```

`import` 에서 `towerKindOf` 를 `account/account` 에서 가져온다.

**봇의 외형 이름을 따로 뽑는 함수는 안 만든다.** `MatchScene` 이 이미 사람의 외형을
알고 있어서 `stepDownTower(내 외형)` 한 줄이면 되고, 함수를 하나 더 두면 "속도는 이
함수, 그림은 저 함수"로 갈릴 자리가 생긴다. 위 `botModsFor` 와 아래 Task 5 Step 3 이
**둘 다 `stepDownTower` 를 부른다** — 그게 같은 값을 보장한다.

- [ ] **Step 2: 매치 계획에 외형을 싣는다**

`game/src/app/scene.ts` 의 `MatchPlan` 봇전 갈래에 필드를 더한다 (파일을 열어 `mode: 'pve'` 갈래를 찾는다):

```ts
  /** 서버가 연 봇전 방이면 서버가 내려준 내 타워 외형. 없으면 계정에서 읽는다. */
  towerKind?: TowerKind;
```

`import type { TowerKind } from '../towers';` 를 더한다.

`game/src/app/pvp-scene.ts` 에서 봇전으로 넘길 때 외형을 같이 넘긴다. `startBot` 콜백 시그니처를 `(seed?: number, towerKind?: TowerKind) => void` 로 바꾸고, `soloSeed` 갈래에서:

```ts
    const soloSeed = this.client.soloSeedFrom(state);
    if (soloSeed !== null) {
      const towerKind = this.client.soloTowerFrom(state);
      this.handOff(() => this.startBot(soloSeed, towerKind));
      return;
    }
```

`game/src/main.ts` 의 봇전 콜백:

```ts
  (seed, towerKind) => {
    plan = { mode: 'pve', seed, serverRoom: seed !== undefined, towerKind };
    switchTo(match);
  },
```

- [ ] **Step 3: `MatchScene` 이 종류를 속도로 바꾸게 한다**

`game/src/app/match-scene.ts` 의 import 에 추가:

```ts
import { stepDownTower, towerSpeedOf, type TowerKind } from '../towers';
```

생성자에 게터를 하나 더한다 (`getUnitKind` 바로 아래):

```ts
    /** 사람이 착용한 타워 외형. 봇전에서 쓴다 — PVP는 서버 값이 이걸 덮는다. */
    private readonly getTowerKind: () => TowerKind,
```

`main.ts` 의 `MatchScene` 생성 인자에서 `() => unitKindOf(store.current),` 아래에 `() => towerKindOf(store.current),` 를 더한다 (`towerKindOf` 를 import 한다).

`restart()` 의 PVP 갈래:

```ts
    if (plan.mode === 'pvp') {
      const { kinds, towerKinds } = plan.setup;
      this.state = createMatch(generateMap(seed), {
        1: {
          speedMul: towerSpeedOf(towerKinds[1]),
          unitPower: unitPowerOf(kinds[1]),
          canTempo: plan.setup.tempo[1],
        },
        2: {
          speedMul: towerSpeedOf(towerKinds[2]),
          unitPower: unitPowerOf(kinds[2]),
          canTempo: plan.setup.tempo[2],
        },
      });
      this.source = new NetSource(new Lockstep(plan.setup, plan.transport));
      this.unwatchRoom =
        plan.transport.onClosed?.((slot) => {
          this.serverVerdict = slot;
        }) ?? null;
      shownKinds = { 1: kinds[1], 2: kinds[2] };
      shownTowers = { 1: towerKinds[1], 2: towerKinds[2] };
    } else {
```

봇전 갈래에서 `shownKinds` 를 정하는 곳 옆에:

```ts
      // **봇은 한 단계 아래 외형이다.** 속도(`botModsFor`)와 그림이 **같은 함수**에서
      // 나와야 화면이 거짓말을 안 한다 — 유닛의 `stepDownKind` 와 같은 규칙이다.
      const myTower = plan.towerKind ?? this.getTowerKind();
      shownTowers = {
        [local]: myTower,
        [other]: stepDownTower(myTower),
      } as Record<PlayerId, TowerKind>;
```

`shownKinds` 선언 옆에 `let shownTowers: Record<PlayerId, TowerKind>;` 를 더한다.

`this.renderer.setUnitKinds(shownKinds);` 아래에:

```ts
    this.renderer.setTowerKinds(shownTowers);
```

- [ ] **Step 4: 락스텝 검증에 외형을 다르게 준다**

`game/src/net/lockstep-check.ts` 의 `setup` 객체에서 `kinds` 아래에:

```ts
    // 타워 외형도 서로 다르게 준다. **속도가 갈린 상태에서도** 락스텝이 안 어긋나는지
    // 봐야 한다 — 양쪽이 같으면 `speedMul` 경로가 한 번도 안 밟힌다.
    towerKinds: { 1: DEFAULT_TOWER_KIND, 2: 'tower_citadel' as TowerKind },
```

`createMatch` 인자를 고친다:

```ts
    this.state = createMatch(generateMap(setup.seed), {
      1: { speedMul: towerSpeedOf(setup.towerKinds[1]), unitPower: unitPowerOf(setup.kinds[1]) },
      2: { speedMul: towerSpeedOf(setup.towerKinds[2]), unitPower: unitPowerOf(setup.kinds[2]) },
    });
```

import 를 더한다:

```ts
import { DEFAULT_TOWER_KIND, towerSpeedOf, type TowerKind } from '../towers';
```

- [ ] **Step 5: 타입 검사와 빌드**

```bash
npx tsc --noEmit && npx vite build
```

기대: `setTowerKinds` 가 아직 없어서 `renderer.ts` 에서 오류가 난다. **Task 6 을 먼저 하지 말고**, 여기서 임시로 `renderer.ts` 에 빈 메서드를 넣는다 — Task 6 이 내용을 채운다:

```ts
  /** 판에 쓸 타워 외형. Task 6 이 실제로 그린다. */
  setTowerKinds(_kinds: Record<PlayerId, TowerKind>): void {}
```

다시 돌려 오류 0 을 확인한다.

- [ ] **Step 6: 커밋**

```bash
git add game/src/net/types.ts game/src/net/agent8.ts game/src/app game/src/main.ts game/src/render/renderer.ts
git commit -m "feat: 타워 외형이 speedMul 을 정한다 — 매치 배선과 봇 보정"
```

---

### Task 6: 렌더링

**Files:**
- Modify: `game/src/render/sprites.ts`
- Modify: `game/src/render/renderer.ts`

**Interfaces:**
- Consumes: Task 1 의 `TOWER_KIND_META`·`towerSpriteKindOf`·`DEFAULT_TOWER_KIND`
- Produces: `Renderer.setTowerKinds(kinds: Record<PlayerId, TowerKind>): void` 가 실제로 그림을 바꾼다

- [ ] **Step 1: 스프라이트 경로를 종류별로 만든다**

`game/src/render/sprites.ts` 에서 `TOWER_ART` 상수와 그것을 쓰는 루프를 지우고 대신:

```ts
/**
 * 타워 그림 키. 진영 × 외형 종류다.
 *
 * **전부 미리 안 받는다.** 종류가 6개라 진영까지 곱하면 11장이 되는데, 한 판에 실제로
 * 쓰이는 것은 **3장뿐**이다 (내 외형·상대 외형·중립). 아바타(`Profiles`)와 같은 방식으로
 * 판이 시작될 때 필요한 것만 받는다.
 */
function towerKey(slug: FactionSlug, kind: TowerKind): string {
  return `tower_${slug}_${kind}`;
}
```

`import { DEFAULT_TOWER_KIND, TOWER_KIND_META, towerSpriteKindOf, type TowerKind } from '../towers';` 를 더한다.

생성자에서 타워를 미리 받던 줄을 지운다:

```ts
  constructor() {
    // 타워는 판이 시작될 때 `loadTower` 로 필요한 것만 받는다 (아래 주석).
  }
```

`loadUnit` 바로 아래에 `loadTower` 를 더한다. **`loadUnit` 과 같은 꼴이다** — `requested`
집합으로 같은 조합을 두 번 안 부른다:

```ts
  /**
   * 한 판에 나올 타워만 불러온다. `Renderer.setTowerKinds` 가 부른다.
   *
   * 종류 6 × 진영 3 = 11장인데 한 판에 쓰는 것은 **3장뿐**이다
   * (내 외형·상대 외형·중립). `loadUnit` 과 같은 판단이다.
   */
  loadTower(owner: 0 | 1 | 2, kindIn: TowerKind): void {
    const kind = towerSpriteKindOf(owner === 0 ? DEFAULT_TOWER_KIND : kindIn);
    const slug = factionOf(owner);
    const key = towerKey(slug, kind);
    if (this.requested.has(key)) return;
    this.requested.add(key);
    this.fetch(key, `${BASE}/tower/${slug}/${TOWER_KIND_META[kind].art}.png`);
  }
```

`tower(owner)` 를 고친다. **`grab` 은 안 건드린다** — 안 온 그림은 지금처럼 `null` 이
나가고 렌더러가 도형으로 폴백한다:

```ts
  /**
   * 소유자에 맞는 건물. 로딩 전이면 null (렌더러가 도형으로 폴백한다).
   *
   * **중립은 항상 기본 외형이다** — 가장 낮은 것을 중립에 두어야 무과금 플레이어의
   * 타워가 주인 없는 타워보다 초라해 보이지 않는다.
   */
  tower(owner: 0 | 1 | 2, kind: TowerKind): Painted | null {
    const k = towerSpriteKindOf(owner === 0 ? DEFAULT_TOWER_KIND : kind);
    return this.grab(towerKey(factionOf(owner), k));
  }
```


- [ ] **Step 2: 렌더러가 종류를 들고 넘긴다**

`game/src/render/renderer.ts` 에서 Task 5 가 넣은 빈 메서드를 채운다. 필드를 더한다:

```ts
  /** 플레이어별 타워 외형. 중립은 카탈로그 기본값으로 그린다. */
  private towerKinds: Record<PlayerId, TowerKind> = {
    1: DEFAULT_TOWER_KIND,
    2: DEFAULT_TOWER_KIND,
  };
```

```ts
  /**
   * 판에 쓸 타워 외형. **`setUnitKinds` 와 같은 규칙이다** — 종류는 매치 상태가 아니라
   * 렌더러가 든다. 서버 권위로 갈 때 검증 대상을 늘리지 않으려는 것이다.
   */
  setTowerKinds(kinds: Record<PlayerId, TowerKind>): void {
    this.towerKinds = { ...kinds };
  }
```

`drawTower` 에서 스프라이트를 부르는 자리를 고친다 — 소유자의 외형으로 그린다:

```ts
    const art = this.sprites.tower(t.owner, this.towerKinds[t.owner === 2 ? 2 : 1]);
```

**주의:** 중립(`owner === 0`)일 때 `tower()` 안에서 기본값으로 바꾸므로 여기서 넘기는 값은 무시된다. 그래도 인자를 넘기는 이유는 소유자가 바뀌면 같은 자리에서 그림이 바뀌어야 하기 때문이다.

- [ ] **Step 3: 유료 외형 아우라 — 유닛 것을 재사용한다**

`renderer.ts` 의 `drawTierAura(kind: UnitKind, h: number)` 는 지금 유닛 카탈로그를 직접
읽는다. **두 곳에 복사하면 색이 갈리므로** 카탈로그를 안 읽는 형태로 일반화한다.
기존 함수를 아래로 바꾼다 (본문 계산은 그대로다):

```ts
  /**
   * 등급 아우라. **카탈로그를 안 읽는다** — 유닛도 타워도 이 함수를 쓰기 때문이다.
   * 부르는 쪽이 자기 카탈로그에서 뽑은 값을 넘긴다.
   *
   * @param tier    등급. 0이면 안 그린다 — 가장 흔한 것이 제일 깨끗해야 화면이 안 시끄럽다
   * @param maxTier 등급 사다리의 끝. 넓이·진하기의 분모다
   * @param accent  강조색. 없으면 안 그린다
   * @param rainbow 무지개로 돌릴 것인가
   */
  private drawTierAura(
    tier: number,
    maxTier: number,
    accent: string | undefined,
    rainbow: boolean,
    h: number,
  ): void {
    if (tier <= 0 || !accent) return;

    const ctx = this.ctx;
    // 등급이 높을수록 넓고 진하다. 0.28~0.46 반경, 알파 0.22~0.5.
    const k = maxTier > 0 ? tier / maxTier : 0;
    const r = h * (0.28 + k * 0.18);
    const alpha = 0.22 + k * 0.28;

    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
    if (rainbow) {
      // `time` 은 판 시작부터의 초. 개체마다 위상을 안 나눈다 — 같은 종류가 같은 색으로
      // 함께 도는 편이 "이건 특별한 것"으로 읽힌다.
      const hue = Math.floor(((this.time * 0.5) % 1) * 360);
      g.addColorStop(0, `hsla(${hue}, 90%, 65%, ${alpha})`);
      g.addColorStop(0.6, `hsla(${(hue + 120) % 360}, 90%, 60%, ${alpha * 0.5})`);
    } else {
      g.addColorStop(0, withAlpha(accent, alpha));
      g.addColorStop(0.6, withAlpha(accent, alpha * 0.45));
    }
    g.addColorStop(1, 'rgba(0,0,0,0)');

    ctx.save();
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
```

유닛 쪽 호출부(지금 `this.drawTierAura(kind, h)` 로 부르는 자리)를 고친다:

```ts
      const meta = UNIT_KIND_META[kind];
      this.drawTierAura(tierOf(kind), MAX_TIER, meta.accent, meta.aura === 'rainbow', h);
```

`drawTower` 에서 건물 그림을 그린 **직후** 타워 아우라를 그린다. 아우라 함수가
원점(0,0) 기준으로 그리므로 발치로 옮겨서 부른다:

```ts
    // 유료 외형은 그림을 빌려 쓰므로(`towerSpriteKindOf`) 아우라가 유일한 구분이다.
    const tmeta = TOWER_KIND_META[this.towerKinds[t.owner === 2 ? 2 : 1]];
    if (t.owner !== 0 && tmeta) {
      ctx.save();
      ctx.translate(t.x, foot);
      this.drawTierAura(
        towerTierOf(this.towerKinds[t.owner === 2 ? 2 : 1]),
        MAX_TOWER_TIER,
        tmeta.accent,
        tmeta.aura === 'rainbow',
        r * 2,
      );
      ctx.restore();
    }
```

`renderer.ts` 의 import 에 `TOWER_KIND_META`·`towerTierOf`·`MAX_TOWER_TIER` 를 더한다.

- [ ] **Step 4: 타입 검사·빌드·실물 확인**

```bash
npx tsc --noEmit && npx vite build
```

그다음 프리뷰를 띄워 봇전을 한 판 시작하고 스크린샷으로 확인한다:

- 내 타워가 착용한 외형으로 그려진다
- 봇 타워가 **한 단계 아래** 외형으로 그려진다
- 중립 타워가 `lv1`(작은 집)이다
- 타워를 점령하면 그 자리에서 내 외형으로 바뀐다

- [ ] **Step 5: 커밋**

```bash
git add game/src/render
git commit -m "feat: 타워를 소유자의 외형으로 그린다"
```

---

### Task 7: 상점

**Files:**
- Modify: `game/index.html`
- Modify: `game/src/app/shop-scene.ts`
- Modify: `game/src/main.ts`
- Modify: `game/src/i18n.ts`

**Interfaces:**
- Consumes: Task 1 의 `SHOP_TOWER_ORDER`·`SHOP_PREMIUM_TOWER_ORDER`·`TOWER_KIND_META`·`towerLabelOf`·`towerBlurbOf`·`towerSpriteKindOf`·`isPremiumTower`·`TowerKind`; Task 2 의 `ownsTowerKind`·`towerKindOf`·`AccountStore.pickTower`
- Produces: 없음 (마지막 과제)

- [ ] **Step 1: 상점에 타워 구역을 만든다**

`game/index.html` 의 유닛 격자(`#unit-grid`) **위**에 타워 구역을 넣는다. 카드는 코드가 만들어 넣으므로 껍데기만:

```html
      <p class="shop-title" data-i18n="shopTowers">Towers — faster production</p>
      <div class="unit-grid" id="tower-grid"></div>
```

`i18n.ts` 의 `Strings` 에 `shopTowers: string;` 을 더하고 세 언어에 값을 넣는다:

- `en`: `shopTowers: 'Towers — pricier means faster production',`
- `ko`: `shopTowers: '타워 — 비쌀수록 생산이 빠르다',`
- `zh`: `shopTowers: '塔 — 越贵产量越快',`

`towerStats` 도 같은 방식으로 더한다:

- `en`: `towerStats: (speed: number) => \`Production ×${speed.toFixed(2)}\`,`
- `ko`: `towerStats: (speed) => \`생산 ×${speed.toFixed(2)}\`,`
- `zh`: `towerStats: (speed) => \`产量 ×${speed.toFixed(2)}\`,`

인터페이스에는 `towerStats: (speed: number) => string;`.

- [ ] **Step 2: 카드를 만들어 넣는다**

`game/src/app/shop-scene.ts` 에서 유닛 카드 코드(`buildUnitCard`)를 그대로 본떠 `buildTowerCard` 를 만든다. 미리보기 그림은 P1 기준:

```ts
/** 미리보기 이미지. 판에서 쓰는 것과 같은 그림이다 — P1(파랑) 기준. */
function towerPreviewSrc(kind: TowerKind): string {
  return `/assets/tower/p1/${TOWER_KIND_META[towerSpriteKindOf(kind)].art}.png`;
}
```

카드를 만드는 함수. 유닛 카드와 같은 class 를 써서 격자 규격을 공유한다:

```ts
  private buildTowerCard(kind: TowerKind): HTMLButtonElement {
    const el = document.createElement('button');
    el.className = isPremiumTower(kind) ? 'unit-card unit-card-premium' : 'unit-card';
    el.id = `tower-${kind}`;
    // **그림을 판에서 쓰는 것과 같은 파일로 보여 준다.** 상점에서만 다른 그림을 쓰면
    // 산 뒤에 "이게 아닌데"가 된다. 크기는 종류와 무관하게 같다 — 판에서도 같기 때문이다
    // (`towers.ts` 의 크기 주석).
    el.innerHTML = `
      <span class="unit-art"><img alt="" src="${towerPreviewSrc(kind)}" height="${TOWER_ART_H}"></span>
      <span class="unit-name" data-role="name"></span>
      <span class="unit-tier"></span>
      <span class="unit-power" data-role="stats"></span>
      <span class="unit-blurb" data-role="blurb"></span>
      <span class="unit-state" data-role="state"></span>
    `;
    return el;
  }
```

파일 위쪽에 상수와 미리보기 경로를 더한다:

```ts
/** 상점 카드의 타워 그림 높이(px). `.unit-art` 상자(56px)보다 낮아야 안 잘린다. */
const TOWER_ART_H = 48;

/** 미리보기 이미지. 판에서 쓰는 것과 같은 파일이다 — P1(파랑) 기준. */
function towerPreviewSrc(kind: TowerKind): string {
  return `/assets/tower/p1/${TOWER_KIND_META[towerSpriteKindOf(kind)].art}.png`;
}
```

생성자에서 격자를 채운다. `this.unitCards` 를 만드는 블록 바로 위에:

```ts
    const tgrid = root.querySelector<HTMLElement>('#tower-grid');
    if (!tgrid) throw new Error('상점 DOM이 예상과 다릅니다');
    this.towerCards = SHOP_TOWER_ORDER.map((kind) => {
      const el = this.buildTowerCard(kind);
      el.addEventListener('click', () => {
        this.pickTower(kind);
        this.render();
      });
      tgrid.appendChild(el);
      return { kind, el };
    });
    // 유료 타워는 유닛 유료 격자에 같이 넣는다 — 결제 흐름이 한 곳에 모여야 한다.
    this.premiumTowerCards = SHOP_PREMIUM_TOWER_ORDER.map((kind) => {
      const el = this.buildTowerCard(kind);
      el.addEventListener('click', () => {
        if (ownsTowerKind(this.getAccount(), kind)) {
          this.pickTower(kind);
          this.render();
          return;
        }
        void this.openVxShop(kind as PremiumItem).then((ok) => {
          if (!ok) this.vxNote.textContent = t().vxOpenFailed;
        });
      });
      pgrid.appendChild(el);
      return { kind, el };
    });
```

필드를 더한다:

```ts
  private readonly towerCards: { kind: TowerKind; el: HTMLButtonElement }[];
  private readonly premiumTowerCards: { kind: TowerKind; el: HTMLButtonElement }[];
```

`render()` 안, 유닛 카드를 칠하는 루프 **바로 위**에:

```ts
    const wornTower = towerKindOf(a);
    for (const { kind, el } of [...this.towerCards, ...this.premiumTowerCards]) {
      const meta = TOWER_KIND_META[kind];
      const owned = ownsTowerKind(a, kind);
      set(el, 'name', towerLabelOf(kind));
      set(el, 'stats', t().towerStats(meta.speed));
      set(el, 'blurb', towerBlurbOf(kind));
      // 유료는 코인 가격이 없다. VX 값은 대시보드가 진짜라 못 읽으면 "준비 중"이다.
      const price = isPremiumTower(kind)
        ? (vxPrice(kind as PremiumItem) === null ? t().comingSoon : t().buyWithVx)
        : `◈ ${meta.price.toLocaleString()}`;
      set(el, 'state', kind === wornTower ? t().equipped : owned ? t().equip : price);
      el.classList.toggle('is-worn', kind === wornTower);
      // 못 사는 카드는 회색. 가진 것은 언제나 누를 수 있다 (착용).
      el.disabled = !owned && !isPremiumTower(kind) && a.coins < meta.price;
    }
```

`import` 에 `SHOP_TOWER_ORDER`·`SHOP_PREMIUM_TOWER_ORDER`·`TOWER_KIND_META`·
`towerLabelOf`·`towerBlurbOf`·`towerSpriteKindOf`·`isPremiumTower`·`type TowerKind` 를
`../towers` 에서, `ownsTowerKind`·`towerKindOf` 를 `../account/account` 에서 더한다.

**`set()` 이 없는 `data-role` 을 만나면 조용히 지나가는지 확인할 것** — 유닛 카드와
`data-role` 이름이 다르면(`stats` vs `power`) 값이 안 칠해진다. 위 카드 HTML 은
`data-role="stats"` 를 쓰므로 그대로 맞춘 것이다.

- [ ] **Step 3: 앱에 배선한다**

`game/src/main.ts` 에 `pickUnit` 과 같은 꼴로:

```ts
/** 안 가진 타워면 사고, 가진 것이면 착용한다. 둘 다 못 하면 아무 일도 안 일어난다. */
function pickTower(kind: TowerKind): void {
  void store.pickTower(kind).then(() => {
    audio.play('purchase');
    shop.refresh();
  });
}
```

`ShopScene` 생성 인자에서 `pickUnit` 다음에 `pickTower` 를 넘긴다. `ShopScene` 생성자에도 같은 자리에 `private readonly pickTower: (kind: TowerKind) => void,` 를 더한다.

- [ ] **Step 4: 전체 검증**

```bash
npm run verify
```

기대: 하네스 전부 PASS, tsc 0, 빌드 성공.

- [ ] **Step 5: 실물 확인**

프리뷰를 띄워 상점을 연다:

- 타워 카드 5장이 뜬다 (오두막·집·병영·석탑·성채)
- 기본(오두막)은 "착용 중"
- 코인이 모자란 카드는 가격이 회색
- 하나 사면 바로 착용되고 코인이 깎인다
- 유료 격자에 왕성이 뜬다 (VX 미등록이면 "준비 중")

스크린샷을 남긴다.

- [ ] **Step 6: HANDOFF 기록과 커밋**

`HANDOFF.md` 맨 위에 절을 하나 더한다 — 무엇을 왜 했는지, 밸런스 손잡이가 `TOWER_KIND_META.speed` 한 줄이라는 것, 배포 과도기 데싱크 위험.

```bash
git add -A
git commit -m "feat: 상점에서 타워 외형을 판다"
git push origin dev
git push gitlab dev:develop
```

---

## 배포

**서버와 클라이언트를 모두 배포해야 한다.** 서버가 `towerKinds` 를 안 내려주면 클라이언트는 전부 기본값(1.0)으로 떨어진다 — 갈라지지는 않지만 기능이 없는 것과 같다.

에디터에서 `.deployed` 를 지우고 Launch. 배포 직후 짧은 시간 동안 옛 클라이언트와 섞이면 데싱크가 날 수 있다(설계 문서의 "배포 과도기" 참고). 서버가 `desync` 필드에 기록하므로 실제로 났는지는 방 상태로 확인할 수 있다.
