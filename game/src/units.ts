/**
 * 유닛 카탈로그.
 *
 * **2026-07-31부터 순수 외형이 아니다** (사용자 지시). 종류마다 `power` 가 다르고
 * 그 값이 `PlayerMods.unitPower` 로 `sim/` 에 들어간다. 상점에서 고르는 값이자
 * 렌더러가 그리는 값이자 이제 규칙까지 정하는 값이라, `account/`도 `render/`도 아닌
 * 여기 있다. (**`sim/`은 여전히 이 파일을 몰라야 한다** — 숫자만 건네받는다.)
 *
 * 규칙을 `render/` 가 아니라 `PlayerMods` 로 흘리는 것이 중요하다. 렌더러가 게임 규칙을
 * 들고 있으면 서버 권위 PVP에서 화면과 실제가 어긋난다.
 *
 * ── 이 축은 두 번 지웠다가 사용자 지시로 되살린 것이다 ──────────
 *
 * §-1·§-0.75·§-3 참고. 지울 때의 실측치(봇 대 봇 60판, 그쪽에만 강화):
 *
 *   전투력 1.0(기준) → 승률 45%      판당 중계 6.5
 *   전투력 1.05      → 승률 93.3%
 *   전투력 2.0       → 승률 100%     판당 중계 208 (32배), 평균 타워차 +12 = 전멸
 *
 * 원인은 코드에 있다. 충돌이 `Math.min(a.power, b.power)` 라 **조금이라도 높은 쪽은
 * 정면 교환에서 절대 먼저 안 죽는다** — 최소 증분이 이미 교환비 2:1이다.
 * 게다가 `power` 가 타워 예치량도 겸해서 재고가 상한(60)에 빨리 닿고, 상한에 닿은 타워는
 * 중계기가 된다. 밸런스가 거슬리면 **여기 `power` 표를 좁히는 것**이 유일한 손잡이다.
 *
 * 에셋: **BeerGang 3D 캐릭터를 옆에서 렌더해 구운 것**이다 (`tools/bake-units.ts`).
 * 2026-07-30에 Tiny Swords 5종(전사·일꾼·궁수·수도사·창기병)을 여기서 걷어냈다 —
 * 픽셀아트와 3D 렌더가 한 판에 섞여 나오는 것을 없애려는 것이다.
 * 그 PNG들은 지우지 않고 `assets-src/tiny-swords-units/` 로 옮겨 뒀다.
 *
 * ── 변형은 하의·머리 색이다 (2026-07-31, 사용자 지시) ───────────
 *
 * **재킷은 건드리지 않는다.** 렌더러는 유닛에 배지도 테두리도 안 그려서
 * (`drawUnits`) 스프라이트 색이 "누구 편인가"의 **유일한 신호**다. 재킷이 그 신호를
 * 들고 있으므로 변형색은 `pants_MAT`·`hair_Wu_MAT` 에만 들어간다
 * (`tools/bake-units.ts` 의 `accentMaterials`). 신발은 흰색으로 남겨 뒀다 —
 * 발치에 밝은 것이 하나 있어야 26px에서 다리와 발이 안 뭉친다.
 *
 * 그래서 변형색은 **진영색과 색조가 겹치면 안 된다.** 파랑(#3fbdf1)·빨강(#f2555f)
 * 근처를 피해 흰·금·초록·보라로 골랐다. 종류를 더 넣을 때도 이 제약이 먼저다.
 *
 * `frames`는 원본 시트가 아니라 구울 때 우리가 정하는 값이다. 다시 구우면서 프레임 수를
 * 바꾸면 여기도 같이 고칠 것 — 안 그러면 없는 파일을 부르거나 사이클이 잘린다.
 * `scale`은 높이 보정이다. 추출을 전 프레임 합집합 상자로 하기 때문에 종류마다 비율이 다르다.
 * 다섯 종이 같은 모델·같은 클립이라 추출 상자가 전부 59×91로 같다 — `scale`도 같다.
 */

import { t } from './i18n';

export const UNIT_KINDS = [
  'beergang',
  'beergang_white',
  'beergang_gold',
  'beergang_green',
  'beergang_purple',
  'beergang_rainbow',
] as const;
export type UnitKind = (typeof UNIT_KINDS)[number];

/**
 * 계정 없이도 쓸 수 있는 기본 생김새. 가격 0이고 상점에서 잠기지 않는다.
 *
 * **상대편(봇·PVP 상대)도 이 값으로 그려진다** (`match-scene.ts`). 종류를 늘릴 때
 * 이걸 안 바꾸면 내가 갈아입어도 상대는 계속 옛 생김새라 "안 바뀐 것처럼" 보인다.
 */
export const DEFAULT_UNIT_KIND: UnitKind = 'beergang';

export interface UnitKindMeta {
  /** 러닝 사이클 프레임 수. 원본 시트를 따른다. */
  frames: number;
  /** 그릴 때 기준 높이에 곱하는 값. 추출 상자 비율 차이를 메운다. */
  scale: number;
  /** 코인 가격. 0이면 기본 제공. */
  price: number;
  /**
   * 유닛 1기의 체력이자 공격력. 기본 1. `PlayerMods.unitPower` 로 sim 에 들어간다.
   *
   * **반 단계가 의미를 갖는 것은 공격력도 같이 오르기 때문이다.** 공격력이 1로 고정이면
   * 피해가 1씩 들어와 체력 1.5와 2가 똑같이 적 2기를 잡는다 — 사다리가
   * 1·2·2·3·3 으로 뭉개진다. 한쪽만 올리려거든 이 사실을 먼저 볼 것.
   */
  power: number;

  /**
   * 코인으로 못 사는 유료 종류인가. 사는 곳은 Verse8 CrossRamp 상점이고
   * (`net/vx.ts`), 소유는 계정의 `entitlements` 가 든다.
   *
   * **`price` 는 무시된다.** 코인 경로(`buyUnitKind`)가 이 값을 보고 거절한다.
   */
  premium?: true;
  /**
   * 그림이 없어서 다른 종류의 스프라이트를 빌려 쓰는 경우 그 종류.
   *
   * `beergang_rainbow` 가 이 경우다 — 베이커 원본(GLB)이 저장소에 없어 새로 구울 수
   * 없다(§7의 에셋 항목). 기본 스프라이트를 빌리고 **무지개 아우라를 코드로 그린다**
   * (`renderer.drawUnits`). 재킷 색은 안 건드린다 — 그게 진영 신호다.
   */
  spriteOf?: UnitKind;
  /** 코드로 그리는 아우라. 유료 종류를 그림 없이 구분하는 수단이다. */
  aura?: 'rainbow';
  /**
   * 등급 표시에 쓰는 색. **그 종류의 하의 색이다** — 화면에 이미 보이는 색이라
   * 따로 배울 것이 없다.
   *
   * 기본(`beergang`)은 없다: 아우라도 표식도 안 그린다. 가장 흔한 유닛이 제일 깨끗해야
   * 화면이 안 시끄럽다.
   *
   * **진영색(파랑 `#3fbdf1`·빨강 `#f2555f`)을 피한다** — 변형색과 같은 제약이다.
   */
  accent?: string;
}

/**
 * 다섯 종 전부 Mixamo `Walking` 클립으로 구운 같은 캐릭터다. 59×91 8프레임.
 *
 * **가격표가 `server.js` 의 `UNIT_PRICES` 에도 있다.** 서버가 소유·착용을 판정하므로
 * (§-10) 어긋나면 "상점에는 보이는데 못 입는"이 된다. 고칠 때 양쪽을 같이 고칠 것.
 */
export const UNIT_KIND_META: Record<UnitKind, UnitKindMeta> = {
  beergang: { frames: 8, scale: 1.3, price: 0, power: 1 },
  beergang_white: { frames: 8, scale: 1.3, price: 400, power: 1.5, accent: '#e8eef5' },
  beergang_gold: { frames: 8, scale: 1.3, price: 900, power: 2, accent: '#f5c542' },
  beergang_green: { frames: 8, scale: 1.3, price: 1500, power: 2.5, accent: '#34d399' },
  beergang_purple: { frames: 8, scale: 1.3, price: 2400, power: 3, accent: '#a78bfa' },
  beergang_rainbow: {
    frames: 8,
    scale: 1.3,
    price: 0,
    power: 4,
    premium: true,
    spriteOf: 'beergang',
    aura: 'rainbow',
    accent: '#f2f7fb',
  },
};

/** 화면에 보이는 이름. **언어 표에 있다** (`i18n.ts`) — 카탈로그는 규칙만 든다. */
export function unitLabelOf(kind: UnitKind): string {
  return t().unitLabels[kind] ?? kind;
}

/** 상점 카드의 한 줄 설명. 이름과 같은 이유로 언어 표에 있다. */
export function unitBlurbOf(kind: UnitKind): string {
  return t().unitBlurbs[kind] ?? '';
}

/** 코인으로 못 사는 종류인가. 상점이 이걸 보고 다른 줄에 놓는다. */
export function isPremiumKind(kind: UnitKind): boolean {
  return UNIT_KIND_META[kind]?.premium === true;
}

/** 실제로 파일을 읽을 종류. 그림이 없는 종류는 빌려 쓴다 (`spriteOf`). */
export function spriteKindOf(kind: UnitKind): UnitKind {
  return UNIT_KIND_META[kind]?.spriteOf ?? kind;
}

/**
 * 종류 → 힘. **모르는 값이 오면 기본값으로 떨어뜨린다.**
 *
 * 여기서 던지면 안 된다 — PVP에서 상대가 내 카탈로그에 없는 종류를 들고 있을 때
 * (배포 시점이 어긋난 클라이언트) 판이 시작도 못 하고 죽는다.
 */
export function unitPowerOf(kind: UnitKind): number {
  return UNIT_KIND_META[kind]?.power ?? UNIT_KIND_META[DEFAULT_UNIT_KIND].power;
}

/** 카탈로그에서 가장 센 값. 힘 막대의 분모이자 크기 사다리의 위쪽 끝이다. */
export const MAX_UNIT_POWER = Math.max(
  ...Object.values(UNIT_KIND_META).map((m) => m.power),
);

/**
 * 힘 → 그릴 때 곱하는 크기 배수. **센 것이 크게 보인다.**
 *
 * 다섯 종이 같은 캐릭터를 하의 색만 바꿔 구운 것이라(위 주석) **색만으로는 어느 쪽이
 * 센지 알 수가 없다.** 흰·금·초록·보라 사이에는 세다·약하다의 순서가 없다.
 * 크기는 있다 — 설명 없이 읽히는 유일한 축이다 (2026-08-03 사용자 지시).
 *
 * **상점과 실제 판이 같은 함수를 쓴다.** 상점에서만 크게 그리면 화면이 거짓말이 된다 —
 * 산 것이 판에서는 똑같아 보인다.
 *
 * 폭이 1.00~1.20으로 좁은 이유: 판에서 유닛은 26px이고 경로 위에 여럿이 붙어 다닌다.
 * 여기서 1.5배까지 벌리면 센 유닛 줄이 서로 겹쳐 몇 기인지 안 보인다.
 * 나란히 놓고 비교할 때 읽히면 충분하다.
 */
export function sizeFactorOf(power: number): number {
  const span = MAX_UNIT_POWER - 1;
  if (span <= 0) return 1;
  const t = Math.max(0, Math.min(1, (power - 1) / span));
  return 1 + t * 0.2;
}

/** 상점에 늘어놓는 순서. 가격 오름차순이라 카탈로그 선언 순서를 그대로 쓴다. */
export const SHOP_UNIT_ORDER: readonly UnitKind[] = [
  'beergang',
  'beergang_white',
  'beergang_gold',
  'beergang_green',
  'beergang_purple',
];

/** 유료 종류. 코인 목록과 갈라 둔다 — 살 수 있는 곳이 다르다. */
export const SHOP_PREMIUM_ORDER: readonly UnitKind[] = ['beergang_rainbow'];

/**
 * 힘 오름차순 전체 목록. 상점 순서(`SHOP_UNIT_ORDER`)와 달리 **유료 종류도 포함한다** —
 * "한 단계 아래"를 셀 때 무지개(4)에서 보라(3)로 내려갈 수 있어야 한다.
 *
 * 카탈로그에서 만들어 낸다. 손으로 적어 두면 종류를 추가할 때 조용히 어긋난다.
 */
export const POWER_ORDER: readonly UnitKind[] = [...UNIT_KINDS].sort(
  (a, b) => UNIT_KIND_META[a].power - UNIT_KIND_META[b].power,
);

/**
 * 등급. `POWER_ORDER` 에서의 자리다 — 기본이 0, 가장 센 것이 마지막.
 *
 * **표식 개수이자 아우라 세기다.** 힘 숫자(1·1.5·2…)를 그대로 쓰면 반 단계가 섞여
 * 세기 어렵고, 표가 바뀌면 표식 수가 통째로 흔들린다.
 */
export function tierOf(kind: UnitKind): number {
  const i = POWER_ORDER.indexOf(kind);
  return i < 0 ? 0 : i;
}

/** 가장 높은 등급. 아우라 세기를 0~1로 정규화하는 분모다. */
export const MAX_TIER = POWER_ORDER.length - 1;

/**
 * 한 단계 아래 종류. **가장 약한 것이면 그대로 돌려준다** — 더 내려갈 곳이 없다.
 *
 * 봇이 사람보다 한 단계 낮게 입는 데 쓴다 (2026-08-03 사용자 지시, `app/difficulty.ts`).
 */
export function stepDownKind(kind: UnitKind): UnitKind {
  const i = POWER_ORDER.indexOf(kind);
  if (i <= 0) return POWER_ORDER[0] ?? DEFAULT_UNIT_KIND;
  return POWER_ORDER[i - 1];
}

export function isUnitKind(v: unknown): v is UnitKind {
  return typeof v === 'string' && (UNIT_KINDS as readonly string[]).includes(v);
}
