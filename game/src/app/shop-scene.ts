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
  canUseTempo,
  ownsUnitKind,
  upgradeCostOf,
  upgradeLevelOf,
  upgradeMaxOf,
  unitKindOf,
  type Account,
  type UpgradeKind,
} from '../account/account';
import { speedMulFor } from '../sim/config';

/**
 * 광고 한 번에 주는 코인. **`server.js` 의 `AD_COINS` 와 같아야 한다** — 여기 값은
 * 버튼에 적는 용도일 뿐이고, 실제로 주는 것은 서버다. 어긋나면 화면이 거짓말을 한다.
 */
const AD_COINS = 60;
import {
  MAX_UNIT_POWER,
  SHOP_PREMIUM_ORDER,
  SHOP_UNIT_ORDER,
  UNIT_KIND_META,
  isPremiumKind,
  sizeFactorOf,
  unitBlurbOf,
  unitLabelOf,
  spriteKindOf,
  tierOf,
  type UnitKind,
} from '../units';
import { isAdReady } from '../net/ads';
import { isPurchasable, TEMPO_ITEM, vxPrice, type PremiumItem } from '../net/vx';
import { t } from '../i18n';
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
  private readonly adNote: HTMLElement;
  private readonly adCard: HTMLButtonElement;
  private readonly tempoRow: HTMLButtonElement;

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
    private readonly openVxShop: (item: PremiumItem) => Promise<boolean>,
    /** 광고를 보고 코인. `null` 이면 성공, 아니면 실패 이유. */
    private readonly watchAdForCoins: () => Promise<string | null>,
    back: () => void,
  ) {
    const coins = root.querySelector<HTMLElement>('#shop-coins');
    const grid = root.querySelector<HTMLElement>('#unit-grid');
    const pgrid = root.querySelector<HTMLElement>('#premium-grid');
    const vxNote = root.querySelector<HTMLElement>('#vx-note');
    const pitems = root.querySelector<HTMLElement>('#premium-items');
    const adNote = root.querySelector<HTMLElement>('#ad-note');
    const backBtn = root.querySelector<HTMLButtonElement>('#btn-shop-back');
    if (!coins || !grid || !pgrid || !vxNote || !pitems || !adNote || !backBtn) {
      throw new Error('상점 DOM이 예상과 다릅니다');
    }
    this.vxNote = vxNote;
    this.adNote = adNote;

    // **유닛이 아닌 유료 항목.** 지금은 배속 하나뿐이라 카드도 하나다.
    const tempo = document.createElement('button');
    tempo.className = 'shop-row premium-row';
    tempo.id = 'buy-tempo';
    tempo.innerHTML = `
      <span class="shop-head">
        <span class="shop-name" data-role="name"></span>
        <span class="shop-price" data-role="state"></span>
      </span>
      <span class="shop-foot"><span class="shop-effect" data-role="blurb"></span></span>
      <span class="shop-desc" data-role="desc"></span>
    `;
    tempo.addEventListener('click', () => {
      // 이미 가진 것이면 누를 이유가 없다 (`render` 가 비활성으로 둔다).
      void this.openVxShop(TEMPO_ITEM).then((ok) => {
        if (!ok) this.vxNote.textContent = t().vxOpenFailed;
      });
    });
    pitems.appendChild(tempo);
    this.tempoRow = tempo;

    // **광고 카드는 유닛 격자 안에 들어간다** (2026-08-03 사용자 지시).
    // 유닛 5개 + 광고 1개 = 3열 두 줄이 정확히 찬다 — 전에는 광고가 따로 있어
    // 격자 마지막 줄에 빈칸이 남았다.
    const ad = document.createElement('button');
    ad.className = 'unit-card ad-card';
    ad.id = 'unit-ad';
    ad.innerHTML = `
      <span class="unit-art ad-art">◈</span>
      <span class="unit-name" data-role="name"></span>
      <span class="unit-tier"></span>
      <span class="unit-power" data-role="amount"></span>
      <span class="unit-blurb"></span>
      <span class="unit-state" data-role="state"></span>
    `;
    ad.addEventListener('click', () => {
      // 광고를 보는 동안 두 번 눌리면 두 번 재생된다.
      ad.disabled = true;
      this.adNote.textContent = '';
      this.adNote.hidden = true;
      void this.watchAdForCoins().then((err) => {
        const msg = err === null ? '' : adMessage(err);
        this.adNote.textContent = msg;
        this.adNote.hidden = msg.length === 0;
        this.render();
      });
    });
    this.adCard = ad;
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
    // 유닛 카드 **뒤에** 붙어야 마지막 빈칸을 메운다.
    grid.appendChild(this.adCard);

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
        void this.openVxShop(kind).then((ok) => {
          // 팝업 차단에 걸렸다. 조용히 지나가면 눌렀는데 아무 일도 안 일어난 것으로 보인다.
          if (!ok) this.vxNote.textContent = t().vxOpenFailed;
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
      <span class="unit-name" data-role="name"></span>
      <span class="unit-tier" data-role="tier"></span>
      <span class="unit-bar"><i style="width:${fill}%"></i></span>
      <span class="unit-power" data-role="stats"></span>
      <span class="unit-blurb" data-role="blurb"></span>
      <span class="unit-state" data-role="state"></span>
    `;
    return el;
  }

  private render(): void {
    const a = this.getAccount();
    this.coins.textContent = a.coins.toLocaleString();

    for (const { kind, el } of this.upgradeRows) {
      const level = upgradeLevelOf(a, kind);
      const max = upgradeMaxOf(kind);
      const cost = upgradeCostOf(a, kind);
      const affordable = cost !== null && a.coins >= cost;

      set(el, 'pips', '●'.repeat(level) + '○'.repeat(Math.max(0, max - level)));
      set(el, 'effect', effectText(kind, level));
      set(el, 'price', cost === null ? t().maxed : `◈ ${cost.toLocaleString()}`);
      el.querySelector('[data-role="price"]')?.classList.toggle('locked', !affordable);
      el.disabled = !affordable;
    }

    // **이름·스탯·설명은 매번 다시 쓴다.** 카드는 생성자에서 한 번만 만들어지므로
    // 여기서 안 채우면 언어를 바꿔도 처음 언어가 그대로 남는다 — 실제로 그 버그를 냈다.
    for (const { kind, el } of [...this.unitCards, ...this.premiumCards]) {
      set(el, 'name', unitLabelOf(kind));
      set(el, 'stats', t().unitStats(UNIT_KIND_META[kind].power));
      set(el, 'blurb', unitBlurbOf(kind));
      // 판에서 머리 위에 찍히는 표식과 **개수가 같다** — 상점과 화면이 다른 말을 하면
      // 무엇을 산 것인지 알 수가 없다 (`renderer.drawTierPips`).
      const tier = tierOf(kind);
      const pips = el.querySelector<HTMLElement>('[data-role="tier"]');
      if (pips) {
        pips.textContent = '◆'.repeat(tier);
        pips.style.color = UNIT_KIND_META[kind].accent ?? 'transparent';
      }
    }

    const worn = unitKindOf(a);
    for (const { kind, el } of this.unitCards) {
      const price = UNIT_KIND_META[kind].price;
      const owned = ownsUnitKind(a, kind);
      const equipped = kind === worn;
      const affordable = owned || a.coins >= price;

      set(el, 'state', equipped ? t().equipped : owned ? t().equip : `◈ ${price.toLocaleString()}`);
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

      const price = vxPrice(kind);
      set(el, 'state', equipped ? t().equipped : owned ? t().equip : sellable && price !== null ? `${price.toLocaleString()} VX` : t().comingSoon);
      el.classList.toggle('is-equipped', equipped);
      el.classList.toggle('is-owned', owned);
      el.querySelector('[data-role="state"]')?.classList.toggle('locked', !owned && !sellable);
      el.disabled = equipped || (!owned && !sellable);
    }
    // 자산 id 표(`ASSET_IDS`)가 비어 있으면 아직 팔 수 없다. 배포 전에는 늘 이 상태다 —
    // 이유를 안 적으면 버튼이 왜 죽어 있는지 알 수가 없다.
    // 배속. 유닛이 아니라 능력이라 카드 모양이 다르다.
    const hasTempo = canUseTempo(a);
    const tempoSellable = isPurchasable(TEMPO_ITEM);
    anyPurchasable = anyPurchasable || tempoSellable;
    set(this.tempoRow, 'name', t().tempoItem);
    set(this.tempoRow, 'blurb', t().tempoItemBlurb);
    set(this.tempoRow, 'desc', t().tempoItemDesc);
    const tempoPrice = vxPrice(TEMPO_ITEM);
    set(this.tempoRow, 'state', hasTempo ? t().owned : tempoSellable && tempoPrice !== null ? `${tempoPrice.toLocaleString()} VX` : t().comingSoon);
    this.tempoRow.classList.toggle('is-owned', hasTempo);
    this.tempoRow.disabled = hasTempo || !tempoSellable;

    this.vxNote.textContent = anyPurchasable ? '' : t().vxNotListed;
    this.vxNote.hidden = anyPurchasable;

    // **볼 광고가 없으면 카드를 통째로 숨긴다.** 눌러도 아무 일이 없는 버튼은 고장으로
    // 읽힌다 — VX 상품이 없을 때 `준비 중` 으로 두는 것과 같은 규칙이다.
    this.adCard.hidden = !isAdReady();
    set(this.adCard, 'name', t().adCard);
    set(this.adCard, 'amount', `+${AD_COINS}`);
    set(this.adCard, 'state', t().adCardAction);
    this.adCard.disabled = false;
  }
}

/**
 * 서버가 거절한 이유를 화면 문구로.
 *
 * **서버가 코드로 던진다** (`ad_limit` 등). 전에는 한국어 문장을 던지고 여기서
 * 문자열을 맞춰 봤는데, 간격 제한이 "광고를 안 봤다"로 표시되는 버그가 났고
 * 영어 화면에서는 애초에 안 맞았다.
 *
 * `ad_pending` 은 검증이 아직 안 끝난 것뿐이지 실패가 아니다 — `adCooldown`
 * ("조금 뒤에 다시 시도하세요")이 그대로 맞는다. `ad_invalid`·`ad_not_verified`·
 * `ad_already_claimed` 는 전부 "이 청구는 유효하지 않다"로 묶여 `adFailed` 로 간다 —
 * 화면에서 굳이 셋을 갈라 보여줄 이유가 없다 (사람이 직접 만들 수 있는 상황이 아니다).
 */
function adMessage(err: string): string {
  if (err === 'notFinished') return t().adFailed;
  if (err === 'offline') return t().adUnavailable;
  if (err.includes('ad_limit')) return t().adLimit;
  if (err.includes('ad_cooldown')) return t().adCooldown;
  if (err.includes('ad_pending')) return t().adCooldown;
  return t().adFailed;
}

function set(row: HTMLElement, role: string, text: string): void {
  const el = row.querySelector<HTMLElement>(`[data-role="${role}"]`);
  if (el) el.textContent = text;
}
