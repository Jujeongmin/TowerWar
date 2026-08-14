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

/**
 * **`'zh'` 는 간체다.** 번체를 넣으면서 `'zh-Hans'` 로 고치고 싶었지만, 이 값이 그대로
 * localStorage 에 저장돼 있어서(`STORAGE_KEY`) 바꾸면 이미 중국어를 고른 사람이 영어로
 * 되돌아간다. 새로 붙는 번체만 BCP47 대로 `'zh-Hant'` 를 쓴다.
 */
export const LANGS = ['en', 'ko', 'ja', 'zh', 'zh-Hant', 'vi'] as const;
export type Lang = (typeof LANGS)[number];

/** 기본 언어. 사용자 지시로 영어다. */
export const DEFAULT_LANG: Lang = 'en';

/**
 * 각 언어를 **그 언어로** 적는다. 한국어 화면에서 'Korean' 은 아무 도움이 안 된다.
 *
 * **여기 둔 이유는 고르는 곳이 둘이기 때문이다** — 설정 화면과 첫 실행 닉네임 화면.
 * 이 표를 화면 쪽에 두면 언어를 하나 더 넣을 때 한쪽을 빠뜨린다. `LANGS` 옆에 있어야
 * 타입이 빠진 언어를 잡아 준다.
 */
export const ENDONYM: Record<Lang, string> = {
  en: 'English',
  ko: '한국어',
  ja: '日本語',
  // 번체가 생겼으니 '中文' 만으로는 어느 쪽인지 알 수 없다.
  zh: '简体中文',
  'zh-Hant': '繁體中文',
  vi: 'Tiếng Việt',
};

const STORAGE_KEY = 'towerwar.lang';

export interface Strings {
  // 로비
  tagline: string;
  autoMatch: string;
  playFriend: string;
  shop: string;
  ranking: string;
  tutorial: string;
  tutorialTitle: string;
  tutorialIntro: string;
  tutorialRouteTitle: string;
  tutorialRouteBody: string;
  tutorialCutTitle: string;
  tutorialCutBody: string;
  tutorialCaptureTitle: string;
  tutorialCaptureBody: string;
  tutorialStockTitle: string;
  tutorialStockBody: string;
  tutorialRelayTitle: string;
  tutorialRelayBody: string;
  tutorialWinTitle: string;
  tutorialWinBody: string;
  gotIt: string;
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
  matchingFallbackHint: string;
  creatingRoom: string;
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
  shopTowers: string;
  shopUnits: string;
  shopVx: string;
  vxNotListed: string;
  vxOpenFailed: string;
  equipped: string;
  equip: string;
  comingSoon: string;
  unitStats: (power: number) => string;
  towerStats: (speed: number) => string;
  // 순위
  boardTitle: string;
  boardLoading: string;
  boardOffline: string;
  boardEmpty: string;
  /** 다시 붙어 보는 버튼. 순위가 안 열렸을 때만 뜬다. */
  boardRetry: string;
  /** 하단 내 순위 줄. 표가 잘려서 내 줄이 안 보일 때도 등수를 알려 준다. */
  boardMyRank: (rank: number, total: number) => string;
  /** 아직 표에 안 올랐을 때 (닉네임만 정하고 한 판도 안 끝낸 상태). */
  boardUnranked: string;
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
  /** 친구 방은 코인도 점수도 전적도 안 준다 — 짜고 두면 무한히 불릴 수 있어서다. */
  friendNoReward: string;
  /** 상대와의 연결이 끊겨 판을 끝냈다. 승패가 아니다 — 점수도 보상도 안 움직인다. */
  disconnected: string;
  disconnectedNote: string;
  rewardLine: (total: number, base: number, towers: number, bonus: number) => string;
  ratingLine: (before: number, after: number, sign: string, diff: number) => string;
  hint: string;
  waitingPeer: string;
  record: (w: number, l: number) => string;
  // 유닛 카탈로그
  unitLabels: Record<string, string>;
  unitBlurbs: Record<string, string>;
  // 타워 카탈로그
  towerLabels: Record<string, string>;
  towerBlurbs: Record<string, string>;
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
  /** 전적 초기화 구역 제목. */
  recordSection: string;
  /** 전적 초기화 버튼(평상시). */
  resetRecord: string;
  /** 한 번 더 눌러야 실행되는 확인 문구. */
  resetRecordConfirm: string;
  /** 초기화 뒤 안내. */
  resetRecordDone: string;
  /** 점수는 유지된다는 안내. 지금 전적도 같이 보여준다. */
  resetRecordNote: (w: number, l: number) => string;
  /** 제작자 팔로우 보상 구역. */
  followSection: string;
  /** 팔로우 보상 안내. 금액이 들어가서 `data-i18n` 이 아니라 코드가 채운다. */
  followReward: (coins: number) => string;
  followClaim: string;
  followClaimed: string;
  followClaiming: string;
  /** 아직 팔로우 안 한 사람에게 띄우는 버튼. 누르면 제작자 페이지가 새 탭으로 열린다. */
  followGo: string;
  followNotYet: string;
  /** 통신 오류 등으로 청구가 실패했다. 다시 눌러 보라는 뜻. */
  followFailed: string;
  volMaster: string;
  volSfx: string;
  volBgm: string;
  // 유료·광고
  tempoItem: string;
  opponentTempo: (scale: number) => string;
  tempoItemBlurb: string;
  tempoItemDesc: string;
  adCard: string;
  adCardAction: string;
  owned: string;
  adWatch: (coins: number) => string;
  adDouble: string;
  /** 두 배를 실제로 받은 뒤. **서버가 준 금액을 그대로 적는다** — 화면이 다시 계산하지 않는다. */
  rewardDoubled: (gained: number) => string;
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
  tutorial: 'How to Play',
  tutorialTitle: 'Field Manual',
  tutorialIntro: 'Build supply lines, take towers, and push the front.',
  tutorialRouteTitle: 'Set a route',
  tutorialRouteBody: 'Drag from one of your towers to another tower. The source sends troops continuously while the route is open.',
  tutorialCutTitle: 'Cut your routes',
  tutorialCutBody: 'Swipe across your own route from empty space to close it. Enemy routes cannot be cut directly.',
  tutorialCaptureTitle: 'Capture towers',
  tutorialCaptureBody: 'Send troops into a neutral or enemy tower. Reduce its defenders to zero to take control; friendly arrivals reinforce it.',
  tutorialStockTitle: 'Stock and route slots',
  tutorialStockBody: 'A tower with no outgoing route stores troops. Stock 1 / 10 / 20 unlocks 1 / 2 / 3 simultaneous routes.',
  tutorialRelayTitle: 'Use a full tower',
  tutorialRelayBody: 'At 60 troops, the base ring turns white and the tower becomes a relay. Friendly troops arriving there continue along its outgoing routes.',
  tutorialWinTitle: 'Win the front',
  tutorialWinBody: 'Eliminate the enemy, or own more towers when time expires. If tied, total remaining power decides.',
  gotIt: 'Got it',
  settings: 'Settings',
  nameTitle: 'Name and Avatar',
  namePlaceholder: 'Enter your name',
  start: 'Start',
  nameRequired: (max) => `Enter a name (up to ${max} characters)`,
  back: 'Back',
  pvpTitleAuto: 'Match',
  pvpTitleFriend: 'Play a Friend',
  searching: 'Finding an opponent…',
  matchingFallbackHint: 'If no opponent is found within 12 seconds, you will play against AI.',
  creatingRoom: 'Creating room code…',
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
  shopTowers: 'Towers — pricier means faster production',
  shopUnits: 'Units — pricier means more health and attack',
  shopVx: 'VX — Real-money',
  vxNotListed: 'This item is not on sale yet.',
  vxOpenFailed: "Couldn't open the store. Tap again.",
  equipped: 'Equipped',
  equip: 'Equip',
  comingSoon: 'Coming soon',
  unitStats: (power) => `Health ${power} · Attack ${power}`,
  towerStats: (speed) => `Production ×${speed.toFixed(2)}`,
  boardTitle: 'Ranking — by score',
  boardLoading: 'Loading…',
  boardOffline: 'Not connected, so the ranking is unavailable',
  boardEmpty: 'Nobody has made the ranking yet',
  boardRetry: 'Try again',
  boardMyRank: (rank, total) => `Your rank #${rank} of ${total}`,
  boardUnranked: 'Not ranked yet',
  points: (n) => `${n} pts`,
  playAgain: 'Find Match',
  toLobby: 'Lobby',
  resign: 'Resign',
  victory: 'Victory',
  defeat: 'Defeat',
  draw: 'Draw',
  resigned: 'Resigned',
  resignNoReward: 'Resigned — no reward',
  friendNoReward: 'Friendly match — no coins, score, or record',
  disconnected: 'Disconnected',
  disconnectedNote: 'Lost connection to your opponent. Score and rewards are unchanged.',
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
  recordSection: 'Record',
  resetRecord: 'Reset record',
  resetRecordConfirm: 'Tap again to reset',
  resetRecordDone: 'Record reset',
  resetRecordNote: (w, l) => `Now ${w}W ${l}L · your score is kept`,
  followSection: 'Support the creator',
  followReward: (coins) => `Follow the creator for ${coins} coins — once per account.`,
  followClaim: 'Claim',
  followClaimed: 'Claimed',
  followClaiming: 'Checking with the server…',
  followGo: 'Follow the creator',
  followNotYet: "We can't see a follow yet. Follow on the game page, then tap Claim.",
  followFailed: "Couldn't reach the server. Tap again.",
  volMaster: 'Overall',
  volSfx: 'Effects',
  volBgm: 'Music',
  tempoItem: 'Speed Boost',
  opponentTempo: (scale) => `Opponent boost · ${scale}×`,
  tempoItemBlurb: 'Speed the whole match up',
  tempoItemDesc:
    'A button appears during a match. Turning it on runs the match at 1.5x for BOTH sides, not just you. If your opponent has it and turns it on too, it becomes 2x.',
  adCard: 'Ad reward',
  adCardAction: 'Watch',
  owned: 'Owned',
  adWatch: (coins) => `Watch an ad · +${coins}`,
  adDouble: 'Watch an ad — double it',
  rewardDoubled: (gained) => `Ad reward · +${gained} more`,
  adUnavailable: 'No ad available right now',
  adFailed: 'Ad was not finished, so no reward',
  adLimit: "You've claimed all of today's ads",
  adCooldown: 'Try again in a moment',
};

const ko: Strings = {
  tutorial: '튜토리얼 보기',
  tutorialTitle: '전장 교범',
  tutorialIntro: '보급선을 만들고 타워를 점령해 전선을 밀어내세요.',
  tutorialRouteTitle: '경로 설정',
  tutorialRouteBody: '내 타워에서 다른 타워까지 드래그하세요. 경로가 열린 동안 출발 타워가 병력을 계속 보냅니다.',
  tutorialCutTitle: '경로 끊기',
  tutorialCutBody: '빈 공간에서 시작해 내 경로를 가로지르도록 스와이프하면 끊을 수 있습니다. 상대 경로는 직접 끊을 수 없습니다.',
  tutorialCaptureTitle: '타워 점령',
  tutorialCaptureBody: '중립 또는 적 타워에 병력을 보내 수비 병력을 모두 줄이면 점령합니다. 아군 타워에 도착한 병력은 재고를 보충합니다.',
  tutorialStockTitle: '병력과 경로 수',
  tutorialStockBody: '나가는 경로가 없는 타워는 병력을 저장합니다. 병력 1 / 10 / 20에서 동시에 연결할 수 있는 경로가 1 / 2 / 3개가 됩니다.',
  tutorialRelayTitle: '병력 60 타워 활용',
  tutorialRelayBody: '병력이 60에 도달하면 발판 링이 흰색이 되고 중계 타워가 됩니다. 도착한 아군 병력은 열린 다음 경로로 이어서 이동합니다.',
  tutorialWinTitle: '승리 조건',
  tutorialWinBody: '상대 세력을 모두 제거하거나 시간 종료 시 더 많은 타워를 점령하면 승리합니다. 타워 수가 같으면 남은 총 전투력으로 결정합니다.',
  gotIt: '확인',
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
  matchingFallbackHint: '12초 이상 매칭되지 않으면 AI와 대결합니다.',
  creatingRoom: '방 코드 생성 중…',
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
  shopTowers: '타워 — 비쌀수록 생산이 빠르다',
  shopUnits: '유닛 — 비쌀수록 체력과 공격력이 높다',
  shopVx: 'VX — 현금 결제',
  vxNotListed: '결제 상품이 아직 등록되지 않았습니다.',
  vxOpenFailed: '결제 창을 열지 못했습니다. 다시 눌러 주세요.',
  equipped: '착용 중',
  equip: '착용하기',
  comingSoon: '준비 중',
  unitStats: (power) => `체력 ${power} · 공격력 ${power}`,
  towerStats: (speed) => `생산 ×${speed.toFixed(2)}`,
  boardTitle: '순위 — 점수순',
  boardLoading: '불러오는 중…',
  boardOffline: '서버에 연결되지 않아 순위를 볼 수 없습니다',
  boardEmpty: '아직 순위에 오른 사람이 없습니다',
  boardRetry: '다시 시도',
  boardMyRank: (rank, total) => `내 순위 ${rank}위 / ${total}명`,
  boardUnranked: '아직 순위에 안 올랐습니다',
  points: (n) => `${n}점`,
  playAgain: '다시 매칭',
  toLobby: '로비로',
  resign: '항복',
  victory: '승리',
  defeat: '패배',
  draw: '무승부',
  resigned: '항복',
  resignNoReward: '항복 — 보상 없음',
  friendNoReward: '친구 대전 — 코인·점수·전적 없음',
  disconnected: '연결 끊김',
  disconnectedNote: '상대와의 연결이 끊겼습니다. 점수와 보상은 그대로입니다.',
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
  recordSection: '전적',
  resetRecord: '전적 초기화',
  resetRecordConfirm: '한 번 더 누르면 초기화',
  resetRecordDone: '전적을 초기화했습니다',
  resetRecordNote: (w, l) => `현재 ${w}승 ${l}패 · 점수는 유지됩니다`,
  followSection: '제작자 응원',
  followReward: (coins) => `제작자를 팔로우하면 ${coins}코인을 드립니다 — 계정당 한 번.`,
  followClaim: '받기',
  followClaimed: '받음',
  followClaiming: '서버에 확인하는 중…',
  followGo: '제작자 팔로우하기',
  followNotYet: '아직 팔로우가 확인되지 않았습니다. 게임 페이지에서 팔로우한 뒤 눌러 주세요.',
  followFailed: '서버에 닿지 못했습니다. 다시 눌러 주세요.',
  volMaster: '전체',
  volSfx: '효과음',
  volBgm: '배경음',
  tempoItem: '배속',
  opponentTempo: (scale) => `상대 배속 · ${scale}×`,
  tempoItemBlurb: '판 전체를 빠르게',
  tempoItemDesc:
    '판에 버튼이 생긴다. 켜면 판이 1.5배로 돈다 — 나만이 아니라 양쪽 다. 상대도 가지고 있고 같이 켜면 2배가 된다.',
  adCard: '광고 보상',
  adCardAction: '보기',
  owned: '보유 중',
  adWatch: (coins) => `광고 보고 +${coins}`,
  adDouble: '광고 보고 두 배 받기',
  rewardDoubled: (gained) => `광고 보상 · +${gained} 추가`,
  adUnavailable: '지금은 볼 광고가 없습니다',
  adFailed: '광고를 끝까지 안 봐서 보상이 없습니다',
  adLimit: '오늘 받을 수 있는 광고를 다 받았습니다',
  adCooldown: '조금 뒤에 다시 시도하세요',
};

// 간체 중국어. 표기는 大陆 간체. 봇 이름도 언어를 따라간다(중국어 화면에 영어/한국어
// 이름이 뜨면 "이건 봇"이 티 난다 — 머리말 참고).
const zh: Strings = {
  tutorial: '游戏教程',
  tutorialTitle: '战场手册',
  tutorialIntro: '建立补给线，占领据点，推进战线。',
  tutorialRouteTitle: '设置路线',
  tutorialRouteBody: '从你的据点拖动到另一个据点。路线开启期间，起点据点会持续派出兵力。',
  tutorialCutTitle: '切断路线',
  tutorialCutBody: '从空白处滑过自己的路线即可切断。无法直接切断对手的路线。',
  tutorialCaptureTitle: '占领据点',
  tutorialCaptureBody: '向中立或敌方据点派出兵力，将其守军减至零即可占领；抵达友方据点的兵力则会补充库存。',
  tutorialStockTitle: '库存与路线数',
  tutorialStockBody: '没有出向路线的据点会储存兵力。库存达到 1 / 10 / 20 时，可同时开启 1 / 2 / 3 条路线。',
  tutorialRelayTitle: '利用满员据点',
  tutorialRelayBody: '兵力达到 60 时，底座光环变白，据点成为中继站。抵达此处的友方兵力会沿其出向路线继续前进。',
  tutorialWinTitle: '取得胜利',
  tutorialWinBody: '消灭对手全部势力，或在时间结束时占领更多据点即可获胜。据点数相同时，由剩余总战力决定。',
  gotIt: '知道了',
  tagline: '划出补给线，推进战线',
  autoMatch: '快速匹配',
  playFriend: '和好友对战',
  shop: '商店',
  ranking: '排行榜',
  settings: '设置',
  nameTitle: '昵称与头像',
  namePlaceholder: '请输入昵称',
  start: '开始',
  nameRequired: (max) => `请输入昵称（最多 ${max} 个字符）`,
  back: '返回',
  pvpTitleAuto: '对战',
  pvpTitleFriend: '和好友对战',
  searching: '正在寻找对手…',
  matchingFallbackHint: '若 12 秒内未匹配到对手，将与 AI 对战。',
  creatingRoom: '正在生成房间号…',
  startingSoon: '即将开始',
  waitingFriend: '正在等待好友…',
  joiningRoom: '正在加入房间…',
  makeRoomOrCode: '创建房间或输入房间号',
  roomCodePlaceholder: '好友房间号',
  join: '加入',
  hostRoom: '创建房间',
  couldNotJoin: '无法加入',
  connectionRefused: '连接被拒绝',
  roomClosed: (reason) => `房间已关闭（${reason}）`,
  shopTowers: '塔 — 越贵产量越快',
  shopUnits: '单位 — 越贵，生命与攻击越高',
  shopVx: 'VX — 现金付费',
  vxNotListed: '该商品尚未上架。',
  vxOpenFailed: '无法打开支付窗口，请再次点击。',
  equipped: '装备中',
  equip: '装备',
  comingSoon: '敬请期待',
  unitStats: (power) => `生命 ${power} · 攻击 ${power}`,
  towerStats: (speed) => `产量 ×${speed.toFixed(2)}`,
  boardTitle: '排行榜 — 按积分',
  boardLoading: '加载中…',
  boardOffline: '未连接服务器，无法查看排行榜',
  boardEmpty: '还没有人登上排行榜',
  boardRetry: '重试',
  boardMyRank: (rank, total) => `我的排名 第${rank}名 / 共${total}人`,
  boardUnranked: '尚未上榜',
  points: (n) => `${n} 分`,
  playAgain: '重新匹配',
  toLobby: '返回大厅',
  resign: '认输',
  victory: '胜利',
  defeat: '失败',
  draw: '平局',
  resigned: '认输',
  resignNoReward: '认输 — 无奖励',
  friendNoReward: '好友对战 — 无金币、积分与战绩',
  disconnected: '连接中断',
  disconnectedNote: '与对手的连接已中断。分数和奖励均不变。',
  rewardLine: (total, base, towers, bonus) =>
    `+${total}  （基础 ${base} · 据点 ${towers} 个 ${bonus}）`,
  ratingLine: (before, after, sign, diff) => `积分 ${before} → ${after}  （${sign}${diff}）`,
  hint: '拖动：开启/关闭路线  ·  空白处滑动：切断路线',
  waitingPeer: '正在等待对手',
  record: (w, l) => `${w}胜 ${l}负`,
  unitLabels: {
    beergang: '啤酒帮',
    beergang_white: '白啤酒帮',
    beergang_gold: '金啤酒帮',
    beergang_green: '绿啤酒帮',
    beergang_purple: '紫啤酒帮',
    beergang_rainbow: '彩虹啤酒帮',
  },
  unitBlurbs: {
    beergang: '初始',
    beergang_white: '白色下装',
    beergang_gold: '金色下装',
    beergang_green: '绿色下装',
    beergang_purple: '紫色下装',
    beergang_rainbow: 'VX 专属 · 最强',
  },
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
  profileNames: {
    slate: '灰',
    blue: '蓝',
    cyan: '青',
    green: '绿',
    gold: '金',
    orange: '橙',
    red: '红',
    purple: '紫',
    pink: '粉',
  },
  botHead: [
    '黑', '蓝', '红', '静', '疾', '迟', '小', '巨',
    '孤', '怒', '闲', '寒', '炎', '灰',
  ],
  // 꼬리 첫 글자가 머리 글자(寒·疾·孤 등)와 겹치면 `寒寒鸦` 처럼 중복되므로 피했다.
  botTail: [
    '骑士', '苍狼', '玄鸦', '铁盾', '长枪', '追风', '暮色', '霜寒',
    '战锤', '赤狐', '北风', '夜灯', '流沙', '碧波',
  ],
  botJoin: (head, tail, tag) => `${head}${tail}${tag}`,
  language: '语言',
  sound: '声音',
  recordSection: '战绩',
  resetRecord: '重置战绩',
  resetRecordConfirm: '再次点击以重置',
  resetRecordDone: '战绩已重置',
  resetRecordNote: (w, l) => `当前 ${w}胜 ${l}负 · 积分保留`,
  followSection: '支持创作者',
  followReward: (coins) => `关注创作者可获得 ${coins} 金币 — 每个账号一次。`,
  followClaim: '领取',
  followClaimed: '已领取',
  followClaiming: '正在向服务器确认…',
  followGo: '关注创作者',
  followNotYet: '尚未确认关注。请在游戏页面关注后再点击。',
  followFailed: '无法连接服务器。请再试一次。',
  volMaster: '总音量',
  volSfx: '音效',
  volBgm: '音乐',
  tempoItem: '加速',
  opponentTempo: (scale) => `对手加速 · ${scale}×`,
  tempoItemBlurb: '让整局对战加速',
  tempoItemDesc:
    '对战中会出现一个按钮。开启后，整局以 1.5 倍速运行 —— 不只是你，而是双方都加速。若对手也拥有并一同开启，则变为 2 倍速。',
  adCard: '广告奖励',
  adCardAction: '观看',
  owned: '已拥有',
  adWatch: (coins) => `观看广告 · +${coins}`,
  adDouble: '观看广告 —— 奖励翻倍',
  rewardDoubled: (gained) => `广告奖励 · 追加 +${gained}`,
  adUnavailable: '当前没有可观看的广告',
  adFailed: '广告未看完，无法获得奖励',
  adLimit: '今日广告奖励已全部领取',
  adCooldown: '请稍后再试',
};

/**
 * 베트남어.
 *
 * **`botJoin` 만 순서가 다르다.** 베트남어는 수식어가 명사 뒤에 오므로 `head`(수식어) 를
 * 뒤에 붙인다 — 다른 언어처럼 `${head}${tail}` 로 쓰면 `ĐenSói` 같은 말이 안 되는 이름이
 * 나온다. 낱말 목록의 뜻(머리=수식어, 꼬리=명사)은 그대로 두고 붙이는 순서만 뒤집었다.
 */
const vi: Strings = {
  tagline: 'Vẽ tuyến tiếp tế. Đẩy lùi chiến tuyến.',
  autoMatch: 'Đấu nhanh',
  playFriend: 'Đấu với bạn bè',
  shop: 'Cửa hàng',
  ranking: 'Bảng xếp hạng',
  tutorial: 'Cách chơi',
  tutorialTitle: 'Sổ tay chiến trường',
  tutorialIntro: 'Dựng tuyến tiếp tế, chiếm tháp và đẩy lùi chiến tuyến.',
  tutorialRouteTitle: 'Mở tuyến đường',
  tutorialRouteBody: 'Kéo từ một tháp của bạn sang tháp khác. Tháp nguồn sẽ liên tục gửi quân khi tuyến còn mở.',
  tutorialCutTitle: 'Cắt tuyến của bạn',
  tutorialCutBody: 'Vuốt từ khoảng trống ngang qua tuyến của chính bạn để đóng nó. Không thể cắt trực tiếp tuyến của đối thủ.',
  tutorialCaptureTitle: 'Chiếm tháp',
  tutorialCaptureBody: 'Gửi quân vào tháp trung lập hoặc tháp địch. Hạ quân phòng thủ về 0 để chiếm; quân đến tháp đồng minh thì tăng viện cho tháp đó.',
  tutorialStockTitle: 'Quân dự trữ và số tuyến',
  tutorialStockBody: 'Tháp không có tuyến đi ra sẽ tích quân. Dự trữ 1 / 10 / 20 mở khóa 1 / 2 / 3 tuyến cùng lúc.',
  tutorialRelayTitle: 'Dùng tháp đầy',
  tutorialRelayBody: 'Ở mức 60 quân, vòng chân tháp chuyển sang trắng và tháp trở thành trạm trung chuyển. Quân đồng minh đến đây sẽ đi tiếp theo các tuyến ra của nó.',
  tutorialWinTitle: 'Giành chiến tuyến',
  tutorialWinBody: 'Tiêu diệt toàn bộ quân địch, hoặc giữ nhiều tháp hơn khi hết giờ. Nếu hòa, tổng lực lượng còn lại sẽ quyết định.',
  gotIt: 'Đã hiểu',
  settings: 'Cài đặt',
  nameTitle: 'Tên và ảnh đại diện',
  namePlaceholder: 'Nhập tên của bạn',
  start: 'Bắt đầu',
  nameRequired: (max) => `Hãy nhập tên (tối đa ${max} ký tự)`,
  back: 'Quay lại',
  pvpTitleAuto: 'Trận đấu',
  pvpTitleFriend: 'Đấu với bạn bè',
  searching: 'Đang tìm đối thủ…',
  matchingFallbackHint: 'Nếu không tìm được đối thủ trong 12 giây, bạn sẽ đấu với AI.',
  creatingRoom: 'Đang tạo mã phòng…',
  startingSoon: 'Sắp bắt đầu',
  waitingFriend: 'Đang chờ bạn bè…',
  joiningRoom: 'Đang vào phòng…',
  makeRoomOrCode: 'Tạo phòng hoặc nhập mã',
  roomCodePlaceholder: 'Mã phòng',
  join: 'Vào phòng',
  hostRoom: 'Tạo phòng',
  couldNotJoin: 'Không vào được',
  connectionRefused: 'Kết nối bị từ chối',
  roomClosed: (reason) => `Phòng đã đóng (${reason})`,
  shopTowers: 'Tháp — càng đắt càng sản xuất nhanh',
  shopUnits: 'Quân — càng đắt thì máu và sát thương càng cao',
  shopVx: 'VX — Tiền thật',
  vxNotListed: 'Vật phẩm này chưa được mở bán.',
  vxOpenFailed: 'Không mở được cửa hàng. Hãy chạm lại.',
  equipped: 'Đang dùng',
  equip: 'Trang bị',
  comingSoon: 'Sắp có',
  unitStats: (power) => `Máu ${power} · Sát thương ${power}`,
  towerStats: (speed) => `Sản xuất ×${speed.toFixed(2)}`,
  boardTitle: 'Bảng xếp hạng — theo điểm',
  boardLoading: 'Đang tải…',
  boardOffline: 'Chưa kết nối nên không xem được bảng xếp hạng',
  boardEmpty: 'Chưa có ai lên bảng xếp hạng',
  boardRetry: 'Thử lại',
  boardMyRank: (rank, total) => `Hạng của bạn #${rank} / ${total}`,
  boardUnranked: 'Chưa có hạng',
  points: (n) => `${n} điểm`,
  playAgain: 'Tìm trận',
  toLobby: 'Sảnh chờ',
  resign: 'Đầu hàng',
  victory: 'Chiến thắng',
  defeat: 'Thất bại',
  draw: 'Hòa',
  resigned: 'Đã đầu hàng',
  resignNoReward: 'Đã đầu hàng — không có thưởng',
  friendNoReward: 'Đấu với bạn — không có xu, điểm hay thành tích',
  disconnected: 'Mất kết nối',
  disconnectedNote: 'Đã mất kết nối với đối thủ. Điểm và phần thưởng không thay đổi.',
  rewardLine: (total, base, towers, bonus) =>
    `+${total}  (cơ bản ${base} · ${towers} tháp ${bonus})`,
  ratingLine: (before, after, sign, diff) => `Điểm ${before} → ${after}  (${sign}${diff})`,
  hint: 'Kéo: mở/đóng tuyến  ·  Vuốt chỗ trống: cắt tuyến',
  waitingPeer: 'Đang chờ đối thủ',
  record: (w, l) => `${w} thắng ${l} thua`,
  unitLabels: {
    beergang: 'Beergang',
    beergang_white: 'Beergang Trắng',
    beergang_gold: 'Beergang Vàng',
    beergang_green: 'Beergang Xanh Lá',
    beergang_purple: 'Beergang Tím',
    beergang_rainbow: 'Beergang Cầu Vồng',
  },
  unitBlurbs: {
    beergang: 'Khởi đầu',
    beergang_white: 'Quần trắng',
    beergang_gold: 'Quần vàng',
    beergang_green: 'Quần xanh lá',
    beergang_purple: 'Quần tím',
    beergang_rainbow: 'Chỉ có ở VX · mạnh nhất',
  },
  towerLabels: {
    tower_hut: 'Lều',
    tower_house: 'Nhà',
    tower_barracks: 'Doanh trại',
    tower_keep: 'Pháo đài',
    tower_citadel: 'Thành trì',
    tower_prime: 'Thành Vương',
  },
  towerBlurbs: {
    tower_hut: 'Tháp mà ai cũng bắt đầu với nó.',
    tower_house: 'Rộng hơn một chút, sản lượng nhiều hơn một chút.',
    tower_barracks: 'Dựng lên để quân đi liên tục.',
    tower_keep: 'Tường đá, tiếp tế đều đặn.',
    tower_citadel: 'Tháp nhanh nhất mà tiền xu mua được.',
    tower_prime: 'Nhanh nhất. Chỉ có ở VX.',
  },
  profileNames: {
    slate: 'Xám',
    blue: 'Xanh Dương',
    cyan: 'Xanh Ngọc',
    green: 'Xanh Lá',
    gold: 'Vàng Kim',
    orange: 'Cam',
    red: 'Đỏ',
    purple: 'Tím',
    pink: 'Hồng',
  },
  botHead: [
    'Đen', 'Xanh', 'Đỏ', 'Lặng', 'Nhanh', 'Muộn', 'Nhỏ', 'Lớn',
    'Cô Độc', 'Giận Dữ', 'Thong Dong', 'Lạnh', 'Nóng', 'Xám',
  ],
  botTail: [
    'Hiệp Sĩ', 'Sói', 'Quạ', 'Khiên', 'Giáo', 'Gió', 'Hoàng Hôn', 'Sương Giá',
    'Búa', 'Cáo', 'Bắc Phong', 'Đèn Lồng', 'Cát', 'Sóng',
  ],
  // 수식어가 뒤로 간다 (이 표 머리말).
  botJoin: (head, tail, tag) => `${tail}${head}${tag}`,
  language: 'Ngôn ngữ',
  sound: 'Âm thanh',
  recordSection: 'Thành tích',
  resetRecord: 'Xóa thành tích',
  resetRecordConfirm: 'Chạm lần nữa để xóa',
  resetRecordDone: 'Đã xóa thành tích',
  resetRecordNote: (w, l) => `Hiện tại ${w} thắng ${l} thua · điểm được giữ nguyên`,
  followSection: 'Ủng hộ nhà phát triển',
  followReward: (coins) => `Theo dõi nhà phát triển để nhận ${coins} xu — mỗi tài khoản một lần.`,
  followClaim: 'Nhận',
  followClaimed: 'Đã nhận',
  followClaiming: 'Đang kiểm tra với máy chủ…',
  followGo: 'Theo dõi nhà phát triển',
  followNotYet: 'Chưa xác nhận được lượt theo dõi. Hãy theo dõi ở trang trò chơi rồi chạm Nhận.',
  followFailed: 'Không kết nối được máy chủ. Hãy chạm lại.',
  volMaster: 'Tổng',
  volSfx: 'Hiệu ứng',
  volBgm: 'Nhạc nền',
  tempoItem: 'Tăng tốc',
  opponentTempo: (scale) => `Đối thủ tăng tốc · ${scale}×`,
  tempoItemBlurb: 'Tăng tốc cả trận đấu',
  tempoItemDesc:
    'Một nút sẽ hiện ra trong trận. Bật lên thì cả trận chạy ở tốc độ 1.5× cho CẢ HAI bên, không riêng bạn. Nếu đối thủ cũng có và cùng bật, tốc độ thành 2×.',
  adCard: 'Thưởng quảng cáo',
  adCardAction: 'Xem',
  owned: 'Đã sở hữu',
  adWatch: (coins) => `Xem quảng cáo · +${coins}`,
  adDouble: 'Xem quảng cáo — nhân đôi',
  rewardDoubled: (gained) => `Thưởng quảng cáo · +${gained} thêm`,
  adUnavailable: 'Hiện chưa có quảng cáo nào',
  adFailed: 'Chưa xem hết quảng cáo nên không có thưởng',
  adLimit: 'Bạn đã nhận hết quảng cáo hôm nay',
  adCooldown: 'Hãy thử lại sau giây lát',
};

// 일본어. 봇 이름도 언어를 따라간다 (머리말 참고).
const ja: Strings = {
  tagline: '補給線を引き、戦線を押し上げろ。',
  autoMatch: 'クイックマッチ',
  playFriend: 'フレンド対戦',
  shop: 'ショップ',
  ranking: 'ランキング',
  tutorial: '遊び方',
  tutorialTitle: 'フィールドマニュアル',
  tutorialIntro: '補給線を築き、拠点を奪い、戦線を押し上げる。',
  tutorialRouteTitle: 'ルートを引く',
  tutorialRouteBody: '自分の拠点から別の拠点へドラッグする。ルートが開いている間、出発点の拠点は兵を送り続ける。',
  tutorialCutTitle: 'ルートを切る',
  tutorialCutBody: '空白から自分のルートを横切るようにスワイプすると切れる。相手のルートは直接切れない。',
  tutorialCaptureTitle: '拠点を奪う',
  tutorialCaptureBody: '中立や敵の拠点に兵を送り、守備兵を 0 にすると占領できる。味方の拠点に着いた兵は在庫になる。',
  tutorialStockTitle: '在庫とルート枠',
  tutorialStockBody: '出ていくルートがない拠点は兵を貯める。在庫 1 / 10 / 20 で、同時に 1 / 2 / 3 本のルートを開ける。',
  tutorialRelayTitle: '満杯の拠点を使う',
  tutorialRelayBody: '兵が 60 になると土台のリングが白くなり、拠点が中継点になる。そこに着いた味方の兵は、出ていくルートへそのまま進む。',
  tutorialWinTitle: '戦線を制する',
  tutorialWinBody: '相手を全滅させるか、時間切れの時点で拠点を多く持っていれば勝ち。同数なら残り戦力の合計で決まる。',
  gotIt: 'わかった',
  settings: '設定',
  nameTitle: '名前とアバター',
  namePlaceholder: '名前を入力',
  start: 'はじめる',
  nameRequired: (max) => `名前を入力してください（${max}文字まで）`,
  back: '戻る',
  pvpTitleAuto: '対戦',
  pvpTitleFriend: 'フレンド対戦',
  searching: '対戦相手を探しています…',
  matchingFallbackHint: '12 秒以内に相手が見つからない場合は AI と対戦します。',
  creatingRoom: 'ルームコードを作成中…',
  startingSoon: 'まもなく開始',
  waitingFriend: 'フレンドを待っています…',
  joiningRoom: 'ルームに参加中…',
  makeRoomOrCode: 'ルームを作るか、コードを入力',
  roomCodePlaceholder: 'ルームコード',
  join: '参加',
  hostRoom: 'ルームを作る',
  couldNotJoin: '参加できませんでした',
  connectionRefused: '接続が拒否されました',
  roomClosed: (reason) => `ルームが閉じました（${reason}）`,
  shopTowers: 'タワー — 高いほど生産が速い',
  shopUnits: 'ユニット — 高いほど体力と攻撃が高い',
  shopVx: 'VX — 有料',
  vxNotListed: 'この商品はまだ販売されていません。',
  vxOpenFailed: '購入画面を開けませんでした。もう一度タップしてください。',
  equipped: '装備中',
  equip: '装備する',
  comingSoon: '近日公開',
  unitStats: (power) => `体力 ${power} · 攻撃 ${power}`,
  towerStats: (speed) => `生産 ×${speed.toFixed(2)}`,
  boardTitle: 'ランキング — スコア順',
  boardLoading: '読み込み中…',
  boardOffline: 'サーバーに接続できないためランキングを表示できません',
  boardEmpty: 'まだランキングに載った人がいません',
  boardRetry: '再試行',
  // 짧게 쓴다. 하단 내 순위 줄은 이 글귀·아바타·이름·점수가 한 줄에 들어가야 한다.
  boardMyRank: (rank, total) => `順位 ${rank}位 / ${total}人`,
  boardUnranked: 'まだランキング外です',
  points: (n) => `${n}点`,
  // 결과 화면에서 [ロビーへ] 와 가로로 나란히 선다(`.menu-row`, 320px). 길면 두 줄이
  // 되어 버튼 높이가 서로 어긋난다 — 'もう一度マッチング' 는 그 폭을 거의 다 먹었다.
  playAgain: '再マッチング',
  toLobby: 'ロビーへ',
  resign: '降参',
  victory: '勝利',
  defeat: '敗北',
  draw: '引き分け',
  resigned: '降参',
  resignNoReward: '降参 — 報酬なし',
  friendNoReward: 'フレンド対戦 — コイン・スコア・戦績なし',
  disconnected: '接続が切れました',
  disconnectedNote: '相手との接続が切れました。スコアと報酬は変わりません。',
  rewardLine: (total, base, towers, bonus) =>
    `+${total}  （基本 ${base} · 拠点 ${towers} 個 ${bonus}）`,
  ratingLine: (before, after, sign, diff) => `スコア ${before} → ${after}  （${sign}${diff}）`,
  hint: 'ドラッグ：ルートの開閉  ·  空白をスワイプ：ルートを切る',
  waitingPeer: '相手を待っています',
  record: (w, l) => `${w}勝 ${l}敗`,
  unitLabels: {
    beergang: 'ビアギャング',
    beergang_white: '白ビアギャング',
    beergang_gold: '金ビアギャング',
    beergang_green: '緑ビアギャング',
    beergang_purple: '紫ビアギャング',
    beergang_rainbow: '虹ビアギャング',
  },
  unitBlurbs: {
    beergang: '初期',
    beergang_white: '白いパンツ',
    beergang_gold: '金のパンツ',
    beergang_green: '緑のパンツ',
    beergang_purple: '紫のパンツ',
    beergang_rainbow: 'VX 限定 · 最強',
  },
  towerLabels: {
    tower_hut: '小屋',
    tower_house: '家',
    tower_barracks: '兵舎',
    tower_keep: '石塔',
    tower_citadel: '城塞',
    tower_prime: '王城',
  },
  towerBlurbs: {
    tower_hut: '誰もがここから始める。',
    tower_house: '少し広く、少し多く出せる。',
    tower_barracks: '兵を出し続けるための建物。',
    tower_keep: '石の壁と安定した補給。',
    tower_citadel: 'コインで買える最速のタワー。',
    tower_prime: '最速のタワー。VX 限定。',
  },
  profileNames: {
    slate: 'グレー',
    blue: 'ブルー',
    cyan: 'シアン',
    green: 'グリーン',
    gold: 'ゴールド',
    orange: 'オレンジ',
    red: 'レッド',
    purple: 'パープル',
    pink: 'ピンク',
  },
  botHead: [
    '黒', '蒼', '紅', '静', '疾', '遅', '小', '大',
    '孤', '怒', '悠', '寒', '炎', '灰',
  ],
  // 꼬리 첫 글자가 머리 글자(寒·炎 등)와 겹치면 `寒寒霜` 처럼 겹쳐 보이므로 피했다.
  botTail: [
    '騎士', '狼', '鴉', '盾', '槍', '疾風', '黄昏', '霜',
    '鎚', '狐', '北風', '灯', '流砂', '波',
  ],
  botJoin: (head, tail, tag) => `${head}${tail}${tag}`,
  language: '言語',
  sound: 'サウンド',
  recordSection: '戦績',
  resetRecord: '戦績をリセット',
  resetRecordConfirm: 'もう一度タップでリセット',
  resetRecordDone: '戦績をリセットしました',
  resetRecordNote: (w, l) => `現在 ${w}勝 ${l}敗 · スコアは保持されます`,
  followSection: 'クリエイターを応援',
  followReward: (coins) => `クリエイターをフォローすると ${coins} コイン — 1 アカウント 1 回。`,
  followClaim: '受け取る',
  followClaimed: '受取済み',
  followClaiming: 'サーバーに確認中…',
  followGo: 'クリエイターをフォロー',
  followNotYet: 'フォローがまだ確認できません。ゲームページでフォローしてからタップしてください。',
  followFailed: 'サーバーに接続できませんでした。もう一度タップしてください。',
  volMaster: '全体',
  volSfx: '効果音',
  volBgm: '音楽',
  tempoItem: 'スピードブースト',
  opponentTempo: (scale) => `相手のブースト · ${scale}×`,
  tempoItemBlurb: '対戦全体を加速する',
  tempoItemDesc:
    '対戦中にボタンが出る。オンにすると自分だけでなく両者とも 1.5 倍速になる。相手も持っていて一緒にオンにすると 2 倍速になる。',
  adCard: '広告報酬',
  adCardAction: '見る',
  owned: '所持済み',
  adWatch: (coins) => `広告を見て +${coins}`,
  adDouble: '広告を見て 2 倍にする',
  rewardDoubled: (gained) => `広告報酬 · +${gained} 追加`,
  adUnavailable: '今は見られる広告がありません',
  adFailed: '広告を最後まで見なかったため報酬はありません',
  adLimit: '今日受け取れる広告はすべて受け取りました',
  adCooldown: '少し待ってからもう一度お試しください',
};

// 번체 중국어(대만 표기). 간체와 글자만 다른 것이 아니라 낱말도 갈린다 —
// 服务器→伺服器, 关注→追蹤, 匹配→配對, 设置→設定 처럼 옮겼다.
const zhHant: Strings = {
  tutorial: '遊戲教學',
  tutorialTitle: '戰場手冊',
  tutorialIntro: '建立補給線，佔領據點，推進戰線。',
  tutorialRouteTitle: '設定路線',
  tutorialRouteBody: '從你的據點拖曳到另一個據點。路線開啟期間，起點據點會持續派出兵力。',
  tutorialCutTitle: '切斷路線',
  tutorialCutBody: '從空白處滑過自己的路線即可切斷。無法直接切斷對手的路線。',
  tutorialCaptureTitle: '佔領據點',
  tutorialCaptureBody: '向中立或敵方據點派出兵力，將其守軍減至零即可佔領；抵達友方據點的兵力則會補充庫存。',
  tutorialStockTitle: '庫存與路線數',
  tutorialStockBody: '沒有出向路線的據點會儲存兵力。庫存達到 1 / 10 / 20 時，可同時開啟 1 / 2 / 3 條路線。',
  tutorialRelayTitle: '利用滿員據點',
  tutorialRelayBody: '兵力達到 60 時，底座光環變白，據點成為中繼站。抵達此處的友方兵力會沿其出向路線繼續前進。',
  tutorialWinTitle: '取得勝利',
  tutorialWinBody: '消滅對手全部勢力，或在時間結束時佔領更多據點即可獲勝。據點數相同時，由剩餘總戰力決定。',
  gotIt: '知道了',
  tagline: '劃出補給線，推進戰線',
  autoMatch: '快速配對',
  playFriend: '和好友對戰',
  shop: '商店',
  ranking: '排行榜',
  settings: '設定',
  nameTitle: '暱稱與頭像',
  namePlaceholder: '請輸入暱稱',
  start: '開始',
  nameRequired: (max) => `請輸入暱稱（最多 ${max} 個字元）`,
  back: '返回',
  pvpTitleAuto: '對戰',
  pvpTitleFriend: '和好友對戰',
  searching: '正在尋找對手…',
  matchingFallbackHint: '若 12 秒內未配對到對手，將與 AI 對戰。',
  creatingRoom: '正在產生房間代碼…',
  startingSoon: '即將開始',
  waitingFriend: '正在等待好友…',
  joiningRoom: '正在加入房間…',
  makeRoomOrCode: '建立房間或輸入房間代碼',
  roomCodePlaceholder: '好友房間代碼',
  join: '加入',
  hostRoom: '建立房間',
  couldNotJoin: '無法加入',
  connectionRefused: '連線遭拒',
  roomClosed: (reason) => `房間已關閉（${reason}）`,
  shopTowers: '塔 — 越貴產量越快',
  shopUnits: '單位 — 越貴，生命與攻擊越高',
  shopVx: 'VX — 現金付費',
  vxNotListed: '該商品尚未上架。',
  vxOpenFailed: '無法開啟付款視窗，請再次點擊。',
  equipped: '裝備中',
  equip: '裝備',
  comingSoon: '敬請期待',
  unitStats: (power) => `生命 ${power} · 攻擊 ${power}`,
  towerStats: (speed) => `產量 ×${speed.toFixed(2)}`,
  boardTitle: '排行榜 — 依積分',
  boardLoading: '載入中…',
  boardOffline: '未連線伺服器，無法查看排行榜',
  boardEmpty: '還沒有人登上排行榜',
  boardRetry: '重試',
  boardMyRank: (rank, total) => `我的排名 第${rank}名 / 共${total}人`,
  boardUnranked: '尚未上榜',
  points: (n) => `${n} 分`,
  playAgain: '重新配對',
  toLobby: '返回大廳',
  resign: '認輸',
  victory: '勝利',
  defeat: '失敗',
  draw: '平手',
  resigned: '認輸',
  resignNoReward: '認輸 — 無獎勵',
  friendNoReward: '好友對戰 — 無金幣、積分與戰績',
  disconnected: '連線中斷',
  disconnectedNote: '與對手的連線已中斷。分數和獎勵均不變。',
  rewardLine: (total, base, towers, bonus) =>
    `+${total}  （基礎 ${base} · 據點 ${towers} 個 ${bonus}）`,
  ratingLine: (before, after, sign, diff) => `積分 ${before} → ${after}  （${sign}${diff}）`,
  hint: '拖曳：開啟/關閉路線  ·  空白處滑動：切斷路線',
  waitingPeer: '正在等待對手',
  record: (w, l) => `${w}勝 ${l}敗`,
  unitLabels: {
    beergang: '啤酒幫',
    beergang_white: '白啤酒幫',
    beergang_gold: '金啤酒幫',
    beergang_green: '綠啤酒幫',
    beergang_purple: '紫啤酒幫',
    beergang_rainbow: '彩虹啤酒幫',
  },
  unitBlurbs: {
    beergang: '初始',
    beergang_white: '白色褲裝',
    beergang_gold: '金色褲裝',
    beergang_green: '綠色褲裝',
    beergang_purple: '紫色褲裝',
    beergang_rainbow: 'VX 專屬 · 最強',
  },
  towerLabels: {
    tower_hut: '小屋',
    tower_house: '房屋',
    tower_barracks: '兵營',
    tower_keep: '石塔',
    tower_citadel: '城堡',
    tower_prime: '王城',
  },
  towerBlurbs: {
    tower_hut: '所有人的起點。',
    tower_house: '空間大一點，產量多一點。',
    tower_barracks: '為持續出兵而建。',
    tower_keep: '石牆與穩定補給。',
    tower_citadel: '金幣能買到的最快塔。',
    tower_prime: '最快的塔。僅限 VX。',
  },
  profileNames: {
    slate: '灰',
    blue: '藍',
    cyan: '青',
    green: '綠',
    gold: '金',
    orange: '橙',
    red: '紅',
    purple: '紫',
    pink: '粉',
  },
  botHead: [
    '黑', '藍', '紅', '靜', '疾', '遲', '小', '巨',
    '孤', '怒', '閒', '寒', '炎', '灰',
  ],
  botTail: [
    '騎士', '蒼狼', '玄鴉', '鐵盾', '長槍', '追風', '暮色', '霜寒',
    '戰鎚', '赤狐', '北風', '夜燈', '流沙', '碧波',
  ],
  botJoin: (head, tail, tag) => `${head}${tail}${tag}`,
  language: '語言',
  sound: '聲音',
  recordSection: '戰績',
  resetRecord: '重設戰績',
  resetRecordConfirm: '再次點擊以重設',
  resetRecordDone: '戰績已重設',
  resetRecordNote: (w, l) => `目前 ${w}勝 ${l}敗 · 積分保留`,
  followSection: '支持創作者',
  followReward: (coins) => `追蹤創作者可獲得 ${coins} 金幣 — 每個帳號一次。`,
  followClaim: '領取',
  followClaimed: '已領取',
  followClaiming: '正在向伺服器確認…',
  followGo: '追蹤創作者',
  followNotYet: '尚未確認追蹤。請在遊戲頁面追蹤後再點擊。',
  followFailed: '無法連線伺服器。請再試一次。',
  volMaster: '總音量',
  volSfx: '音效',
  volBgm: '音樂',
  tempoItem: '加速',
  opponentTempo: (scale) => `對手加速 · ${scale}×`,
  tempoItemBlurb: '讓整局對戰加速',
  tempoItemDesc:
    '對戰中會出現一個按鈕。開啟後，整局以 1.5 倍速運行 —— 不只是你，而是雙方都加速。若對手也擁有並一同開啟，則變為 2 倍速。',
  adCard: '廣告獎勵',
  adCardAction: '觀看',
  owned: '已擁有',
  adWatch: (coins) => `觀看廣告 · +${coins}`,
  adDouble: '觀看廣告 —— 獎勵加倍',
  rewardDoubled: (gained) => `廣告獎勵 · 追加 +${gained}`,
  adUnavailable: '目前沒有可觀看的廣告',
  adFailed: '廣告未看完，無法獲得獎勵',
  adLimit: '今日廣告獎勵已全部領取',
  adCooldown: '請稍後再試',
};

const TABLE: Record<Lang, Strings> = { en, ko, ja, zh, 'zh-Hant': zhHant, vi };

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
