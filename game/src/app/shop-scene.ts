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
import {
  MAX_UNIT_POWER,
  SHOP_PREMIUM_ORDER,
  SHOP_UNIT_ORDER,
  UNIT_KIND_META,
  isPremiumKind,
  sizeFactorOf,
  spriteKindOf,
  type UnitKind,
} from '../units';
import { isPurchasable } from '../net/vx';
import type { Scene } from './scene';

/** 다음 단계를 사면 무엇이 어떻게 변하는가. 만렙이면 현재 값만 보여준다. */
function effectText(kind: UpgradeKind, level: number): string {
  const val = (lv: number) => `×${speedMulFor(lv).toFixed(2)}`;
  return level >= upgradeMaxOf(kind) ? val(level) : `${val(level)} → ${val(level + 1)}`;
}

/**
 * 가장 약한 유닛의 미리보기 높이(px). 여기에 `sizeFactorOf` 를 곱한다.
 * `.unit-art` 의 상자 높이(56px)보다 낮아야 가장 센 것도 안 잘린다.
 */
const UNIT_ART_BASE_H = 44;

/** 미리보기 이미지. 러닝 사이클 첫 프레임을 그대로 쓴다 — P1(파랑) 기준. */
function previewSrc(kind: UnitKind): string {
  // 그림이 없는 종류는 빌려 온다 (`spriteKindOf`). 무지개 비어갱이 그렇고,
  // 구분은 카드에 얹는 아우라(`.unit-art.aura-rainbow`)가 맡는다.
  return `/assets/unit/p1/${spriteKindOf(kind)}/run0.png`;
}

export class ShopScene implements Scene {
  private readonly coins: HTMLElement;
  private readonly upgradeRows: { kind: UpgradeKind; el: HTMLButtonElement }[];
  private readonly unitCards: { kind: UnitKind; el: HTMLButtonElement }[];
  private readonly premiumCards: { kind: UnitKind; el: HTMLButtonElement }[];
  private readonly vxNote: HTMLElement;

  constructor(
    private readonly root: HTMLElement,
    private readonly getAccount: () => Account,
    private readonly buyUpgrade: (kind: UpgradeKind) => void,
    /** 안 가진 것이면 사고, 가진 것이면 착용한다. 판정은 계정 쪽에 있다. */
    private readonly pickUnit: (kind: UnitKind) => void,
    /**
     * 유료 항목을 사러 간다. **결제 창은 Verse8 쪽 페이지다** — 우리는 주소만 받아
     * 새 탭으로 연다 (`net/vx.ts`). 열 수 없으면 `false` 를 돌려준다.
     */
    private readonly openVxShop: () => Promise<boolean>,
    back: () => void,
  ) {
    const coins = root.querySelector<HTMLElement>('#shop-coins');
    const grid = root.querySelector<HTMLElement>('#unit-grid');
    const pgrid = root.querySelector<HTMLElement>('#premium-grid');
    const vxNote = root.querySelector<HTMLElement>('#vx-note');
    const backBtn = root.querySelector<HTMLButtonElement>('#btn-shop-back');
    if (!coins || !grid || !pgrid || !vxNote || !backBtn) throw new Error('상점 DOM이 예상과 다릅니다');
    this.vxNote = vxNote;
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

    this.premiumCards = SHOP_PREMIUM_ORDER.map((kind) => {
      const el = this.buildUnitCard(kind);
      el.addEventListener('click', () => {
        // 이미 가진 것이면 착용, 아니면 결제 창을 연다. 두 갈래가 한 버튼인 이유:
        // 카드 하나가 "이 물건"을 뜻하고, 무엇을 할지는 상태가 정한다.
        if (ownsUnitKind(this.getAccount(), kind)) {
          this.pickUnit(kind);
          this.render();
          return;
        }
        void this.openVxShop().then((ok) => {
          // 팝업 차단에 걸렸다. 조용히 지나가면 눌렀는데 아무 일도 안 일어난 것으로 보인다.
          if (!ok) this.vxNote.textContent = '결제 창을 열지 못했습니다. 다시 눌러 주세요.';
        });
      });
      pgrid.appendChild(el);
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
    el.className = isPremiumKind(kind) ? 'unit-card unit-card-premium' : 'unit-card';
    el.id = `unit-${kind}`;
    // 다섯 종이 같은 캐릭터를 하의 색만 바꿔 구운 것이라 **색만으로는 순서가 없다** —
    // 흰·금·초록·보라 중 어느 쪽이 센지 알 방법이 없다. 그래서 셋으로 말한다:
    //
    //   1. **크기** — `sizeFactorOf`. 실제 판에서 그리는 것과 **같은 함수**다.
    //      상점에서만 크게 그리면 산 것이 판에서는 똑같아 보인다 (화면이 거짓말한다)
    //   2. **힘 막대** — 카탈로그 최댓값 대비 몇 %인가. 크기 차이(최대 1.2배)만으로는
    //      옆에 안 놓인 두 카드를 비교하기 어렵다
    //   3. 숫자 — 체력·공격력이 같은 값인 것까지 그대로
    //
    // 카드가 아래 정렬이라(`.unit-art`) 미리보기들이 **같은 바닥선 위에 선다** —
    // 키 재는 자처럼 읽히게 하려는 것이다.
    // px로 준다. `%` 로 주면 `.unit-art img` 의 `max-height: 100%` 에 걸려 잘린다.
    const artH = Math.round(UNIT_ART_BASE_H * sizeFactorOf(meta.power));
    const fill = Math.round((meta.power / MAX_UNIT_POWER) * 100);
    el.innerHTML = `
      <span class="unit-art${meta.aura === 'rainbow' ? ' aura-rainbow' : ''}"><img alt="" src="${previewSrc(kind)}" style="height:${artH}px" /></span>
      <span class="unit-name">${meta.label}</span>
      <span class="unit-bar"><i style="width:${fill}%"></i></span>
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

    // 유료 칸. 가격을 코인으로 안 적는다 — 실제 값은 Verse8 상점이 정한다.
    let anyPurchasable = false;
    for (const { kind, el } of this.premiumCards) {
      const owned = ownsUnitKind(a, kind);
      const equipped = kind === worn;
      const sellable = isPurchasable(kind);
      anyPurchasable = anyPurchasable || sellable;

      set(el, 'state', equipped ? '착용 중' : owned ? '착용하기' : sellable ? 'VX로 구매' : '준비 중');
      el.classList.toggle('is-equipped', equipped);
      el.classList.toggle('is-owned', owned);
      el.querySelector('[data-role="state"]')?.classList.toggle('locked', !owned && !sellable);
      el.disabled = equipped || (!owned && !sellable);
    }
    // 자산 id 표(`ASSET_IDS`)가 비어 있으면 아직 팔 수 없다. 배포 전에는 늘 이 상태다 —
    // 이유를 안 적으면 버튼이 왜 죽어 있는지 알 수가 없다.
    this.vxNote.textContent = anyPurchasable ? '' : '결제 상품이 아직 등록되지 않았습니다.';
    this.vxNote.hidden = anyPurchasable;
  }
}

function set(row: HTMLElement, role: string, text: string): void {
  const el = row.querySelector<HTMLElement>(`[data-role="${role}"]`);
  if (el) el.textContent = text;
}
