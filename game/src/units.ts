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

export const UNIT_KINDS = [
  'beergang',
  'beergang_white',
  'beergang_gold',
  'beergang_green',
  'beergang_purple',
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
  label: string;
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
  /** 상점에 보여줄 한 줄. */
  blurb: string;
}

/**
 * 다섯 종 전부 Mixamo `Walking` 클립으로 구운 같은 캐릭터다. 59×91 8프레임.
 *
 * **가격표가 `server.js` 의 `UNIT_PRICES` 에도 있다.** 서버가 소유·착용을 판정하므로
 * (§-10) 어긋나면 "상점에는 보이는데 못 입는"이 된다. 고칠 때 양쪽을 같이 고칠 것.
 */
export const UNIT_KIND_META: Record<UnitKind, UnitKindMeta> = {
  beergang: { label: '비어갱', frames: 8, scale: 1.3, price: 0, power: 1, blurb: '기본' },
  beergang_white: { label: '흰 비어갱', frames: 8, scale: 1.3, price: 400, power: 1.5, blurb: '흰 하의' },
  beergang_gold: { label: '금 비어갱', frames: 8, scale: 1.3, price: 900, power: 2, blurb: '금 하의' },
  beergang_green: { label: '초록 비어갱', frames: 8, scale: 1.3, price: 1500, power: 2.5, blurb: '초록 하의' },
  beergang_purple: { label: '보라 비어갱', frames: 8, scale: 1.3, price: 2400, power: 3, blurb: '보라 하의' },
};

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

export function isUnitKind(v: unknown): v is UnitKind {
  return typeof v === 'string' && (UNIT_KINDS as readonly string[]).includes(v);
}
