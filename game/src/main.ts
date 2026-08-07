/**
 * 부트스트랩 + 씬 전환.
 *
 * 앱 전체에서 rAF 루프는 여기 하나뿐이고, 매 프레임 현재 씬의 frame만 부른다.
 * 매치의 고정 타임스텝 루프는 MatchScene 안에 있다.
 */
import './style.css';
import { towerKindOf, unitKindOf, type Reward } from './account/account';
import { AccountStore, type RatingChange } from './account/store';
import { matchModsFor } from './app/difficulty';
import { BoardScene } from './app/board-scene';
import { LobbyScene } from './app/lobby-scene';
import { MatchScene } from './app/match-scene';
import { NameScene } from './app/name-scene';
import type { MatchPlan, Scene } from './app/scene';
import { PvpScene } from './app/pvp-scene';
import { SettingsScene } from './app/settings-scene';
import { ShopScene } from './app/shop-scene';
import { Agent8Client } from './net/agent8';
import { audio, installAudioUnlock } from './audio';
import { devAdProvider, setAdProvider, verse8AdProvider } from './net/ads';
import { buyVxItem, initVxShop, watchVxShop, type PremiumItem } from './net/vx';
import { applyStaticText, getLang, setLang } from './i18n';
import { Renderer } from './render/renderer';
import type { UnitKind } from './units';

function need<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id}를 찾을 수 없습니다`);
  return el as T;
}

// 화면을 만들기 **전에** 언어를 확정하고 정적 문자열을 칠한다. 씬 생성자가 DOM에서
// 글자를 읽어 가는 곳이 있어(버튼 제목 등) 순서가 뒤집히면 영어 기본값이 남는다.
setLang(getLang());
applyStaticText();

const canvas = need<HTMLCanvasElement>('stage');

// Renderer는 앱 수명 동안 하나만 만든다. 매치마다 새로 만들면 스프라이트 27장을
// 매번 다시 로드하고 색칠 캐시도 버려진다.
const renderer = new Renderer(canvas);

// 접속은 앱 수명 동안 하나만. 매칭용과 계정용을 따로 만들면 서버가 보는 계정과
// 화면이 보는 계정이 갈릴 수 있다.
const net = new Agent8Client();

// 계정은 앱이 들고 씬은 콜백으로만 건드린다. 온라인이면 서버가 진짜이고
// localStorage는 사본이다 — 그 분기는 전부 AccountStore 안에 있다.
const store = new AccountStore();

function grantReward(reward: Reward, winnerSlot: number): Promise<RatingChange | null> {
  const serverRoom = plan.mode === 'pvp' || plan.serverRoom;
  return store.grantReward(reward, winnerSlot, serverRoom);
}

/**
 * 유료 상점(Verse8 CrossRamp)을 새 탭으로 연다.
 *
 * **주소를 받아 오는 것이 비동기라 팝업 차단에 걸릴 수 있다** — 사용자가 누른 제스처와
 * 실제로 창을 여는 시점이 갈라지기 때문이다. 못 열면 `false` 를 돌려주고, 화면이
 * "다시 눌러 주세요"를 말한다.
 */
async function openVxShop(item: PremiumItem): Promise<boolean> {
  return buyVxItem(item);
}

/** 안 가진 생김새면 사고, 가진 것이면 착용한다. 둘 다 못 하면 아무 일도 안 일어난다. */
function pickUnit(kind: UnitKind): void {
  void store.pickUnit(kind).then(() => {
    audio.play('purchase');
    shop.refresh();
  });
}

let nameScene: NameScene;

const lobby = new LobbyScene(
  need('lobby'),
  () => store.current,
  () => {
    pvp.setMode('auto');
    switchTo(pvp);
  },
  () => {
    pvp.setMode('friend');
    switchTo(pvp);
  },
  () => switchTo(shop),
  () => switchTo(board),
  () => switchTo(settings),
  () => switchTo(nameScene),
);
const settings = new SettingsScene(
  need('settings'),
  // 언어가 바뀌면 지금 화면을 다시 읽게 한다. 씬들이 값을 `enter()` 에서 읽으므로
  // 다시 부르는 것으로 충분하다 — 새로고침은 매칭·상점 상태를 날린다.
  () => current?.enter(),
  () => switchTo(lobby),
  // 전적(승/패)만 초기화. 점수·코인은 store 가 유지한다. 로비로 돌아가면
  // lobby.enter() 가 계정을 다시 읽어 0승 0패를 보여준다.
  () => store.resetRecord(),
  () => ({ wins: store.current.wins, losses: store.current.losses }),
);
const board = new BoardScene(
  need('board'),
  () => store.leaderboard(),
  () => switchTo(lobby),
);
const pvp = new PvpScene(
  need('pvp'),
  (setup, transport) => {
    plan = { mode: 'pvp', setup, transport };
    switchTo(match);
  },
  // 상대를 못 구했다. 화면상으로는 PVP와 구분되지 않는다 (app/pvp-scene.ts 참고).
  // 시드가 있으면 서버가 연 방이라 보상을 서버가 준다.
  (seed, towerKind) => {
    plan = { mode: 'pve', seed, serverRoom: seed !== undefined, towerKind };
    switchTo(match);
  },
  () => switchTo(lobby),
  net,
);
const shop = new ShopScene(
  need('shop'),
  () => store.current,
  pickUnit,
  openVxShop,
  () => store.watchAdForCoins(),
  () => switchTo(lobby),
);
nameScene = new NameScene(
  need('name'),
  (name, profile) => store.setName(name, profile),
  () => switchTo(lobby),
  () => ({ name: store.current.name, profile: store.current.profile }),
);
const match = new MatchScene(
  canvas,
  renderer,
  need('result'),
  need('result-title'),
  need('result-reward'),
  need('result-rating'),
  grantReward,
  () => switchTo(lobby),
  // [다시 매칭] — 로비를 거치지 않고 곧바로 자동 매칭으로 돌아간다.
  // 봇전이었어도 상대를 다시 찾는다 (없으면 §-7대로 조용히 또 봇으로 떨어진다).
  () => {
    pvp.setMode('auto');
    switchTo(pvp);
  },
  () => matchModsFor(store.current),
  () => unitKindOf(store.current),
  () => towerKindOf(store.current),
  () => store.current.name,
  () => store.current.profile,
  () => store.current.rating,
  () => plan,
  need<HTMLButtonElement>('btn-resign'),
  need<HTMLButtonElement>('btn-tempo'),
  need<HTMLElement>('tempo-status'),
  need<HTMLButtonElement>('btn-ad-double'),
  () => store.watchAdForDouble(),
);

/**
 * 다음 판의 조건. 매칭 화면이 결과에 따라 바꿔 넣는다.
 * 기본값이 `serverRoom: false` 인 것은 서버 없이 시작한 판을 뜻한다.
 */
let plan: MatchPlan = { mode: 'pve', serverRoom: false };

let current: Scene | null = null;

function switchTo(next: Scene): void {
  if (current === next) return; // 버튼 연타 방어
  current?.exit();
  current = next;
  // **배경음은 매치인지 아닌지로만 가른다.** 씬마다 곡을 두면 로비↔상점을 오가는
  // 것만으로 음악이 계속 끊긴다 (`audio.setBgm` 이 같은 곡은 무시한다).
  audio.setBgm(next === match ? 'match' : 'lobby');
  current.enter();
}

/** 이름이 없으면 로비보다 먼저 설정 화면. 서버 계정을 읽은 뒤에도 한 번 더 본다. */
function showFirstScreen(): void {
  switchTo(store.current.name ? lobby : nameScene);
}

initVxShop();

// 첫 입력에서 오디오를 깨운다. 모바일은 제스처 없이 소리를 못 낸다.
installAudioUnlock();

// **광고는 Verse8 쪽에서 붙인다** (`net/ads.ts`). 프로덕션에는 실물 제공자를,
// 개발 빌드에는 가짜를 물려 보상 흐름을 시험할 수 있게 한다 — 개발용 가짜는
// 광고를 안 봐도 보상이 들어오므로 배포본에 실리면 안 된다.
setAdProvider(import.meta.env.DEV ? devAdProvider() : verse8AdProvider());
// 버튼 소리. **한 곳에서 위임으로 잡는다** — 씬마다 붙이면 새 버튼이 생길 때마다
// 잊어버린다. 캔버스 위 버튼(항복·배속)까지 같이 잡힌다.
document.addEventListener('pointerdown', (e) => {
  if ((e.target as HTMLElement | null)?.closest('button')) audio.play('tap');
});

showFirstScreen();

// 서버 계정을 끌어온다. 기다리지 않는다 — 첫 화면은 로컬 사본으로 먼저 뜨고,
// 붙으면 그때 값을 갈아 끼운다. 못 붙으면 오프라인으로 그대로 간다.
void bootAccount();

/**
 * 서버 계정으로 갈아 끼운 뒤 첫 화면 판단을 **다시** 한다.
 *
 * 이름이 생겼을 수도(다른 기기에서 정했거나 로컬 사본이 비었거나) 사라졌을 수도
 * (서버 계정에 이름이 없고 올리기도 실패) 있다. 전에는 "이름이 생긴 경우"만 봤는데,
 * 그러면 이름이 빈 채로 로비에 남아 매치 상단에 닉네임도 아바타도 안 뜨게 된다.
 *
 * 매치 중이면 건드리지 않는다 — 판을 하다 화면이 튕기는 게 더 나쁘다.
 */
function afterConnect(): void {
  if (current !== nameScene && current !== lobby) return;
  const want = store.current.name ? lobby : nameScene;
  if (current !== want) {
    switchTo(want);
    return;
  }
  // 같은 화면이면 값만 새로 읽는다. 닉네임 화면은 입력 중일 수 있어 다시 안 부른다.
  if (current === lobby) lobby.enter();
}

async function bootAccount(): Promise<void> {
  if (await store.connect(net)) {
    afterConnect();
    // 결제가 다른 탭에서 끝나므로 언제 끝나는지 우리가 모른다. 구독해 두고
    // 구매 결과는 서버의 `$onItemPurchased`가 지급한다. 결제창이 닫히면
    // 서버 계정을 다시 읽어 상점과 인게임 버튼에 즉시 반영한다.
    watchVxShop((purchased) => {
      if (!purchased) {
        shop.refresh();
        return;
      }
      void store.refreshAccount().finally(() => shop.refresh());
    });
    return;
  }

  // 배포 전에는 Verse8에 붙을 수 없어 방 코드도 친구랑 하기도 시험할 수가 없다.
  // 개발 빌드에서만, 진짜 server.js 를 로컬에서 돌려 그 자리를 메운다.
  // 프로덕션에서는 이 분기가 통째로 떨어져 나간다 (동적 import + DEV 치환).
  if (!import.meta.env.DEV) return;
  try {
    const { createLocalBackend } = await import('./net/local-backend');
    net.useBackend(await createLocalBackend());
    if (await store.connect(net)) afterConnect();
  } catch (e) {
    console.warn('[dev] 로컬 백엔드를 못 띄웠습니다:', String((e as Error)?.message ?? e));
  }
}

window.addEventListener('keydown', (e) => {
  // 개발용 재시작 단축키. 매치 중일 때만 먹는다.
  if ((e.key === 'r' || e.key === 'R') && current === match) match.restart();
});

let last = performance.now();

function frame(now: number): void {
  // 탭 전환 등으로 프레임이 크게 밀렸을 때 따라잡기 폭주를 막는다
  const dt = Math.min(0.25, (now - last) / 1000);
  last = now;

  current?.frame(dt);
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
