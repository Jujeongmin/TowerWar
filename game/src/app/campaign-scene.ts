/**
 * 캠페인 — 작전 지도. DOM만 쓴다 (`lobby-scene.ts` 와 같은 이유). 맵 미리보기 한 장만
 * 작은 캔버스에 그린다.
 *
 * 구성 (위에서 아래로):
 *   머리줄  — 뒤로 · 제목 · 코인
 *   진행도  — 깬 판 수와 20칸 막대
 *   장 탭   — 4장. 첫 판이 안 열린 장은 잠김
 *   작전로  — 그 장의 5판을 잇는 경로. 5번째가 보스
 *   브리핑  — 고른 판의 실제 배치 미리보기 · 적 유닛/타워 · 내 전력과 비교 · 보상 · [출격]
 *
 * **순서대로만 열린다** — 깬 마지막 판 + 1 까지 (`canPlayStage`, 서버의 `startCampaign` 과
 * 같은 규칙). 잠긴 판도 고르면 브리핑은 보여 준다 — 무엇이 기다리는지 보여야 앞 판을
 * 깰 이유가 생긴다. [출격]만 막는다.
 */
import { canPlayStage, modsFor, type Account } from '../account/account';
import {
  CAMPAIGN_REPLAY_WIN,
  STAGES,
  STAGES_PER_CHAPTER,
  stageLabel,
  stageOf,
  type Stage,
} from '../campaign/stages';
import { FIELD_H, FIELD_W } from '../sim/config';
import { t } from '../i18n';
import { spriteKindOf, unitLabelOf, unitPowerOf } from '../units';
import { TOWER_KIND_META, towerLabelOf, towerSpeedOf, towerSpriteKindOf } from '../towers';
import type { Scene } from './scene';

const CHAPTERS = Math.ceil(STAGES.length / STAGES_PER_CHAPTER);

/**
 * 그림 경로 (2026-11-24 캠페인 화면 개편: 점·선 대신 게임 그림을 쓴다 — 사용자: "코드로 만든 성의없는 UI").
 * 지도 칸 배경 = 장별 이동 파노라마, 노드 = 실제 타워 그림, 미리보기 = 전장 바닥 + 타워 그림.
 */
const ASSET = '/assets';
const travelSrc = (chapter: number) => `${ASSET}/travel/ch${chapter}.webp`;
const fieldSrc = (chapter: number) => `${ASSET}/field/ch${chapter}.webp`;
const towerArt = (side: 'p1' | 'p2' | 'neutral', kind: Parameters<typeof towerSpriteKindOf>[0]) =>
  `${ASSET}/tower/${side}/${TOWER_KIND_META[towerSpriteKindOf(kind)].art}.png`;
const imgCache = new Map<string, HTMLImageElement>();
function cachedImg(src: string, onload: () => void): HTMLImageElement {
  let img = imgCache.get(src);
  if (!img) {
    img = new Image();
    img.src = src;
    imgCache.set(src, img);
  }
  if (!img.complete) img.addEventListener('load', onload, { once: true });
  return img;
}

/**
 * 작전로 위 노드 자리(%). 왼쪽 아래에서 시작해 지그재그로 오른쪽 보스까지 간다.
 * 칸 수가 장당 5판에 맞춰져 있다 — `STAGES_PER_CHAPTER` 를 바꾸면 같이 고칠 것.
 */
const NODE_POS: readonly { x: number; y: number }[] = [
  { x: 11, y: 68 },
  { x: 31, y: 32 },
  { x: 50, y: 68 },
  { x: 69, y: 32 },
  { x: 88, y: 56 },
];

/** 진영색. 판의 렌더러와 같은 값이다 — 미리보기가 실제 판과 같은 색이어야 읽힌다. */
const COLOR_ME = '#3fbdf1';
const COLOR_ENEMY = '#f2555f';
const COLOR_NEUTRAL = '#8796a3';

/** 적 그림. 판에서 쓰는 P2(빨강) 파일 그대로다. */
function enemyUnitSrc(stage: Stage): string {
  return `/assets/unit/p2/${spriteKindOf(stage.botUnit)}/run0.png`;
}
function enemyTowerSrc(stage: Stage): string {
  return `/assets/tower/p2/${TOWER_KIND_META[towerSpriteKindOf(stage.botTower)].art}.png`;
}

function chapterOf(n: number): number {
  return Math.floor((n - 1) / STAGES_PER_CHAPTER);
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export class CampaignScene implements Scene {
  private readonly coins: HTMLElement;
  private readonly progressText: HTMLElement;
  private readonly progressBar: HTMLElement;
  private readonly tabs: HTMLElement;
  private readonly track: HTMLElement;
  private readonly brief: HTMLElement;
  /** 지금 고른 판. 들어올 때마다 "지금 할 판"으로 다시 맞춘다. */
  private selected = 1;
  /** 지금 보고 있는 장(0부터). 판을 고르면 그 판의 장으로 따라간다. */
  private chapter = 0;

  constructor(
    private readonly root: HTMLElement,
    private readonly getAccount: () => Account,
    /** 스테이지를 골랐다. 판을 여는 쪽(main.ts)이 서버 시작 기록까지 맡는다. */
    private readonly play: (stage: number) => void,
    back: () => void,
  ) {
    const q = <T extends HTMLElement>(s: string): T => {
      const found = root.querySelector<T>(s);
      if (!found) throw new Error(`캠페인 DOM이 예상과 다릅니다: ${s}`);
      return found;
    };
    this.coins = q('#campaign-coins');
    this.progressText = q('#campaign-progress');
    this.progressBar = q('#campaign-progress-bar');
    this.tabs = q('#campaign-tabs');
    this.track = q('#campaign-track');
    this.brief = q('#campaign-brief');
    q<HTMLButtonElement>('#btn-campaign-back').addEventListener('click', back);
  }

  enter(): void {
    const a = this.getAccount();
    // 지금 할 판을 고른 채로 연다. 다 깼으면 마지막 판(보스)에 둔다.
    this.selected = Math.min(a.campaignCleared + 1, STAGES.length);
    this.chapter = chapterOf(this.selected);
    this.root.hidden = false;
    this.render();
  }

  exit(): void {
    this.root.hidden = true;
  }

  frame(): void {
    // DOM이 알아서 그려진다.
  }

  /** 계정·선택이 바뀔 때마다 통째로 다시 그린다. 칸이 20개뿐이라 부분 갱신할 이유가 없다. */
  private render(): void {
    const a = this.getAccount();
    this.coins.textContent = a.coins.toLocaleString();
    this.renderProgress(a);
    this.renderTabs(a);
    this.renderTrack(a);
    this.renderBrief(a);
  }

  private renderProgress(a: Account): void {
    this.progressText.textContent = t().campaignProgress(a.campaignCleared, STAGES.length);
    this.progressBar.replaceChildren(
      ...STAGES.map((st) => {
        const seg = el('i');
        if (st.n <= a.campaignCleared) seg.className = 'is-done';
        else if (canPlayStage(a, st.n)) seg.className = 'is-next';
        return seg;
      }),
    );
  }

  private renderTabs(a: Account): void {
    const names = t().campaignChapterNames;
    this.tabs.replaceChildren(
      ...Array.from({ length: CHAPTERS }, (_, c) => {
        const first = c * STAGES_PER_CHAPTER + 1;
        const last = Math.min(first + STAGES_PER_CHAPTER - 1, STAGES.length);
        const open = canPlayStage(a, first);
        const done = a.campaignCleared >= last;
        const b = el('button', 'cmp-tab');
        b.type = 'button';
        b.setAttribute('role', 'tab');
        b.setAttribute('aria-selected', String(c === this.chapter));
        if (c === this.chapter) b.classList.add('is-active');
        if (!open) b.classList.add('is-locked');
        if (done) b.classList.add('is-done');
        b.style.setProperty('--tab-art', `url(${travelSrc(c + 1)})`);
        b.append(
          el('span', 'cmp-tab-no', String(c + 1).padStart(2, '0')),
          el('span', 'cmp-tab-name', names[c] ?? t().campaignChapter(c + 1)),
        );
        b.addEventListener('click', () => {
          if (c === this.chapter) return;
          this.chapter = c;
          // 그 장에서 할 판(없으면 첫 판)으로 고른다.
          const cur = this.getAccount();
          const target = Math.min(Math.max(cur.campaignCleared + 1, first), last);
          this.selected = chapterOf(target) === c ? target : first;
          this.render();
        });
        return b;
      }),
    );
  }

  private renderTrack(a: Account): void {
    const first = this.chapter * STAGES_PER_CHAPTER + 1;
    const stages = STAGES.slice(first - 1, first - 1 + STAGES_PER_CHAPTER);

    // 노드를 잇는 선. 깬 구간은 실선, 남은 구간은 점선이다.
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'cmp-path');
    svg.setAttribute('viewBox', '0 0 100 100');
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < stages.length - 1; i++) {
      const p = NODE_POS[i];
      const q = NODE_POS[i + 1];
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', String(p.x));
      line.setAttribute('y1', String(p.y));
      line.setAttribute('x2', String(q.x));
      line.setAttribute('y2', String(q.y));
      line.setAttribute('vector-effect', 'non-scaling-stroke');
      line.setAttribute('class', stages[i].n <= a.campaignCleared ? 'is-done' : '');
      svg.append(line);
    }

    const nodes = stages.map((st, i) => {
      const boss = i === STAGES_PER_CHAPTER - 1;
      const cleared = st.n <= a.campaignCleared;
      const open = canPlayStage(a, st.n);
      const b = el('button', 'cmp-node');
      b.type = 'button';
      b.style.left = `${NODE_POS[i].x}%`;
      b.style.top = `${NODE_POS[i].y}%`;
      if (boss) b.classList.add('is-boss');
      if (cleared) b.classList.add('is-cleared');
      else if (open) b.classList.add('is-next');
      else b.classList.add('is-locked');
      if (st.n === this.selected) b.classList.add('is-selected');
      b.setAttribute('aria-label', `${t().campaignEnemy(stageLabel(st.n))}${open ? '' : ` — ${t().campaignLocked}`}`);
      b.setAttribute('aria-pressed', String(st.n === this.selected));

      const face = el('span', 'cmp-node-face');
      const art = el('img', 'cmp-node-art');
      art.alt = '';
      art.src = boss
        ? towerArt('p2', 'tower_citadel')
        : cleared
          ? towerArt('p1', 'tower_house')
          : open
            ? towerArt('p1', 'tower_hut')
            : towerArt('neutral', 'tower_hut');
      face.append(art);
      b.append(face, el('span', 'cmp-node-no', stageLabel(st.n)));
      if (boss) b.append(el('span', 'cmp-node-tag', t().campaignBoss));
      if (cleared) b.append(el('span', 'cmp-node-check', '✓'));
      b.addEventListener('click', () => {
        this.selected = st.n;
        this.render();
      });
      return b;
    });

    this.track.style.setProperty('--track-art', `url(${travelSrc(this.chapter + 1)})`);
    const label = el('span', 'cmp-track-label', `CHAPTER ${String(this.chapter + 1).padStart(2, '0')}`);
    label.setAttribute('aria-hidden', 'true');
    this.track.replaceChildren(svg, label, ...nodes);
  }

  private renderBrief(a: Account): void {
    const st = stageOf(this.selected) ?? STAGES[0];
    const cleared = st.n <= a.campaignCleared;
    const open = canPlayStage(a, st.n);
    const boss = (st.n - 1) % STAGES_PER_CHAPTER === STAGES_PER_CHAPTER - 1;

    // ── 머리줄: 판 이름 + 상태 ──
    const head = el('div', 'cmp-brief-head');
    const title = el('div', 'cmp-brief-title');
    title.append(
      el('span', 'cmp-brief-kicker', `OPERATION ${stageLabel(st.n)}`),
      el('strong', '', t().campaignEnemy(stageLabel(st.n))),
    );
    const chip = el(
      'span',
      `cmp-chip ${cleared ? 'is-done' : open ? 'is-open' : 'is-locked'}`,
      cleared ? t().campaignStatusCleared : open ? t().campaignStatusOpen : t().campaignLocked,
    );
    head.append(title);
    if (boss) head.append(el('span', 'cmp-chip is-boss', t().campaignBoss));
    head.append(chip);

    // ── 본문: 왼쪽 지도, 오른쪽 정보 ──
    const body = el('div', 'cmp-brief-body');
    const mapBox = el('div', 'cmp-map');
    const canvas = el('canvas');
    mapBox.append(canvas, el('span', 'cmp-map-label', t().campaignMapIntel));

    const intel = el('div', 'cmp-intel');
    const enemyPower = unitPowerOf(st.botUnit);
    const enemySpeed = st.botSpeed ?? towerSpeedOf(st.botTower);
    intel.append(
      this.intelRow(t().campaignEnemyUnit, enemyUnitSrc(st), unitLabelOf(st.botUnit), t().unitStats(enemyPower)),
      this.intelRow(t().campaignEnemyTower, enemyTowerSrc(st), towerLabelOf(st.botTower), t().towerStats(enemySpeed)),
    );
    const bases = st.spots.filter((s) => s[2] === 2).length;
    const neutrals = st.spots.filter((s) => s[2] === 0).length;
    intel.append(el('p', 'cmp-intel-count', t().campaignForces(bases, neutrals)));

    // 내 전력과 비교. **충돌은 `min(power)` 라 한 단계라도 높은 쪽이 이긴다** —
    // 그래서 유닛을 먼저 본다 (`difficulty.ts` 의 `botUnitKindFor` 주석).
    const mine = modsFor(a);
    const advice =
      enemyPower > mine.unitPower
        ? { cls: 'is-warn', text: t().campaignAdviceUnit }
        : enemySpeed > mine.speedMul
          ? { cls: 'is-warn', text: t().campaignAdviceTower }
          : { cls: 'is-ok', text: t().campaignAdviceOk };
    intel.append(el('p', `cmp-advice ${advice.cls}`, advice.text));
    body.append(mapBox, intel);

    // ── 발밑: 보상 + 출격 ──
    const foot = el('div', 'cmp-brief-foot');
    const reward = el('div', 'cmp-reward');
    reward.append(
      el('span', 'cmp-reward-label', cleared ? t().campaignRewardReplay : t().campaignRewardFirst),
      el('span', 'coins', (cleared ? CAMPAIGN_REPLAY_WIN : st.firstClear).toLocaleString()),
    );
    const go = el('button', 'btn btn-primary cmp-deploy', open ? t().campaignDeploy : t().campaignLockedHint);
    go.type = 'button';
    go.disabled = !open;
    go.addEventListener('click', () => {
      if (canPlayStage(this.getAccount(), st.n)) this.play(st.n);
    });
    foot.append(reward, go);

    this.brief.classList.toggle('is-boss', boss);
    this.brief.replaceChildren(head, body, foot);
    // 캔버스는 DOM에 붙은 뒤에야 크기를 잴 수 있다.
    this.drawMap(canvas, st);
  }

  private intelRow(label: string, src: string, name: string, stat: string): HTMLElement {
    const row = el('div', 'cmp-intel-row');
    const art = el('span', 'cmp-intel-art');
    const img = el('img');
    img.alt = '';
    img.src = src;
    // 그림이 없으면(에셋 없는 클론) 칸만 남긴다 — 판의 폴백과 같은 규칙.
    img.addEventListener('error', () => img.remove(), { once: true });
    art.append(img);
    const text = el('span', 'cmp-intel-text');
    text.append(el('span', 'cmp-intel-label', label), el('strong', '', name), el('span', 'cmp-intel-stat', stat));
    row.append(art, text);
    return row;
  }

  /**
   * 실제 배치를 작게 그린다. 판의 좌표계 그대로다 — **아래가 나, 위가 적.**
   * 숫자는 시작 병력이다. 무엇을 먼저 먹을지가 여기서 읽힌다.
   */
  private drawMap(canvas: HTMLCanvasElement, st: Stage): void {
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    const sx = w / FIELD_W;
    const sy = h / FIELD_H;

    // 바닥 = 그 장의 전장 그림, 타워 = 판에서 쓰는 그림 (점·격자 대신).
    const redraw = () => {
      if (canvas.isConnected) this.drawMap(canvas, st);
    };
    const chapter = chapterOf(st.n) + 1;
    const ground = cachedImg(fieldSrc(chapter), redraw);
    if (ground.complete && ground.naturalWidth) ctx.drawImage(ground, 0, 0, w, h);
    else {
      ctx.fillStyle = '#6fae3c';
      ctx.fillRect(0, 0, w, h);
    }
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.fillRect(0, h / 2 - 0.5, w, 1);
    const r = Math.max(7, Math.min(12, w / 11));
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `900 ${Math.round(r * 0.8)}px ui-sans-serif, system-ui, sans-serif`;
    for (const [x, y, owner] of st.spots) {
      const side = owner === 1 ? 'p1' : owner === 2 ? 'p2' : 'neutral';
      const kind = owner === 2 ? st.botTower : 'tower_hut';
      const img = cachedImg(towerArt(side, kind), redraw);
      const cx = x * sx;
      const cy = y * sy;
      if (img.complete && img.naturalWidth) {
        const ih = r * 2.6;
        const iw = (img.naturalWidth / img.naturalHeight) * ih;
        ctx.drawImage(img, cx - iw / 2, cy - ih * 0.8, iw, ih);
      } else {
        ctx.fillStyle = owner === 1 ? COLOR_ME : owner === 2 ? COLOR_ENEMY : COLOR_NEUTRAL;
        ctx.beginPath();
        ctx.arc(cx, cy, r * 0.7, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    for (const [x, y, owner, troops] of st.spots) {
      const cx = x * sx;
      const cy = y * sy + r * 0.55;
      ctx.fillStyle = 'rgba(14,39,66,0.85)';
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.62, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = owner === 1 ? COLOR_ME : owner === 2 ? COLOR_ENEMY : '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.fillText(String(troops), cx, cy + 0.5);
    }
  }
}
