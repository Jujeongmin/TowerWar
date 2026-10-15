/**
 * 캠페인 스테이지 목록. DOM만 쓴다 (`lobby-scene.ts` 와 같은 이유).
 *
 * 20칸을 장마다 5칸씩 놓는다. **순서대로만 열린다** — 깬 마지막 판 + 1 까지
 * (`canPlayStage`, 서버의 `startCampaign` 과 같은 규칙). 잠긴 칸은 눌리지 않는다.
 */
import { canPlayStage, type Account } from '../account/account';
import { STAGES, STAGES_PER_CHAPTER, stageLabel } from '../campaign/stages';
import { t } from '../i18n';
import type { Scene } from './scene';

export class CampaignScene implements Scene {
  private readonly list: HTMLElement;
  private readonly coins: HTMLElement;

  constructor(
    private readonly root: HTMLElement,
    private readonly getAccount: () => Account,
    /** 스테이지를 골랐다. 판을 여는 쪽(main.ts)이 서버 시작 기록까지 맡는다. */
    private readonly play: (stage: number) => void,
    back: () => void,
  ) {
    const list = root.querySelector<HTMLElement>('#campaign-list');
    const coins = root.querySelector<HTMLElement>('#campaign-coins');
    const backBtn = root.querySelector<HTMLButtonElement>('#btn-campaign-back');
    if (!list || !coins || !backBtn) throw new Error('캠페인 DOM이 예상과 다릅니다');
    this.list = list;
    this.coins = coins;
    backBtn.addEventListener('click', back);
  }

  enter(): void {
    // 판을 깨고 돌아올 때마다 새로 그린다 — 진행도와 언어가 바뀌었을 수 있다.
    const a = this.getAccount();
    this.coins.textContent = a.coins.toLocaleString();
    this.list.replaceChildren();
    const chapters = Math.ceil(STAGES.length / STAGES_PER_CHAPTER);
    for (let c = 0; c < chapters; c++) {
      const box = document.createElement('div');
      box.className = 'shop campaign-chapter';
      const title = document.createElement('p');
      title.className = 'shop-title';
      title.textContent = t().campaignChapter(c + 1);
      const grid = document.createElement('div');
      grid.className = 'stage-grid';
      for (const st of STAGES.slice(c * STAGES_PER_CHAPTER, (c + 1) * STAGES_PER_CHAPTER)) {
        grid.append(this.card(a, st.n, st.firstClear));
      }
      box.append(title, grid);
      this.list.append(box);
    }
    this.root.hidden = false;
    // 지금 할 판이 화면 밖이면 거기까지 내려 준다. 짧은 창에서 4장이 안 보일 수 있다.
    this.list.querySelector('.is-next')?.scrollIntoView({ block: 'nearest' });
  }

  exit(): void {
    this.root.hidden = true;
  }

  frame(): void {
    // DOM이 알아서 그려진다.
  }

  private card(a: Account, n: number, firstClear: number): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'stage-card';
    const cleared = n <= a.campaignCleared;
    const open = canPlayStage(a, n);
    if (cleared) b.classList.add('is-cleared');
    else if (open) b.classList.add('is-next');
    b.disabled = !open;

    const label = document.createElement('span');
    label.className = 'stage-label';
    label.textContent = stageLabel(n);
    // 아랫줄: 깬 판은 표시만, 다음 판은 걸린 코인, 잠긴 판은 비운다.
    const sub = document.createElement('span');
    sub.className = 'stage-sub';
    sub.textContent = cleared ? '✓' : open ? `+${firstClear.toLocaleString()}` : '';
    b.append(label, sub);
    b.setAttribute('aria-label', `${t().campaignEnemy(stageLabel(n))}${open ? '' : ` — ${t().campaignLocked}`}`);
    b.addEventListener('click', () => {
      if (canPlayStage(this.getAccount(), n)) this.play(n);
    });
    return b;
  }
}
