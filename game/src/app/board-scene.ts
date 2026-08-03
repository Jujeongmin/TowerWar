/**
 * 순위 화면. DOM만 쓴다 (`lobby-scene.ts` 머리말과 같은 이유).
 *
 * **정렬도 자르기도 안 한다.** 서버가 판이 끝날 때마다 10칸짜리 표를 고쳐 두고
 * 여기는 받은 순서대로 그린다 — 양쪽이 순위를 매기면 어느 쪽이 맞는지 알 수 없다.
 *
 * 계정을 안 읽는다. 내 줄은 서버가 `me` 로 표시해 준다 — 닉네임은 안 겹치는 값이
 * 아니라서 이름으로 맞추면 동명이인이 내 줄로 강조된다.
 */
import type { BoardEntry } from '../net/agent8';
import { t } from '../i18n';
import type { Scene } from './scene';

export class BoardScene implements Scene {
  private readonly list: HTMLElement;
  private readonly note: HTMLElement;
  private readonly mascot: HTMLElement;
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
    const note = root.querySelector<HTMLElement>('#board-note');
    const mascot = root.querySelector<HTMLElement>('#board-mascot');
    const backBtn = root.querySelector<HTMLButtonElement>('#btn-board-back');
    if (!list || !note || !mascot || !backBtn) throw new Error('순위 DOM이 예상과 다릅니다');
    this.list = list;
    this.note = note;
    this.mascot = mascot;
    backBtn.addEventListener('click', back);
  }

  enter(): void {
    this.root.hidden = false;
    // 들어올 때마다 새로 받는다. 판을 한 번 하고 돌아오면 순위가 바뀌어 있다.
    const mine = ++this.opened;
    this.list.replaceChildren();
    this.show(null, t().boardLoading);
    void this.fetchBoard().then((board) => {
      if (mine !== this.opened) return;
      this.show(board, board === null ? t().boardOffline : '');
    });
  }

  private show(board: BoardEntry[] | null, note: string): void {
    this.list.replaceChildren();
    if (board && board.length > 0) {
      for (const e of board) this.list.append(this.row(e));
    }
    // 붙었는데 표가 비어 있는 경우. 대전이 한 판도 안 끝난 상태다 —
    // 사람전과 봇 대체전 모두 점수를 반영하므로, 아직 유효한 판이 끝나지 않은 상태다.
    const text = board && board.length === 0 ? t().boardEmpty : note;
    this.note.textContent = text;
    this.note.hidden = text.length === 0;
    // 목록이 있으면 마스코트는 자리만 먹는다. 빈 화면일 때만 세운다.
    this.mascot.hidden = (board?.length ?? 0) > 0;
  }

  private row(e: BoardEntry): HTMLElement {
    const li = document.createElement('li');
    li.className = e.me ? 'board-row board-row-me' : 'board-row';
    const name = document.createElement('span');
    name.className = 'board-name';
    // textContent 다. 닉네임은 남이 정한 문자열이라 innerHTML 로 넣으면 안 된다.
    name.textContent = e.name;
    const rating = document.createElement('span');
    rating.className = 'board-rating';
    rating.textContent = t().points(e.rating);
    li.append(name, rating);
    return li;
  }

  exit(): void {
    this.root.hidden = true;
  }

  frame(): void {
    // DOM이 알아서 그려진다.
  }
}
