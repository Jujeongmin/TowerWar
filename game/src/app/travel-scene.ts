/**
 * 스테이지 사이 전차 이동 연출 (2026-11-24 사용자 요청: "다음 스테이지로 전차를 타고 이동").
 *
 * 그림은 전부 Codex 로 그린 것이다 — 장별 가로 파노라마(`assets/travel/chN.webp`, 길이 74% 높이에
 * 수평으로 깔려 있음)와 옆모습 전차(`assets/fx/tank.png`). 코드는 카메라와 전차를 옮기기만 한다.
 *
 *   출발 깃발(지금 판) ── 전차가 길을 따라 달린다 ──▶ 도착 깃발(다음 판) → 배너 → 판 시작
 *
 * 화면을 누르면 건너뛴다. 장이 바뀌면(1-5 → 2-1) 새 장의 배경과 장 이름을 보여 준다.
 */
import { STAGES_PER_CHAPTER, stageLabel } from '../campaign/stages';
import { audio } from '../audio';
import { chapterName, tx } from '../i18n-cg';
import type { Scene } from './scene';

/** 그림 원본 크기와 길 위치(높이 비율). */
const BG_W = 1440;
const BG_H = 720;
/** 장별 그림에서 길(전차 바퀴가 닿는 선)의 높이 비율. 그림마다 달라 눈으로 맞췄다. */
const ROAD_Y: Record<number, number> = { 1: 0.84, 2: 0.8, 3: 0.92, 4: 0.93 };
/** 전차가 달리는 시간(초)과 도착 뒤 배너를 보여 주는 시간. */
const DRIVE_SEC = 2.3;
const ARRIVE_SEC = 0.9;

export class TravelScene implements Scene {
  private t = 0;
  private done: (() => void) | null = null;
  private finished = false;
  private readonly strip: HTMLElement;
  private readonly bg: HTMLImageElement;
  private readonly tank: HTMLImageElement;
  private readonly from: HTMLElement;
  private readonly to: HTMLElement;
  private readonly banner: HTMLElement;
  private worldW = 1;
  private scale = 1;
  private fromX = 0;
  private toX = 0;
  private chapter = 1;

  constructor(private readonly root: HTMLElement) {
    const q = <T extends HTMLElement>(s: string): T => {
      const f = root.querySelector<T>(s);
      if (!f) throw new Error(`이동 연출 DOM: ${s}`);
      return f;
    };
    this.strip = q('.tv-strip');
    this.bg = q('.tv-bg');
    this.tank = q('.tv-tank');
    this.from = q('.tv-from');
    this.to = q('.tv-to');
    this.banner = q('.tv-banner');
    root.addEventListener('pointerdown', () => this.finish());
  }

  /** 다음에 `enter()` 할 때 보여 줄 이동. `stage` 는 도착할 판(1~20). */
  prepare(stage: number, onDone: () => void): void {
    const chapter = Math.floor((stage - 1) / STAGES_PER_CHAPTER) + 1;
    this.chapter = chapter;
    const newChapter = (stage - 1) % STAGES_PER_CHAPTER === 0;
    this.bg.src = `./assets/travel/ch${chapter}.webp`;
    this.from.textContent = stage > 1 && !newChapter ? stageLabel(stage - 1) : '★';
    this.to.textContent = stageLabel(stage);
    this.banner.querySelector('.tv-ch')!.textContent = `${tx('chapter', chapter)} · ${chapterName(chapter)}`;
    this.banner.querySelector('.tv-stage')!.textContent = tx('arrived', stageLabel(stage));
    this.root.classList.toggle('is-new-chapter', newChapter);
    this.done = onDone;
  }

  enter(): void {
    this.t = 0;
    this.finished = false;
    this.root.hidden = false;
    this.root.classList.remove('is-arrived');
    // 화면 높이에 맞춰 파노라마를 키운다. 판(#app)은 디자인 크기 고정이라 한 번 재면 된다.
    const h = this.root.clientHeight || 736;
    const vw = this.root.clientWidth || 414;
    // 높이에 맞추되, 넓은 화면(PC 전체 창)에서는 폭이 모자라지 않게 폭 기준도 본다.
    this.scale = Math.max(h / BG_H, (vw * 1.6) / BG_W);
    this.worldW = BG_W * this.scale;
    this.strip.style.width = `${this.worldW}px`;
    this.strip.style.height = `${h}px`;
    const roadY = h * (ROAD_Y[this.chapter] ?? 0.82);
    this.fromX = this.worldW * 0.16;
    this.toX = this.worldW * 0.82;
    for (const [el, x] of [[this.from, this.fromX], [this.to, this.toX]] as const) {
      el.style.left = `${x}px`;
      el.style.top = `${roadY}px`;
    }
    this.tank.style.top = `${roadY}px`;
    audio.play('tank');
    this.place(0);
  }

  exit(): void {
    this.root.hidden = true;
  }

  frame(dt: number): void {
    if (this.finished) return;
    this.t += dt;
    const k = Math.min(1, this.t / DRIVE_SEC);
    this.place(k);
    if (k >= 1 && !this.root.classList.contains('is-arrived')) this.root.classList.add('is-arrived');
    if (this.t >= DRIVE_SEC + ARRIVE_SEC) this.finish();
  }

  /** k = 0~1 진행도. 출발과 도착에서 부드럽게 서고, 카메라는 전차를 따라간다. */
  private place(k: number): void {
    const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
    const x = this.fromX + (this.toX - this.fromX) * e;
    const viewW = this.root.clientWidth || 414;
    const cam = Math.max(0, Math.min(this.worldW - viewW, x - viewW * 0.45));
    this.strip.style.transform = `translateX(${-cam}px)`;
    const bob = Math.sin(this.t * 22) * (k < 1 ? 1.6 : 0);
    const tilt = Math.sin(this.t * 11) * (k < 1 ? 1.2 : 0);
    this.tank.style.transform = `translate(${x - cam}px, ${bob}px) translate(-50%, -88%) rotate(${tilt}deg)`;
  }

  private finish(): void {
    if (this.finished) return;
    this.finished = true;
    const cb = this.done;
    this.done = null;
    cb?.();
  }
}
