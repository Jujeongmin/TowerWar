/**
 * 프로필 아바타 카탈로그.
 *
 * ── 캐릭터는 하나다. 배경색만 고른다 (2026-07-31, 사용자 지시) ──
 *
 * 전에는 9종의 서로 다른 캐릭터 그림을 골랐다 — BeerGang / ryan / bayc / CloneX 2종 /
 * RPM 2종 / animeGirl / 기본. 사용자 지시로 **BeerGang 하나로 고정하고 뒤에 깔리는
 * 원 색깔만 고르게** 바꿨다.
 *
 * 그래서 그림 파일이 `beergang.png` **한 장**이다. 나머지 8장은 배포물에서 지웠고
 * 원본은 `assets-src/beergang/2D/mvp_profile/` 에 그대로 있다.
 *
 * **라이선스가 이걸로 정리된다.** 지웠던 8장 중 `ryan`(카카오)·`bayc`(Yuga Labs)·
 * `clonex_w`·`clonx_b`(RTFKT/Nike) 는 남의 IP인데 배포물에 실려 있었다(§-15, §-18).
 * 이제 배포물에 남는 것은 BeerGang 자산 하나뿐이다.
 *
 * ── 배경색이 곧 id 다 ─────────────────────────────────────────
 *
 * id를 색 이름으로 둔 이유: 저장본과 서버(`server.js` 의 `PROFILE_IDS`)에 문자열로
 * 남는 값이라, 나중에 팔레트를 손볼 때 어느 색이었는지가 id만 보고 읽혀야 한다.
 *
 * 색은 **중간 명도**로 골랐다. 너무 어두우면 카드가 다 같아 보이고, 너무 밝으면
 * 캐릭터 윤곽이 배경에 묻힌다. 26px HUD에서도 색이 갈리는 것을 기준으로 잡았다.
 *
 * ── 순수 외형이다 ─────────────────────────────────────────────
 *
 * 시뮬레이션은 이 값을 모른다. 계정에 저장되고 HUD·로비에만 나온다.
 */

export const PROFILE_IDS = [
  'slate',
  'blue',
  'cyan',
  'green',
  'gold',
  'orange',
  'red',
  'purple',
  'pink',
] as const;

export type ProfileId = (typeof PROFILE_IDS)[number];

/**
 * 아직 안 고른 사람에게 붙는 것.
 *
 * 전 형식의 `default`(빈 실루엣)와 달리 **이건 정상적인 선택지다.** 안 고른 것과
 * 고른 것이 그림으로 구분되지 않으므로, 봇 아바타에서 이 값을 뺄 이유도 사라졌다
 * (`app/bot-name.ts`).
 */
export const DEFAULT_PROFILE: ProfileId = 'slate';

export const PROFILE_LABEL: Record<ProfileId, string> = {
  slate: '회색',
  blue: '파랑',
  cyan: '청록',
  green: '초록',
  gold: '금색',
  orange: '주황',
  red: '빨강',
  purple: '보라',
  pink: '분홍',
};

/** 캐릭터 뒤에 깔리는 원 색. DOM(카드·로비)과 캔버스 HUD가 같은 값을 쓴다. */
export const PROFILE_BG: Record<ProfileId, string> = {
  slate: '#3a4757',
  blue: '#2b6cb0',
  cyan: '#178a9c',
  green: '#2f855a',
  gold: '#b7791f',
  orange: '#c05621',
  red: '#b03a3f',
  purple: '#6b46c1',
  pink: '#b83280',
};

/**
 * 그림은 종류와 무관하게 한 장이다.
 *
 * 인자를 남겨 둔 것은 부르는 쪽(`render/profiles.ts`·`name-scene.ts`)을 안 고치려는
 * 것이고, 캐릭터를 다시 늘릴 여지도 여기 한 줄에 남는다.
 */
export function profileSrc(_id: ProfileId): string {
  return '/assets/profile/beergang.png';
}

export function profileBg(id: ProfileId): string {
  return PROFILE_BG[id] ?? PROFILE_BG[DEFAULT_PROFILE];
}

export function isProfileId(v: unknown): v is ProfileId {
  return typeof v === 'string' && (PROFILE_IDS as readonly string[]).includes(v);
}
