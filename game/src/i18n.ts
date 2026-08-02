/**
 * 화면 문자열. **기본값은 영어다** (2026-08-03 사용자 지시).
 *
 * ── 왜 사전 하나에 몰아넣는가 ─────────────────────────────────
 *
 * 문자열이 씬마다 흩어져 있으면 언어를 하나 더 넣을 때 **어디를 안 고쳤는지 알 수가
 * 없다.** 여기 표가 하나뿐이면 빠진 키는 타입 검사에서 걸린다 (`Strings` 가 두 언어에
 * 똑같이 요구된다).
 *
 * ── 무엇을 안 번역하는가 ─────────────────────────────────────
 *
 * - **콘솔 경고**: 사람이 아니라 개발자가 읽는다. 번역하면 검색이 안 된다
 * - **`throw` 하는 내부 오류** (`…DOM이 예상과 다릅니다`): 화면에 안 나온다. 나오면
 *   그건 버그이지 안내가 아니다
 * - **서버 오류 문구**: `server.js` 는 이 파일을 못 읽는다(단일 파일 샌드박스).
 *   화면에 그대로 띄우는 곳은 닉네임 화면 하나뿐이라 거기서 키로 갈아 끼운다
 *
 * ── 봇 이름은 언어를 따라간다 ────────────────────────────────
 *
 * `app/bot-name.ts` 가 한국어 조합어를 만든다. 영어 화면에 한국어 이름이 뜨면 그게
 * 곧 "이 상대는 사람이 아니다"라는 신호가 된다 (§-7은 안 알리기로 했다). 그래서
 * 낱말 목록도 여기 있다.
 */

export const LANGS = ['en', 'ko'] as const;
export type Lang = (typeof LANGS)[number];

/** 기본 언어. 사용자 지시로 영어다. */
export const DEFAULT_LANG: Lang = 'en';

const STORAGE_KEY = 'towerwar.lang';

export interface Strings {
  // 로비
  tagline: string;
  autoMatch: string;
  playFriend: string;
  shop: string;
  ranking: string;
  settings: string;
  // 닉네임
  nameTitle: string;
  namePlaceholder: string;
  start: string;
  nameRequired: (max: number) => string;
  // 공통
  back: string;
  // 대전 대기
  pvpTitleAuto: string;
  pvpTitleFriend: string;
  searching: string;
  startingSoon: string;
  waitingFriend: string;
  joiningRoom: string;
  makeRoomOrCode: string;
  roomCodePlaceholder: string;
  join: string;
  hostRoom: string;
  couldNotJoin: string;
  connectionRefused: string;
  roomClosed: (reason: string) => string;
  // 상점
  shopUpgrades: string;
  shopSpeed: string;
  shopUnits: string;
  shopVx: string;
  vxNotListed: string;
  vxOpenFailed: string;
  maxed: string;
  equipped: string;
  equip: string;
  buyWithVx: string;
  comingSoon: string;
  unitStats: (power: number) => string;
  // 순위
  boardTitle: string;
  boardLoading: string;
  boardOffline: string;
  boardEmpty: string;
  points: (n: number) => string;
  // 매치
  playAgain: string;
  toLobby: string;
  resign: string;
  victory: string;
  defeat: string;
  draw: string;
  resigned: string;
  resignNoReward: string;
  rewardLine: (total: number, base: number, towers: number, bonus: number) => string;
  ratingLine: (before: number, after: number, sign: string, diff: number) => string;
  hint: string;
  waitingPeer: string;
  record: (w: number, l: number) => string;
  // 유닛 카탈로그
  unitLabels: Record<string, string>;
  unitBlurbs: Record<string, string>;
  // 아바타
  profileNames: Record<string, string>;
  // 봇 이름 조합
  botHead: readonly string[];
  botTail: readonly string[];
  /** 조합 방식이 언어마다 다르다 — 한국어는 붙여 쓰고 영어는 띄어 쓴다. */
  botJoin: (head: string, tail: string, tag: number) => string;
  // 설정
  language: string;
  sound: string;
  volMaster: string;
  volSfx: string;
  volBgm: string;
  // 유료·광고
  tempoItem: string;
  tempoItemBlurb: string;
  tempoItemDesc: string;
  adCard: string;
  adCardAction: string;
  owned: string;
  adWatch: (coins: number) => string;
  adDouble: string;
  adUnavailable: string;
  adFailed: string;
  adLimit: string;
  adCooldown: string;
}

const en: Strings = {
  tagline: 'Draw supply lines. Push the front.',
  autoMatch: 'Quick Match',
  playFriend: 'Play a Friend',
  shop: 'Shop',
  ranking: 'Ranking',
  settings: 'Settings',
  nameTitle: 'Name and Avatar',
  namePlaceholder: 'Enter your name',
  start: 'Start',
  nameRequired: (max) => `Enter a name (up to ${max} characters)`,
  back: 'Back',
  pvpTitleAuto: 'Match',
  pvpTitleFriend: 'Play a Friend',
  searching: 'Finding an opponent…',
  startingSoon: 'Starting soon',
  waitingFriend: 'Waiting for your friend…',
  joiningRoom: 'Joining the room…',
  makeRoomOrCode: 'Host a room or enter a code',
  roomCodePlaceholder: 'Room code',
  join: 'Join',
  hostRoom: 'Host Room',
  couldNotJoin: 'Could not join',
  connectionRefused: 'Connection refused',
  roomClosed: (reason) => `Room closed (${reason})`,
  shopUpgrades: 'Permanent Upgrades',
  shopSpeed: 'Production Speed',
  shopUnits: 'Units — pricier means more health and attack',
  shopVx: 'VX — Real-money',
  vxNotListed: 'This item is not on sale yet.',
  vxOpenFailed: "Couldn't open the store. Tap again.",
  maxed: 'Max',
  equipped: 'Equipped',
  equip: 'Equip',
  buyWithVx: 'Buy with VX',
  comingSoon: 'Coming soon',
  unitStats: (power) => `Health ${power} · Attack ${power}`,
  boardTitle: 'Ranking — Top 10 by score',
  boardLoading: 'Loading…',
  boardOffline: 'Not connected, so the ranking is unavailable',
  boardEmpty: 'Nobody has made the ranking yet',
  points: (n) => `${n} pts`,
  playAgain: 'Play Again',
  toLobby: 'Lobby',
  resign: 'Resign',
  victory: 'Victory',
  defeat: 'Defeat',
  draw: 'Draw',
  resigned: 'Resigned',
  resignNoReward: 'Resigned — no reward',
  rewardLine: (total, base, towers, bonus) =>
    `+${total}  (base ${base} · ${towers} towers ${bonus})`,
  ratingLine: (before, after, sign, diff) => `Score ${before} → ${after}  (${sign}${diff})`,
  hint: 'Drag: open/close a route  ·  Swipe empty space: cut routes',
  waitingPeer: 'Waiting for opponent',
  record: (w, l) => `${w}W ${l}L`,
  unitLabels: {
    beergang: 'Beergang',
    beergang_white: 'White Beergang',
    beergang_gold: 'Gold Beergang',
    beergang_green: 'Green Beergang',
    beergang_purple: 'Purple Beergang',
    beergang_rainbow: 'Rainbow Beergang',
  },
  unitBlurbs: {
    beergang: 'Starter',
    beergang_white: 'White pants',
    beergang_gold: 'Gold pants',
    beergang_green: 'Green pants',
    beergang_purple: 'Purple pants',
    beergang_rainbow: 'VX only · strongest',
  },
  profileNames: {
    slate: 'Slate',
    blue: 'Blue',
    cyan: 'Cyan',
    green: 'Green',
    gold: 'Gold',
    orange: 'Orange',
    red: 'Red',
    purple: 'Purple',
    pink: 'Pink',
  },
  botHead: [
    'Black', 'Blue', 'Red', 'Quiet', 'Swift', 'Late', 'Little', 'Great',
    'Lone', 'Angry', 'Easy', 'Cold', 'Hot', 'Grey',
  ],
  botTail: [
    'Knight', 'Wolf', 'Raven', 'Shield', 'Spear', 'Wind', 'Dusk', 'Frost',
    'Hammer', 'Fox', 'North', 'Lantern', 'Sand', 'Wave',
  ],
  botJoin: (head, tail, tag) => `${head}${tail}${tag}`,
  language: 'Language',
  sound: 'Sound',
  volMaster: 'Overall',
  volSfx: 'Effects',
  volBgm: 'Music',
  tempoItem: 'Speed Boost',
  tempoItemBlurb: 'Speed the whole match up',
  tempoItemDesc:
    'A button appears during a match. Turning it on runs the match at 1.5x for BOTH sides, not just you. If your opponent has it and turns it on too, it becomes 2x. Units, production and the clock all speed up together, so the odds do not change: the match simply finishes sooner.',
  adCard: 'Ad reward',
  adCardAction: 'Watch',
  owned: 'Owned',
  adWatch: (coins) => `Watch an ad · +${coins}`,
  adDouble: 'Watch an ad — double it',
  adUnavailable: 'No ad available right now',
  adFailed: 'Ad was not finished, so no reward',
  adLimit: "You've claimed all of today's ads",
  adCooldown: 'Try again in a moment',
};

const ko: Strings = {
  tagline: '보급선을 긋고 전선을 밀어라',
  autoMatch: '자동 매칭',
  playFriend: '친구랑 하기',
  shop: '상점',
  ranking: '순위',
  settings: '설정',
  nameTitle: '닉네임과 아바타',
  namePlaceholder: '이름을 입력하세요',
  start: '시작',
  nameRequired: (max) => `이름을 입력하세요 (최대 ${max}자)`,
  back: '돌아가기',
  pvpTitleAuto: '대전',
  pvpTitleFriend: '친구랑 하기',
  searching: '상대를 찾는 중…',
  startingSoon: '곧 시작합니다',
  waitingFriend: '친구를 기다리는 중…',
  joiningRoom: '방에 들어가는 중…',
  makeRoomOrCode: '방을 만들거나 코드를 입력하세요',
  roomCodePlaceholder: '친구 방 코드',
  join: '참가',
  hostRoom: '방 만들기',
  couldNotJoin: '들어가지 못했습니다',
  connectionRefused: '연결이 거부되었습니다',
  roomClosed: (reason) => `방이 닫혔습니다 (${reason})`,
  shopUpgrades: '영구 강화',
  shopSpeed: '생산 속도',
  shopUnits: '유닛 — 비쌀수록 체력과 공격력이 높다',
  shopVx: 'VX — 현금 결제',
  vxNotListed: '결제 상품이 아직 등록되지 않았습니다.',
  vxOpenFailed: '결제 창을 열지 못했습니다. 다시 눌러 주세요.',
  maxed: '최대',
  equipped: '착용 중',
  equip: '착용하기',
  buyWithVx: 'VX로 구매',
  comingSoon: '준비 중',
  unitStats: (power) => `체력 ${power} · 공격력 ${power}`,
  boardTitle: '순위 — 점수 상위 10명',
  boardLoading: '불러오는 중…',
  boardOffline: '서버에 연결되지 않아 순위를 볼 수 없습니다',
  boardEmpty: '아직 순위에 오른 사람이 없습니다',
  points: (n) => `${n}점`,
  playAgain: '다시 하기',
  toLobby: '로비로',
  resign: '항복',
  victory: '승리',
  defeat: '패배',
  draw: '무승부',
  resigned: '항복',
  resignNoReward: '항복 — 보상 없음',
  rewardLine: (total, base, towers, bonus) =>
    `+${total}  (기본 ${base} · 타워 ${towers}개 ${bonus})`,
  ratingLine: (before, after, sign, diff) => `점수 ${before} → ${after}  (${sign}${diff})`,
  hint: '드래그: 경로 개설/차단  ·  빈 곳 스와이프: 경로 절단',
  waitingPeer: '상대를 기다리는 중',
  record: (w, l) => `${w}승 ${l}패`,
  unitLabels: {
    beergang: '비어갱',
    beergang_white: '흰 비어갱',
    beergang_gold: '금 비어갱',
    beergang_green: '초록 비어갱',
    beergang_purple: '보라 비어갱',
    beergang_rainbow: '무지개 비어갱',
  },
  unitBlurbs: {
    beergang: '기본',
    beergang_white: '흰 하의',
    beergang_gold: '금 하의',
    beergang_green: '초록 하의',
    beergang_purple: '보라 하의',
    beergang_rainbow: 'VX 전용 · 가장 강함',
  },
  profileNames: {
    slate: '회색',
    blue: '파랑',
    cyan: '청록',
    green: '초록',
    gold: '금색',
    orange: '주황',
    red: '빨강',
    purple: '보라',
    pink: '분홍',
  },
  botHead: [
    '검은', '푸른', '붉은', '조용한', '빠른', '늦은', '작은', '커다란',
    '외로운', '성난', '느긋한', '차가운', '뜨거운', '흐린',
  ],
  botTail: [
    '기사', '늑대', '까마귀', '방패', '창날', '바람', '노을', '서리',
    '망치', '여우', '북풍', '등불', '모래', '파도',
  ],
  botJoin: (head, tail, tag) => `${head}${tail}${tag}`,
  language: '언어',
  sound: '소리',
  volMaster: '전체',
  volSfx: '효과음',
  volBgm: '배경음',
  tempoItem: '배속',
  tempoItemBlurb: '판 전체를 빠르게',
  tempoItemDesc:
    '판에 버튼이 생긴다. 켜면 판이 1.5배로 돈다 — 나만이 아니라 양쪽 다. 상대도 가지고 있고 같이 켜면 2배가 된다. 유닛도 생산도 시계도 함께 빨라지므로 유불리는 안 바뀌고, 판이 더 빨리 끝난다.',
  adCard: '광고 보상',
  adCardAction: '보기',
  owned: '보유 중',
  adWatch: (coins) => `광고 보고 +${coins}`,
  adDouble: '광고 보고 두 배 받기',
  adUnavailable: '지금은 볼 광고가 없습니다',
  adFailed: '광고를 끝까지 안 봐서 보상이 없습니다',
  adLimit: '오늘 받을 수 있는 광고를 다 받았습니다',
  adCooldown: '조금 뒤에 다시 시도하세요',
};

const TABLE: Record<Lang, Strings> = { en, ko };

function isLang(v: unknown): v is Lang {
  return typeof v === 'string' && (LANGS as readonly string[]).includes(v);
}

/**
 * 저장된 언어. **기기 언어를 안 본다** — 기본을 영어로 하라는 지시였고, 브라우저
 * 언어를 읽으면 한국 기기에서 저절로 한국어가 돼 그 지시가 무너진다.
 */
let current: Lang = (() => {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return isLang(v) ? v : DEFAULT_LANG;
  } catch {
    return DEFAULT_LANG;
  }
})();

export function getLang(): Lang {
  return current;
}

/** 언어를 바꾸고 저장한다. **화면 다시 그리기는 호출부가 한다** (`applyStaticText`). */
export function setLang(lang: Lang): void {
  current = lang;
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // 사파리 프라이빗 모드 등. 이번 세션 동안만 유지된다 — 못 쓰는 것보다 낫다.
  }
  document.documentElement.lang = lang;
}

/** 지금 언어의 문자열 표. `t().searching` 처럼 쓴다. */
export function t(): Strings {
  return TABLE[current];
}

/**
 * `data-i18n` 이 붙은 정적 문자열을 지금 언어로 채운다.
 *
 * HTML에 글자를 그대로 두지 않는 이유: 언어를 바꿀 때 **씬을 다시 만들지 않고** 다시
 * 그릴 수 있어야 한다. 속성 이름만 보고 채우므로 씬은 이 함수를 몰라도 된다.
 */
export function applyStaticText(root: ParentNode = document): void {
  const s = t() as unknown as Record<string, unknown>;
  // `NodeList` 를 배열로 편다. tsconfig 의 target 이 낮아 `for...of` 를 바로 못 돈다.
  root.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
    const v = s[el.dataset.i18n ?? ''];
    if (typeof v === 'string') el.textContent = v;
  });
  root.querySelectorAll<HTMLInputElement>('[data-i18n-ph]').forEach((el) => {
    const v = s[el.dataset.i18nPh ?? ''];
    if (typeof v === 'string') el.placeholder = v;
  });
}
