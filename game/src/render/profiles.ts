/**
 * 아바타 이미지 로딩. 필요한 것만 그때 불러온다.
 *
 * `render/sprites.ts` 와 갈라 둔 이유: 스프라이트는 27장 다 합쳐 0.19MB라 시작할 때
 * 전부 불러도 되지만, 아바타는 **장당 0.6~1.0MB**다 (원본을 안 줄였다 — `src/profiles.ts`).
 * 한 판에 필요한 것은 내 것과 상대 것 두 장뿐이라, 다 불러오면 첫 로딩만 늘어진다.
 *
 * 아직 안 불러온 아바타는 `null` 을 돌려준다. 렌더러는 그때 진영색 원을 대신 그린다 —
 * 첫 프레임과 헤드리스 검증이 그 폴백에 기댄다.
 */
import { profileSrc, type ProfileId } from '../profiles';

export class Profiles {
  private images = new Map<ProfileId, HTMLImageElement>();
  private ready = new Set<ProfileId>();

  /** 미리 불러둔다. 판이 시작될 때 그 판에 나올 것만 부르면 된다. */
  load(id: ProfileId): void {
    if (this.images.has(id)) return;
    const img = new Image();
    img.onload = () => this.ready.add(id);
    img.src = profileSrc(id);
    this.images.set(id, img);
  }

  /** 그릴 수 있으면 이미지, 아직이면 null. */
  get(id: ProfileId): HTMLImageElement | null {
    return this.ready.has(id) ? (this.images.get(id) ?? null) : null;
  }

  /** 헤드리스 검증에서 대기 조건으로 쓴다. */
  isReady(id: ProfileId): boolean {
    return this.ready.has(id);
  }
}
