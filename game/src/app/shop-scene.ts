/**
 * 상점 화면. DOM만 쓴다.
 *
 * 파는 것:
 *   - **유닛 종류** — 2026-07-31부터 **성능이 다르다**. 종류가 체력=공격력을 정하고
 *     그 값이 `PlayerMods.unitPower` 로 sim 에 들어간다 (`src/units.ts`)
 *   - **유료(VX) 항목** — 배속과 무지개 유닛
 *
 * **영구 강화(생산 속도) 칸은 2026-08-06에 뺐다** (사용자 지시). 생산속도를 타워 외형이
 * 이어받기로 해서, 추상적인 단계 강화가 같이 있으면 두 축이 겹친다.
 *
 * 계정을 직접 읽거나 쓰지 않는다. 읽기는 `getAccount`, 쓰기는 콜백으로만 —
 * 씬마다 localStorage를 만지면 어느 쪽이 최신인지 알 수 없게 된다.
 */
import {
  AD_COOLDOWN_MS,
  canUseTempo,
  ownsTowerKind,
  ownsUnitKind,
  towerKindOf,
  unitKindOf,
  type Account,
} from '../account/account';

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
import {
  SHOP_PREMIUM_TOWER_ORDER,
  SHOP_TOWER_ORDER,
  TOWER_KIND_META,
  isPremiumTower,
  towerBlurbOf,
  towerLabelOf,
  towerSpriteKindOf,
  type TowerKind,
} from '../towers';
import { isAdReady } from '../net/ads';
import { isPurchasable, TEMPO_ITEM, vxPrice, type PremiumItem } from '../net/vx';
import { t } from '../i18n';
import type { Scene } from './scene';

/** 상점 카드의 타워 그림 높이(px). `.unit-art` 상자(56px)보다 낮아야 안 잘린다. */
const TOWER_ART_H = 48;

/** 미리보기 이미지. 판에서 쓰는 것과 같은 파일이다 — P1(파랑) 기준. */
function towerPreviewSrc(kind: TowerKind): string {
  return `/assets/tower/p1/${TOWER_KIND_META[towerSpriteKindOf(kind)].art}.png`;
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
  private readonly unitCards: { kind: UnitKind; el: HTMLButtonElement }[];
  private readonly premiumCards: { kind: UnitKind; el: HTMLButtonElement }[];
  private readonly towerCards: { kind: TowerKind; el: HTMLButtonElement }[];
  private readonly premiumTowerCards: { kind: TowerKind; el: HTMLButtonElement }[];
  private readonly vxNote: HTMLElement;
  private readonly adNote: HTMLElement;
  private readonly adCard: HTMLButtonElement;
  private readonly tempoRow: HTMLButtonElement;
  /** 광고 재생~청구가 진행 중. 그동안은 쿨다운 틱이 버튼을 다시 켜지 못하게 한다. */
  private watching = false;
  /** 쿨다운 남은 시간을 매초 갱신하는 타이머. 상점이 보일 때만 돈다. */
  private cooldownTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly root: HTMLElement,
    private readonly getAccount: () => Account,
    /** 안 가진 것이면 사고, 가진 것이면 착용한다. 판정은 계정 쪽에 있다. */
    private readonly pickUnit: (kind: UnitKind) => void,
    /** 유닛과 같은 규칙이지만 타워 외형을 사고/착용한다. */
    private readonly pickTower: (kind: TowerKind) => void,
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
    const tgrid = root.querySelector<HTMLElement>('#tower-grid');
    const pgrid = root.querySelector<HTMLElement>('#premium-grid');
    const vxNote = root.querySelector<HTMLElement>('#vx-note');
    const pitems = root.querySelector<HTMLElement>('#premium-items');
    const adNote = root.querySelector<HTMLElement>('#ad-note');
    const backBtn = root.querySelector<HTMLButtonElement>('#btn-shop-back');
    if (!coins || !grid || !tgrid || !pgrid || !vxNote || !pitems || !adNote || !backBtn) {
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
      this.watching = true;
      this.adNote.textContent = '';
      this.adNote.hidden = true;
      void this.watchAdForCoins().then((err) => {
        this.watching = false;
        const msg = err === null ? '' : adMessage(err);
        this.adNote.textContent = msg;
        this.adNote.hidden = msg.length === 0;
        this.render();
      });
    });
    this.adCard = ad;
    this.coins = coins;
    backBtn.addEventListener('click', back);

    this.towerCards = SHOP_TOWER_ORDER.map((kind) => {
      const el = this.buildTowerCard(kind);
      el.addEventListener('click', () => {
        this.pickTower(kind);
        this.render();
      });
      tgrid.appendChild(el);
      return { kind, el };
    });
    // 유료 타워는 유닛 유료 격자에 같이 넣는다 — 결제 흐름이 한 곳에 모여야 한다.
    this.premiumTowerCards = SHOP_PREMIUM_TOWER_ORDER.map((kind) => {
      const el = this.buildTowerCard(kind);
      el.addEventListener('click', () => {
        if (ownsTowerKind(this.getAccount(), kind)) {
          this.pickTower(kind);
          this.render();
          return;
        }
        void this.openVxShop(kind as PremiumItem).then((ok) => {
          if (!ok) this.vxNote.textContent = t().vxOpenFailed;
        });
      });
      pgrid.appendChild(el);
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
    // 쿨다운 남은 시간을 매초 갱신한다. 상점을 나가면 멈춘다 (`exit`).
    this.cooldownTimer ??= setInterval(() => this.refreshAdCooldown(), 1000);
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
    if (this.cooldownTimer !== null) {
      clearInterval(this.cooldownTimer);
      this.cooldownTimer = null;
    }
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

  private buildTowerCard(kind: TowerKind): HTMLButtonElement {
    const el = document.createElement('button');
    el.className = isPremiumTower(kind) ? 'unit-card unit-card-premium' : 'unit-card';
    el.id = `tower-${kind}`;
    // **그림을 판에서 쓰는 것과 같은 파일로 보여 준다.** 상점에서만 다른 그림을 쓰면
    // 산 뒤에 "이게 아닌데"가 된다. 크기는 종류와 무관하게 같다 — 판에서도 같기 때문이다
    // (`towers.ts` 의 크기 주석).
    el.innerHTML = `
      <span class="unit-art"><img alt="" src="${towerPreviewSrc(kind)}" height="${TOWER_ART_H}"></span>
      <span class="unit-name" data-role="name"></span>
      <span class="unit-tier"></span>
      <span class="unit-power" data-role="stats"></span>
      <span class="unit-blurb" data-role="blurb"></span>
      <span class="unit-state" data-role="state"></span>
    `;
    return el;
  }

  private render(): void {
    const a = this.getAccount();
    this.coins.textContent = a.coins.toLocaleString();

    // 타워 카드. 유닛과 갈라 둔 이유: 이름표(`data-role="tier"`)가 없고(레벨 표시가 없다),
    // 가격 칸 판정이 다르다(유료 타워는 코인 가격이 없다).
    const wornTower = towerKindOf(a);
    for (const { kind, el } of [...this.towerCards, ...this.premiumTowerCards]) {
      const meta = TOWER_KIND_META[kind];
      const owned = ownsTowerKind(a, kind);
      const equipped = kind === wornTower;
      set(el, 'name', towerLabelOf(kind));
      set(el, 'stats', t().towerStats(meta.speed));
      set(el, 'blurb', towerBlurbOf(kind));
      // 유닛 카드와 같은 규칙(`.unit-card.is-equipped`/`.is-owned`, 상태 칸의
      // `.locked`) — 시트에 없는 `.is-worn` 을 쓰면 착용 강조도 가격 흐림도 안 뜬다.
      el.classList.toggle('is-equipped', equipped);
      el.classList.toggle('is-owned', owned);

      if (isPremiumTower(kind)) {
        // 유료 칸. **`vxPrice(...) === null` 로 "준비 중"을 판정하면 안 된다** —
        // `vxPrice` 는 `isPremiumItem`(로컬 폴백 표 `VX_PRODUCTS` 에 키가 있는가)만
        // 보고 null 여부를 정하는데, `tower_prime` 이 그 표에 이미 올라 있어(가격
        // 폴백 500원) 대시보드 미등록 상태에서도 절대 null 이 안 나왔다 — "준비 중"이
        // 영영 안 뜨는 버그였다. **대시보드의 실시간 구매 가능 플래그**(`isPurchasable`)
        // 를 봐야 한다 — 유닛 유료 카드·배속 카드와 같은 규칙이다.
        const sellable = isPurchasable(kind as PremiumItem);
        set(el, 'state', equipped ? t().equipped : owned ? t().equip : sellable ? t().buyWithVx : t().comingSoon);
        el.querySelector('[data-role="state"]')?.classList.toggle('locked', !owned && !sellable);
        // 착용 중이거나(유닛과 같은 규칙), 안 가졌는데 아직 못 사는 상품이면 잠근다.
        el.disabled = equipped || (!owned && !sellable);
      } else {
        const affordable = owned || a.coins >= meta.price;
        set(el, 'state', equipped ? t().equipped : owned ? t().equip : `◈ ${meta.price.toLocaleString()}`);
        el.querySelector('[data-role="state"]')?.classList.toggle('locked', !affordable);
        // 착용 중인 카드는 누를 이유가 없다 (유닛 카드와 같은 규칙). 못 사는 카드도 잠근다.
        el.disabled = equipped || !affordable;
      }
    }

    // **이름·스탯·설명은 매번 다시 쓴다.** 카드는 생성자에서 한 번만 만들어지므로
    // 여기서 안 채우면 언어를 바꿔도 처음 언어가 그대로 남는다 — 실제로 그 버그를 냈다.
    for (const { kind, el } of [...this.unitCards, ...this.premiumCards]) {
      set(el, 'name', unitLabelOf(kind));
      set(el, 'stats', t().unitStats(UNIT_KIND_META[kind].power));
      set(el, 'blurb', unitBlurbOf(kind));
      // 판에서 머리 위에 찍히는 표식과 **개수도 색도 같다** — 상점과 화면이 다른 말을
      // 하면 무엇을 산 것인지 알 수가 없다 (`renderer.drawTierPips`).
      const tier = tierOf(kind);
      const pips = el.querySelector<HTMLElement>('[data-role="tier"]');
      if (pips) {
        const meta = UNIT_KIND_META[kind];
        const rainbow = meta.aura === 'rainbow';
        pips.classList.toggle('is-rainbow', rainbow);
        if (rainbow) {
          // **칸마다 색을 달리하려면 칸을 쪼개야 한다.** 텍스트 한 덩어리에는 색을
          // 하나밖에 못 준다. 칸 간격 42도는 판에서 쓰는 값과 같다 — 두 화면의
          // 무지개가 다르게 보이면 같은 물건으로 안 읽힌다.
          // 도는 것은 CSS 가 맡는다 (`.unit-tier.is-rainbow`).
          pips.replaceChildren(
            ...Array.from({ length: tier }, (_, i) => {
              const s = document.createElement('span');
              s.textContent = '◆';
              s.style.color = `hsl(${(i * 42) % 360}, 92%, 64%)`;
              return s;
            }),
          );
        } else {
          pips.textContent = '◆'.repeat(tier);
          pips.style.color = meta.accent ?? 'transparent';
        }
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
    this.refreshAdCooldown();
  }

  /**
   * 광고 쿨다운 남은 시간을 **버튼 안**(상태 칸)에 `MM:SS` 로 반영한다. 매초 틱
   * (`cooldownTimer`)과 `render` 양쪽에서 부른다. 쿨다운 안내는 별도 노트(`ad-note`)가
   * 아니라 버튼 안에 들어간다 (2026-08-04 사용자 지시) — 노트는 성공·실패 문구 전용.
   *
   * **광고를 보는 중(`watching`)에는 손대지 않는다** — 그때 버튼은 이미 잠겨 있고,
   * 쿨다운이 0이라고 여기서 다시 켜면 재생 도중 두 번 눌린다.
   */
  private refreshAdCooldown(): void {
    if (this.watching) return;
    const remain = AD_COOLDOWN_MS - (Date.now() - this.getAccount().adAt);
    if (remain > 0) {
      this.adCard.disabled = true;
      set(this.adCard, 'state', `⏳ ${mmss(remain)}`);
    } else {
      this.adCard.disabled = false;
      // 쿨다운이 끝났으면 상태 칸을 원래 문구("보기")로 되돌린다. 틱에서는 render 가
      // 안 도므로 여기서 직접 써 줘야 한다.
      set(this.adCard, 'state', t().adCardAction);
    }
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

/** 남은 ms 를 `M:SS` 로. 30분 쿨다운이라 분·초가 다 필요하다. 숫자뿐이라 번역 불필요. */
function mmss(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
