/**
 * 순위 화면. DOM만 쓴다 (`lobby-scene.ts` 머리말과 같은 이유).
 *
 * **정렬도 자르기도 안 한다.** 서버가 판이 끝날 때마다 10칸짜리 표를 고쳐 두고
 * 여기는 받은 순서대로 그린다 — 양쪽이 순위를 매기면 어느 쪽이 맞는지 알 수 없다.
 *
 * 계정을 안 읽는다. 내 줄은 서버가 `me` 로 표시해 준다 — 닉네임은 안 겹치는 값이
 * 아니라서 이름으로 맞추면 동명이인이 내 줄로 강조된다.
 *
 * 줄을 누르면 프로필 카드가 뜬다. **카드에 쓰는 값도 이 응답에 실려 온다** — 따로
 * 조회하려면 남의 계정 주소를 받아야 하는데 서버가 그것을 막고 있다
 * (`server.js` 의 `getLeaderboard` 주석).
 */
import type { BoardEntry } from '../net/agent8';
import { DEFAULT_PROFILE, isProfileId, profileBg, profileSrc, type ProfileId } from '../profiles';
import {
  DEFAULT_UNIT_KIND,
  UNIT_KIND_META,
  sizeFactorOf,
  spriteKindOf,
  unitLabelOf,
  type UnitKind,
} from '../units';
import {
  DEFAULT_TOWER_KIND,
  TOWER_KIND_META,
  towerLabelOf,
  towerSpriteKindOf,
  type TowerKind,
} from '../towers';
import { t } from '../i18n';
import type { Scene } from './scene';

/**
 * 시상대에 세우는 순서. **가운데가 1등이다** — 올림픽 시상대와 같은 2·1·3 배치다
 * (2026-08-09 사용자 지시). 값은 순위(1부터)다.
 */
const PODIUM_ORDER = [2, 1, 3] as const;

/** 미리보기 이미지. 판에서 쓰는 것과 같은 파일이다 — P1(파랑) 기준. */
function towerPreviewSrc(kind: TowerKind): string {
  return `/assets/tower/p1/${TOWER_KIND_META[towerSpriteKindOf(kind)].art}.png`;
}

/** 러닝 사이클 첫 프레임. 그림이 없는 종류는 빌려 온다 (`spriteKindOf`). */
function unitPreviewSrc(kind: UnitKind): string {
  return `/assets/unit/p1/${spriteKindOf(kind)}/run0.png`;
}

/**
 * 정면을 보는 첫 프레임. **시상대 전용이다** (2026-08-09 사용자 지시).
 *
 * `down` 은 화면 아래로 걷는 그림이고, 그것이 곧 카메라 쪽을 보는 각도다
 * (`tools/bake-units.ts` 의 `directions` — yaw 0). 단상에 세우는 그림은 옆모습보다
 * 정면이 맞다. 굽는 쪽에 이미 있는 파일이라 3D 모델을 실행에 끌어들일 이유가 없다.
 */
function unitFrontSrc(kind: UnitKind): string {
  return `/assets/unit/p1/${spriteKindOf(kind)}/down0.png`;
}

/**
 * 서버가 준 문자열을 아는 값으로 떨어뜨린다.
 *
 * **비어 있을 수 있다.** 순위표는 점수가 움직인 판 뒤에만 갱신되므로, 이 필드가
 * 생기기 전에 표에 오른 사람은 다음 판까지 빈 값이다. 모르는 값도 마찬가지로
 * 기본값이 된다 — 옛 클라이언트가 안 아는 신상 외형이 그렇다.
 */
function asProfile(v: string): ProfileId {
  return isProfileId(v) ? v : DEFAULT_PROFILE;
}

function asUnitKind(v: string): UnitKind {
  return v in UNIT_KIND_META ? (v as UnitKind) : DEFAULT_UNIT_KIND;
}

function asTowerKind(v: string): TowerKind {
  return v in TOWER_KIND_META ? (v as TowerKind) : DEFAULT_TOWER_KIND;
}

export class BoardScene implements Scene {
  private readonly list: HTMLElement;
  private readonly podium: HTMLElement;
  private readonly note: HTMLElement;
  private readonly mascot: HTMLElement;
  private readonly card: HTMLElement;
  private readonly cardAvatar: HTMLImageElement;
  private readonly cardName: HTMLElement;
  private readonly cardRating: HTMLElement;
  private readonly cardRecord: HTMLElement;
  private readonly cardUnitArt: HTMLImageElement;
  private readonly cardUnitName: HTMLElement;
  private readonly cardTowerArt: HTMLImageElement;
  private readonly cardTowerName: HTMLElement;
  /**
   * 이번에 연 화면의 번호. 응답이 늦게 오는 사이에 나갔다 다시 들어오면
   * 앞 응답이 뒤 화면을 덮어쓴다 — 번호가 다르면 버린다.
   */
  private opened = 0;

  constructor(
    private readonly root: HTMLElement,
    /** 상위 10명. 서버에 못 붙었으면 `null` (`AccountStore.leaderboard`). */
    private readonly fetchBoard: () => Promise<BoardEntry[] | null>,
    back: () => void,
  ) {
    const list = root.querySelector<HTMLElement>('#board-list');
    const podium = root.querySelector<HTMLElement>('#board-podium');
    const note = root.querySelector<HTMLElement>('#board-note');
    const mascot = root.querySelector<HTMLElement>('#board-mascot');
    const backBtn = root.querySelector<HTMLButtonElement>('#btn-board-back');
    const card = root.querySelector<HTMLElement>('#board-card');
    const cardAvatar = root.querySelector<HTMLImageElement>('#board-card-avatar');
    const cardName = root.querySelector<HTMLElement>('#board-card-name');
    const cardRating = root.querySelector<HTMLElement>('#board-card-rating');
    const cardRecord = root.querySelector<HTMLElement>('#board-card-record');
    const cardUnitArt = root.querySelector<HTMLImageElement>('#board-card-unit-art');
    const cardUnitName = root.querySelector<HTMLElement>('#board-card-unit-name');
    const cardTowerArt = root.querySelector<HTMLImageElement>('#board-card-tower-art');
    const cardTowerName = root.querySelector<HTMLElement>('#board-card-tower-name');
    const cardClose = root.querySelector<HTMLButtonElement>('#btn-board-card-close');
    if (
      !list ||
      !podium ||
      !note ||
      !mascot ||
      !backBtn ||
      !card ||
      !cardAvatar ||
      !cardName ||
      !cardRating ||
      !cardRecord ||
      !cardUnitArt ||
      !cardUnitName ||
      !cardTowerArt ||
      !cardTowerName ||
      !cardClose
    ) {
      throw new Error('순위 DOM이 예상과 다릅니다');
    }
    this.list = list;
    this.podium = podium;
    this.note = note;
    this.mascot = mascot;
    this.card = card;
    this.cardAvatar = cardAvatar;
    this.cardName = cardName;
    this.cardRating = cardRating;
    this.cardRecord = cardRecord;
    this.cardUnitArt = cardUnitArt;
    this.cardUnitName = cardUnitName;
    this.cardTowerArt = cardTowerArt;
    this.cardTowerName = cardTowerName;
    backBtn.addEventListener('click', back);
    cardClose.addEventListener('click', () => this.closeCard());
    // 바깥을 눌러도 닫힌다. 패널 안쪽 클릭은 여기까지 안 온다(`stopPropagation` 대신
    // 대상 비교를 쓴다 — 패널 안에 버튼이 늘어도 따로 손댈 것이 없다).
    card.addEventListener('click', (e) => {
      if (e.target === card) this.closeCard();
    });
  }

  enter(): void {
    this.root.hidden = false;
    this.closeCard();
    // 들어올 때마다 새로 받는다. 판을 한 번 하고 돌아오면 순위가 바뀌어 있다.
    const mine = ++this.opened;
    this.list.replaceChildren();
    this.podium.replaceChildren();
    this.show(null, t().boardLoading);
    void this.fetchBoard().then((board) => {
      if (mine !== this.opened) return;
      this.show(board, board === null ? t().boardOffline : '');
    });
  }

  private show(board: BoardEntry[] | null, note: string): void {
    this.list.replaceChildren();
    this.podium.replaceChildren();

    // 앞 세 명은 시상대로, 나머지는 목록으로. **세 명이 안 되면 있는 만큼만 세운다** —
    // 서비스를 막 열었을 때는 한두 명뿐이고, 그때 빈 단상을 그리면 고장으로 보인다.
    const top = board ? board.slice(0, 3) : [];
    const rest = board ? board.slice(3) : [];
    this.podium.hidden = top.length === 0;
    for (const rank of PODIUM_ORDER) {
      const e = top[rank - 1];
      if (e) this.podium.append(this.podiumSlot(e, rank));
    }

    // 목록은 4등부터다. `start` 를 안 주면 브라우저가 1번부터 매겨 순위가 어긋난다.
    this.list.setAttribute('start', String(top.length + 1));
    for (const e of rest) this.list.append(this.row(e));

    // 붙었는데 표가 비어 있는 경우. 대전이 한 판도 안 끝난 상태다 —
    // 사람전과 봇 대체전 모두 점수를 반영하므로, 아직 유효한 판이 끝나지 않은 상태다.
    const text = board && board.length === 0 ? t().boardEmpty : note;
    this.note.textContent = text;
    this.note.hidden = text.length === 0;
    // 목록이 있으면 마스코트는 자리만 먹는다. 빈 화면일 때만 세운다.
    this.mascot.hidden = (board?.length ?? 0) > 0;
  }

  /**
   * 시상대 한 칸. 위에서부터 유닛 → 이름·점수 → 단상(등수 숫자) 순이다.
   *
   * 단상 높이는 CSS 가 `data-rank` 로 정한다 — 여기서 px 을 계산하면 짧은 화면 축소
   * (`--ui-scale`)와 따로 놀게 된다.
   */
  private podiumSlot(e: BoardEntry, rank: number): HTMLElement {
    const slot = document.createElement('button');
    slot.className = e.me ? 'podium-slot podium-slot-me' : 'podium-slot';
    slot.type = 'button';
    slot.dataset.rank = String(rank);
    slot.addEventListener('click', () => this.openCard(e));

    const unit = asUnitKind(e.unitKind);
    const art = document.createElement('img');
    art.className = 'podium-unit';
    art.alt = '';
    art.src = unitFrontSrc(unit);
    // 센 유닛일수록 크게 — 판에서 보이는 크기 규칙과 같다 (`sizeFactorOf`).
    // **배수만 넘기고 높이는 CSS 가 잰다.** 여기서 px 을 박으면 짧은 화면 축소
    // (`--ui-scale`)를 안 타서 상자만 줄고 그림이 위로 삐져나온다.
    art.style.setProperty('--art-scale', String(sizeFactorOf(UNIT_KIND_META[unit].power)));

    // 유닛이 서 있을 바닥. 키가 제각각이라 이 상자로 발끝을 맞춘다.
    const stage = document.createElement('span');
    stage.className = 'podium-stage';
    stage.append(art);

    const name = document.createElement('span');
    name.className = 'podium-name';
    // textContent 다. 닉네임은 남이 정한 문자열이라 innerHTML 로 넣으면 안 된다.
    name.textContent = e.name;

    const rating = document.createElement('span');
    rating.className = 'podium-rating';
    rating.textContent = t().points(e.rating);

    const block = document.createElement('span');
    block.className = 'podium-block';
    block.textContent = String(rank);

    slot.append(stage, name, rating, block);
    return slot;
  }

  private row(e: BoardEntry): HTMLElement {
    const li = document.createElement('li');
    li.className = e.me ? 'board-row board-row-me' : 'board-row';

    // **줄 전체가 버튼이다.** 이름만 누르게 하면 어디를 눌러야 카드가 뜨는지 안 보인다.
    const hit = document.createElement('button');
    hit.className = 'board-hit';
    hit.type = 'button';
    hit.addEventListener('click', () => this.openCard(e));

    const avatar = document.createElement('img');
    avatar.className = 'board-avatar';
    avatar.alt = '';
    avatar.src = profileSrc(asProfile(e.profile));
    avatar.style.setProperty('--avatar-bg', profileBg(asProfile(e.profile)));

    const name = document.createElement('span');
    name.className = 'board-name';
    // textContent 다. 닉네임은 남이 정한 문자열이라 innerHTML 로 넣으면 안 된다.
    name.textContent = e.name;

    const rating = document.createElement('span');
    rating.className = 'board-rating';
    rating.textContent = t().points(e.rating);

    hit.append(avatar, name, rating);
    li.append(hit);
    return li;
  }

  /** 프로필 카드를 채워서 연다. 값은 이미 목록에 실려 온 것뿐이다. */
  private openCard(e: BoardEntry): void {
    const profile = asProfile(e.profile);
    const unit = asUnitKind(e.unitKind);
    const tower = asTowerKind(e.towerKind);

    this.cardAvatar.src = profileSrc(profile);
    this.cardAvatar.style.setProperty('--avatar-bg', profileBg(profile));
    this.cardName.textContent = e.name;
    this.cardRating.textContent = t().points(e.rating);
    this.cardRecord.textContent = t().record(e.wins, e.losses);

    this.cardUnitArt.src = unitPreviewSrc(unit);
    // 시상대와 같은 규칙 — 배수만 넘기고 높이는 CSS 가 잰다.
    this.cardUnitArt.style.setProperty(
      '--art-scale',
      String(sizeFactorOf(UNIT_KIND_META[unit].power)),
    );
    this.cardUnitName.textContent = unitLabelOf(unit);

    // 타워는 종류별 크기 차이가 없다. 높이는 CSS 가 정한다.
    this.cardTowerArt.src = towerPreviewSrc(tower);
    this.cardTowerName.textContent = towerLabelOf(tower);

    this.card.hidden = false;
  }

  private closeCard(): void {
    this.card.hidden = true;
  }

  exit(): void {
    this.closeCard();
    this.root.hidden = true;
  }

  frame(): void {
    // DOM이 알아서 그려진다.
  }
}
