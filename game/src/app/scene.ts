/**
 * 화면 하나의 수명 주기.
 *
 * rAF 루프는 앱에 하나뿐이고(main.ts) 매 프레임 현재 씬의 `frame`만 부른다.
 * 씬이 각자 루프를 돌리면 전환하는 순간 둘이 겹쳐 도는 구간이 생긴다.
 */
import type { MatchSetup, MatchTransport } from '../net/types';

export interface Scene {
  enter(): void;
  exit(): void;
  /** rAF마다 호출. DOM만 쓰는 씬은 빈 함수로 둔다. */
  frame(dt: number): void;
}

/**
 * 이 판을 어떤 조건으로 시작하는가.
 *
 * PVE는 클라이언트가 시드를 정하지만 **PVP는 서버가 정한 것만 쓴다** —
 * 클라이언트가 정하면 둘이 다른 맵을 만들거나 둘 다 P1이 된다.
 */
export type MatchPlan =
  /**
   * 봇전. `seed` 를 주면 그걸 쓰고, 없으면 클라이언트가 뽑는다.
   *
   * `serverRoom` 은 이 판이 서버가 연 방이었는지다 — 보상을 서버에 보고할지
   * 로컬에 넣을지가 여기서 갈린다. 매칭이 아예 실패해 붙은 봇전은 `false` 다.
   */
  | { mode: 'pve'; seed?: number; serverRoom: boolean }
  | { mode: 'pvp'; setup: MatchSetup; transport: MatchTransport };
