/**
 * 스프라이트 로딩.
 *
 * 에셋: Tiny Swords (Pixel Frog). 파랑/빨강/검정 진영 변형이 원본에 이미 들어 있어
 * **색을 코드로 입히지 않는다.** 이전 Kenney 무채색 에셋 때 쓰던 `color` 합성 틴트는
 * 그래서 통째로 제거했다.
 *
 * 대가: 진영색을 바꾸려면 에셋을 다시 뽑아야 한다. Tiny Swords가 제공하는 색은
 * blue / red / purple / yellow / black 다섯 가지이고, 지금 P1=blue, P2=red, 중립=black 이다.
 * (black은 어두운 슬레이트라 파랑과 안 겹치고 "주인 없음"으로 읽힌다.)
 *
 * 원본은 그림 주위에 큰 투명 여백이 있어서 **추출할 때 알파 경계로 잘라 뒀다**
 * (`scratchpad/export_ts.ps1`). 유닛 6프레임은 프레임마다 자르면 달릴 때 스프라이트가
 * 튀므로 6프레임 합집합 상자로 잘랐다 — 그래서 프레임 크기가 전부 같다.
 *
 * 라이선스: 개인·상용 사용 및 수정 허용, 크레딧 불필요, 에셋 재배포·재판매·재포장 금지.
 * 자세한 건 docs/assets-research.md.
 */

import { UNIT_KIND_META, type UnitKind } from '../units';

const BASE = '/assets';

/**
 * 모든 타워가 쓰는 건물 하나.
 *
 * 전에는 레벨 사다리(작은 집 → 큰 집 → 병영 → 석탑 → 성채)로 5장을 썼는데,
 * 2026-07-30에 레벨이 사라지면서 한 장만 남았다. `lv3` = 병영이다 —
 * 다섯 중 중간 크기이고 실루엣이 "요새"로 읽혀 작게 그려도 뭉개지지 않는다.
 * 나머지 네 장은 `game/public/assets/tower/` 에 그대로 있다. 바꾸려면 이 한 줄만 고치면 된다.
 */
const TOWER_ART = 'lv3';

type FactionSlug = 'p1' | 'p2' | 'neutral';

function factionOf(owner: 0 | 1 | 2): FactionSlug {
  return owner === 1 ? 'p1' : owner === 2 ? 'p2' : 'neutral';
}

/**
 * 유닛이 화면에서 어느 쪽으로 걷는가. **파일 이름 앞머리와 같다.**
 *
 * 세로형이 된 뒤(§-23) 유닛이 대부분 위아래로 움직이는데 옆모습만 있으면
 * 걷는 방향이 안 읽힌다. 그래서 `bake-units.ts` 가 세 방향을 굽는다:
 *
 *   `run`  옆모습 (yaw 90).  왼쪽 이동은 렌더러가 좌우 반전한다
 *   `up`   후면   (yaw 180). 위로 = 상대 진영 쪽
 *   `down` 정면   (yaw 0).   아래로 = 내 진영 쪽
 *
 * **`run` 이라는 이름을 바꾸지 말 것** — 상점 썸네일이 `run0.png` 를 직접 부른다.
 */
export type UnitDir = 'run' | 'up' | 'down';
export const UNIT_DIRS: readonly UnitDir[] = ['run', 'up', 'down'];

const TOWER_PATHS: Record<string, string> = {};
for (const slug of ['p1', 'p2', 'neutral'] as FactionSlug[]) {
  TOWER_PATHS[`tower_${slug}`] = `${BASE}/tower/${slug}/${TOWER_ART}.png`;
}

const unitKey = (slug: FactionSlug, kind: UnitKind, dir: UnitDir, i: number) =>
  `unit_${slug}_${kind}_${dir}_${i}`;

export interface Painted {
  canvas: CanvasImageSource;
  w: number;
  h: number;
}

export class Sprites {
  private images = new Map<string, HTMLImageElement>();
  private loaded = new Set<string>();
  /** 이미 부른 (진영, 종류) 조합. 같은 것을 두 번 부르지 않는다. */
  private requested = new Set<string>();

  constructor() {
    // 건물은 세 장뿐이라 그냥 미리 받는다.
    for (const [key, src] of Object.entries(TOWER_PATHS)) this.fetch(key, src);
  }

  private fetch(key: string, src: string): void {
    if (this.images.has(key)) return;
    const img = new Image();
    img.onload = () => this.loaded.add(key);
    img.src = src;
    this.images.set(key, img);
  }

  /**
   * 한 판에 나올 유닛만 불러온다. `Renderer.setUnitKinds` 가 부른다.
   *
   * **미리 다 받지 않는 이유**: 종류 5 × 진영 2 × 방향 3 × 8프레임 = 240장이다.
   * 한 판에 실제로 쓰는 것은 (내 진영·내 종류) + (상대 진영·상대 종류) = 48장뿐이라,
   * 다 받으면 첫 로딩만 다섯 배로 늘어진다. `render/profiles.ts` 가 아바타에
   * 같은 판단을 해 뒀다 (§-15).
   *
   * 아직 안 온 그림은 `null` 이 나가고 렌더러가 원으로 폴백한다 — 첫 프레임과
   * 헤드리스 검증이 그 폴백에 기댄다.
   */
  loadUnit(owner: 1 | 2, kind: UnitKind): void {
    const slug = factionOf(owner);
    const tag = `${slug}/${kind}`;
    if (this.requested.has(tag)) return;
    this.requested.add(tag);
    const n = UNIT_KIND_META[kind].frames;
    for (const dir of UNIT_DIRS) {
      for (let i = 0; i < n; i++) {
        this.fetch(unitKey(slug, kind, dir, i), `${BASE}/unit/${slug}/${kind}/${dir}${i}.png`);
      }
    }
  }

  /** 지금까지 요청한 것이 다 왔는가. 헤드리스 검증에서 대기 조건으로 쓴다. */
  get ready(): boolean {
    return this.loaded.size === this.images.size;
  }

  private grab(key: string): Painted | null {
    if (!this.loaded.has(key)) return null;
    const img = this.images.get(key);
    if (!img) return null;
    return { canvas: img, w: img.naturalWidth, h: img.naturalHeight };
  }

  /** 소유자에 맞는 건물. 로딩 전이면 null (렌더러가 도형으로 폴백한다). */
  tower(owner: 0 | 1 | 2): Painted | null {
    return this.grab(`tower_${factionOf(owner)}`);
  }

  /** 러닝 사이클 한 프레임. `frame` 은 알아서 감긴다 — 종류마다 프레임 수가 다르다. */
  unit(owner: 1 | 2, kind: UnitKind, dir: UnitDir, frame: number): Painted | null {
    const n = UNIT_KIND_META[kind].frames;
    const i = ((Math.floor(frame) % n) + n) % n;
    return this.grab(unitKey(factionOf(owner), kind, dir, i));
  }
}
