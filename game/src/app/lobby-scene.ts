/**
 * 로비. DOM만 쓴다.
 *
 * 캔버스에 그리지 않는 이유: 버튼·목록은 문서에 가까운 UI라 히트테스트를 손으로 짜야 한다.
 * 매치 내 상점 버튼 하나 때문에 `renderer.shopHit`을 만들고 그 뒤에서 절단 스와이프가
 * 시작되는 버그를 따로 막아야 했다 — 버튼이 늘수록 그 비용이 선형으로 늘어난다.
 *
 * 상점은 별도 화면이다 (`shop-scene.ts`). 로비는 재화·전적을 보여주고 갈 곳만 고른다.
 */
import type { Account } from '../account/account';
import { t } from '../i18n';
import { profileBg, profileSrc } from '../profiles';
import type { Scene } from './scene';

export class LobbyScene implements Scene {
  private readonly name: HTMLElement;
  private readonly avatar: HTMLImageElement;
  private readonly coins: HTMLElement;
  private readonly rating: HTMLElement;
  private readonly record: HTMLElement;
  private readonly tutorial: HTMLElement;

  constructor(
    private readonly root: HTMLElement,
    private readonly getAccount: () => Account,
    /**
     * 자동 매칭. 상대가 없으면 서버가 봇으로 대체하지만 그건 로비가 알 바가 아니다 —
     * 여기서 갈래를 나누면 두 곳에서 같은 판단을 하게 된다.
     */
    startAuto: () => void,
    /** 친구랑 하기. 방을 만들거나 코드로 들어간다. 봇 대체가 없다. */
    startFriend: () => void,
    openShop: () => void,
    /** 순위. 서버에서 상위 10명을 받아 오는 화면이다 (`board-scene.ts`). */
    openBoard: () => void,
    /** 설정. 지금은 언어뿐이다 (`settings-scene.ts`). */
    openSettings: () => void,
    editAccount: () => void,
  ) {
    const name = root.querySelector<HTMLElement>('#acc-name');
    const avatar = root.querySelector<HTMLImageElement>('#acc-avatar');
    if (!name || !avatar) throw new Error('로비 DOM이 예상과 다릅니다');
    this.name = name;
    this.avatar = avatar;
    const auto = root.querySelector<HTMLButtonElement>('#btn-auto');
    const friend = root.querySelector<HTMLButtonElement>('#btn-friend');
    const shop = root.querySelector<HTMLButtonElement>('#btn-shop');
    const board = root.querySelector<HTMLButtonElement>('#btn-board');
    const tutorialButton = root.querySelector<HTMLButtonElement>('#btn-tutorial');
    const settings = root.querySelector<HTMLButtonElement>('#btn-settings');
    const tutorial = root.querySelector<HTMLElement>('#tutorial-dialog');
    const tutorialClose = root.querySelector<HTMLButtonElement>('#btn-tutorial-close');
    const coins = root.querySelector<HTMLElement>('#acc-coins');
    const rating = root.querySelector<HTMLElement>('#acc-rating');
    const record = root.querySelector<HTMLElement>('#acc-record');
    if (!auto || !friend || !shop || !board || !tutorialButton || !settings || !tutorial ||
        !tutorialClose || !coins || !rating || !record) {
      throw new Error('로비 DOM이 예상과 다릅니다');
    }
    this.coins = coins;
    this.rating = rating;
    this.record = record;
    this.tutorial = tutorial;
    auto.addEventListener('click', startAuto);
    friend.addEventListener('click', startFriend);
    shop.addEventListener('click', openShop);
    board.addEventListener('click', openBoard);
    const closeTutorial = () => { this.tutorial.hidden = true; };
    tutorialButton.addEventListener('click', () => {
      this.tutorial.hidden = false;
      // 우상단 `×` 를 없앴다 (2026-08-04 사용자 지시). 닫는 길은 [알겠어요] ·
      // 바깥 클릭 · Esc 셋이고, 그중 버튼에 포커스를 준다.
      tutorialClose.focus();
    });
    tutorialClose.addEventListener('click', closeTutorial);
    tutorial.addEventListener('click', (event) => {
      if (event.target === tutorial) closeTutorial();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !this.tutorial.hidden) closeTutorial();
    });
    settings.addEventListener('click', openSettings);
    name.addEventListener('click', editAccount);
  }

  enter(): void {
    this.tutorial.hidden = true;
    // 매치나 상점에서 돌아올 때마다 새로 읽는다 — 보상과 지출이 반영된 값을 보여줘야 한다.
    const a = this.getAccount();
    this.name.textContent = a.name;
    // 이름이 없으면(설정 전) 아바타도 숨긴다 — 이름 없이 그림만 뜨면 무엇인지 모른다.
    this.avatar.hidden = !a.name;
    const src = profileSrc(a.profile);
    // 같은 값을 다시 넣으면 브라우저가 다시 불러오는 경우가 있어 바뀔 때만 쓴다.
    if (!this.avatar.src.endsWith(src)) this.avatar.src = src;
    // 그림은 모두가 같고 뒤에 깔리는 색이 고른 값이다 (src/profiles.ts).
    this.avatar.style.background = profileBg(a.profile);
    this.coins.textContent = a.coins.toLocaleString();
    this.rating.textContent = t().points(a.rating);
    // 무승부는 안 적는다 — 언어마다 표기가 갈리고, 거의 안 난다.
    this.record.textContent = t().record(a.wins, a.losses);
    this.root.hidden = false;
  }

  exit(): void {
    this.tutorial.hidden = true;
    this.root.hidden = true;
  }

  frame(): void {
    // DOM이 알아서 그려진다.
  }
}
