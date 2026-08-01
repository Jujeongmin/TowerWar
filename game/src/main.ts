/**
 * 부트스트랩 + 씬 전환.
 *
 * 앱 전체에서 rAF 루프는 여기 하나뿐이고, 매 프레임 현재 씬의 frame만 부른다.
 * 매치의 고정 타임스텝 루프는 MatchScene 안에 있다.
 */
import './style.css';
import { unitKindOf, type Reward, type UpgradeKind } from './account/account';
import { AccountStore, type RatingChange } from './account/store';
import { matchModsFor } from './app/difficulty';
import { BoardScene } from './app/board-scene';
import { LobbyScene } from './app/lobby-scene';
import { MatchScene } from './app/match-scene';
import { NameScene } from './app/name-scene';
import type { MatchPlan, Scene } from './app/scene';
import { PvpScene } from './app/pvp-scene';
import { ShopScene } from './app/shop-scene';
import { Agent8Client } from './net/agent8';
import { Renderer } from './render/renderer';
import type { UnitKind } from './units';

function need<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id}를 찾을 수 없습니다`);
  return el as T;
}

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

/** 못 사는 구매는 조용히 무시된다 — 버튼이 이미 비활성이라 여기까지 오면 경쟁 상태다. */
function buy(kind: UpgradeKind): void {
  void store.buyUpgrade(kind).then(() => shop.refresh());
}

/** 안 가진 생김새면 사고, 가진 것이면 착용한다. 둘 다 못 하면 아무 일도 안 일어난다. */
function pickUnit(kind: UnitKind): void {
  void store.pickUnit(kind).then(() => shop.refresh());
}

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
  (seed) => {
    plan = { mode: 'pve', seed, serverRoom: seed !== undefined };
    switchTo(match);
  },
  () => switchTo(lobby),
  net,
);
const shop = new ShopScene(
  need('shop'),
  () => store.current,
  buy,
  pickUnit,
  () => switchTo(lobby),
);
const nameScene = new NameScene(
  need('name'),
  (name, profile) => store.setName(name, profile),
  () => switchTo(lobby),
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
  () => matchModsFor(store.current),
  () => unitKindOf(store.current),
  () => store.current.name,
  () => store.current.profile,
  () => store.current.rating,
  () => plan,
  need<HTMLButtonElement>('btn-resign'),
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
  current.enter();
}

/** 이름이 없으면 로비보다 먼저 설정 화면. 서버 계정을 읽은 뒤에도 한 번 더 본다. */
function showFirstScreen(): void {
  switchTo(store.current.name ? lobby : nameScene);
}

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
