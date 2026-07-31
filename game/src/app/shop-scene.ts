/**
 * 상점 화면. DOM만 쓴다.
 *
 * 두 종류를 판다:
 *   - **영구 강화** — 매치 결과를 바꾼다. 지금은 생산 속도 하나뿐 (`UpgradeKind`)
 *   - **유닛 종류** — 2026-07-31부터 **성능이 다르다**. 종류가 체력=공격력을 정하고
 *     그 값이 `PlayerMods.unitPower` 로 sim 에 들어간다 (`src/units.ts`)
 *
 * 계정을 직접 읽거나 쓰지 않는다. 읽기는 `getAccount`, 쓰기는 콜백으로만 —
 * 씬마다 localStorage를 만지면 어느 쪽이 최신인지 알 수 없게 된다.
 */
import {
  ownsUnitKind,
  upgradeCostOf,
  upgradeLevelOf,
  upgradeMaxOf,
  unitKindOf,
  type Account,
  type UpgradeKind,
} from '../account/account';
import { speedMulFor } from '../sim/config';
import { SHOP_UNIT_ORDER, UNIT_KIND_META, type UnitKind } from '../units';
import type { Scene } from './scene';

/** 다음 단계를 사면 무엇이 어떻게 변하는가. 만렙이면 현재 값만 보여준다. */
function effectText(kind: UpgradeKind, level: number): string {
  const val = (lv: number) => `×${speedMulFor(lv).toFixed(2)}`;
  return level >= upgradeMaxOf(kind) ? val(level) : `${val(level)} → ${val(level + 1)}`;
}

/** 미리보기 이미지. 러닝 사이클 첫 프레임을 그대로 쓴다 — P1(파랑) 기준. */
function previewSrc(kind: UnitKind): string {
  return `/assets/unit/p1/${kind}/run0.png`;
}

export class ShopScene implements Scene {
  private readonly coins: HTMLElement;
  private readonly upgradeRows: { kind: UpgradeKind; el: HTMLButtonElement }[];
  private readonly unitCards: { kind: UnitKind; el: HTMLButtonElement }[];

  constructor(
    private readonly root: HTMLElement,
    private readonly getAccount: () => Account,
    private readonly buyUpgrade: (kind: UpgradeKind) => void,
    /** 안 가진 것이면 사고, 가진 것이면 착용한다. 판정은 계정 쪽에 있다. */
    private readonly pickUnit: (kind: UnitKind) => void,
    back: () => void,
  ) {
    const coins = root.querySelector<HTMLElement>('#shop-coins');
    const grid = root.querySelector<HTMLElement>('#unit-grid');
    const backBtn = root.querySelector<HTMLButtonElement>('#btn-shop-back');
    if (!coins || !grid || !backBtn) throw new Error('상점 DOM이 예상과 다릅니다');
    this.coins = coins;
    backBtn.addEventListener('click', back);

    const kinds: UpgradeKind[] = ['speed'];
    this.upgradeRows = kinds.map((kind) => {
      const el = root.querySelector<HTMLButtonElement>(`#buy-${kind}`);
      if (!el) throw new Error(`상점 행 #buy-${kind}가 없습니다`);
      el.addEventListener('click', () => {
        this.buyUpgrade(kind);
        // 코인이 줄고 단계가 올랐다. 다시 그리지 않으면 화면이 옛 값을 들고 있는다.
        this.render();
      });
      return { kind, el };
    });

    this.unitCards = SHOP_UNIT_ORDER.map((kind) => {
      const el = this.buildUnitCard(kind);
      el.addEventListener('click', () => {
        this.pickUnit(kind);
        this.render();
      });
      grid.appendChild(el);
      return { kind, el };
    });
  }

  enter(): void {
    this.render();
    this.root.hidden = false;
  }

  /**
   * 화면을 다시 그린다. 구매가 서버를 거치면 결과가 늦게 오므로,
   * 그때 앱이 이걸 불러 값을 갈아 끼운다.
   */
  refresh(): void {
    if (!this.root.hidden) this.render();
  }

  exit(): void {
    this.root.hidden = true;
  }

  frame(): void {
    // DOM이 알아서 그려진다.
  }

  private buildUnitCard(kind: UnitKind): HTMLButtonElement {
    const meta = UNIT_KIND_META[kind];
    const el = document.createElement('button');
    el.className = 'unit-card';
    el.id = `unit-${kind}`;
    // 힘을 카드에 박아 둔다. 색 차이가 곧 세기 차이라, 안 적으면 무엇을 사는 것인지
    // 그림만으로는 알 수가 없다. 체력과 공격력이 같은 값인 것도 그대로 보여 준다.
    el.innerHTML = `
      <span class="unit-art"><img alt="" src="${previewSrc(kind)}" /></span>
      <span class="unit-name">${meta.label}</span>
      <span class="unit-power">체력 ${meta.power} · 공격력 ${meta.power}</span>
      <span class="unit-blurb">${meta.blurb}</span>
      <span class="unit-state" data-role="state"></span>
    `;
    return el;
  }

  private render(): void {
    const a = this.getAccount();
    this.coins.textContent = a.coins.toLocaleString('ko-KR');

    for (const { kind, el } of this.upgradeRows) {
      const level = upgradeLevelOf(a, kind);
      const max = upgradeMaxOf(kind);
      const cost = upgradeCostOf(a, kind);
      const affordable = cost !== null && a.coins >= cost;

      set(el, 'pips', '●'.repeat(level) + '○'.repeat(Math.max(0, max - level)));
      set(el, 'effect', effectText(kind, level));
      set(el, 'price', cost === null ? '최대' : `◈ ${cost.toLocaleString('ko-KR')}`);
      el.querySelector('[data-role="price"]')?.classList.toggle('locked', !affordable);
      el.disabled = !affordable;
    }

    const worn = unitKindOf(a);
    for (const { kind, el } of this.unitCards) {
      const price = UNIT_KIND_META[kind].price;
      const owned = ownsUnitKind(a, kind);
      const equipped = kind === worn;
      const affordable = owned || a.coins >= price;

      set(el, 'state', equipped ? '착용 중' : owned ? '착용하기' : `◈ ${price.toLocaleString('ko-KR')}`);
      el.classList.toggle('is-equipped', equipped);
      el.classList.toggle('is-owned', owned);
      el.querySelector('[data-role="state"]')?.classList.toggle('locked', !affordable);
      // 착용 중인 카드는 누를 이유가 없다. 못 사는 카드도 마찬가지 —
      // 다만 가격은 계속 보여줘서 무엇을 향해 모으는 중인지 알 수 있게 한다.
      el.disabled = equipped || !affordable;
    }
  }
}

function set(row: HTMLElement, role: string, text: string): void {
  const el = row.querySelector<HTMLElement>(`[data-role="${role}"]`);
  if (el) el.textContent = text;
}
