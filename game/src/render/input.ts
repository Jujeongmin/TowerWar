/**
 * 포인터 입력 → Command 변환.
 *
 * 제스처는 셋이다:
 *   내 타워에서 시작 → 드래그(경로 개설/차단) / 탭(레벨업)
 *   빈 공간에서 시작 → 스와이프(가로지른 내 경로 절단)
 *
 * 이 파일은 제스처 판별만 하고, 유효성 검사는 전부 시뮬레이션에 맡긴다.
 * (병력이 모자란 레벨업이나 타워에 막힌 경로는 sim이 조용히 무시한다 —
 *  판정이 두 곳에 있으면 화면과 실제가 어긋난다.)
 */
import { capacityOf, towerRadiusOf } from '../sim/config';
import { segmentsIntersect, type Vec } from '../sim/geometry';
import type { Command, MatchState, PlayerId } from '../sim/types';
import { type Renderer, type UiState } from './renderer';

/** 이 거리를 넘어가면 탭이 아니라 드래그로 본다(논리 좌표 기준). */
const DRAG_THRESHOLD = 14;
/** 스와이프 궤적에 점을 추가하는 최소 간격. 촘촘하면 교차 판정만 무거워진다. */
const CUT_SAMPLE_DIST = 7;
/** 궤적 길이 상한. 화면을 휘저어도 메모리와 판정 비용이 폭주하지 않게 막는다. */
const CUT_MAX_POINTS = 80;

export class InputController {
  readonly ui: UiState;

  private downPos: Vec = { x: 0, y: 0 };
  private moved = false;
  /** 빈 공간에서 시작했는가 = 절단 스와이프인가. */
  private cutting = false;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly renderer: Renderer,
    private readonly getState: () => MatchState,
    private readonly emit: (cmd: Command) => void,
    local: PlayerId = 1,
  ) {
    this.ui = {
      local,
      dragFrom: null,
      pointer: null,
      dragTarget: null,
      cutPath: [],
      cutRoutes: [],
    };

    canvas.addEventListener('pointerdown', this.onDown);
    canvas.addEventListener('pointermove', this.onMove);
    canvas.addEventListener('pointerup', this.onUp);
    canvas.addEventListener('pointercancel', this.onCancel);
    canvas.addEventListener('contextmenu', this.onContextMenu);
  }

  /**
   * 붙인 리스너를 전부 뗀다. 씬을 나갈 때 반드시 부를 것.
   *
   * 안 떼면 로비를 다녀올 때마다 리스너가 쌓여 드래그 한 번에 같은 Command가
   * 여러 개 나간다. 경로 토글은 짝수 번이면 없던 일이 되므로 증상이 "가끔 안 먹힘"으로
   * 나타나 원인을 찾기 어렵다.
   */
  dispose(): void {
    this.canvas.removeEventListener('pointerdown', this.onDown);
    this.canvas.removeEventListener('pointermove', this.onMove);
    this.canvas.removeEventListener('pointerup', this.onUp);
    this.canvas.removeEventListener('pointercancel', this.onCancel);
    this.canvas.removeEventListener('contextmenu', this.onContextMenu);
    this.reset();
  }

  private onContextMenu = (e: Event): void => {
    e.preventDefault();
  };

  private onDown = (e: PointerEvent): void => {
    // 승부가 난 뒤의 재시작은 결과 화면의 DOM 버튼이 맡는다.
    // 여기서 아무 데나 눌러 재시작시키면 [로비로] 버튼을 누를 수가 없다.
    if (this.getState().winner !== null) return;

    this.canvas.setPointerCapture(e.pointerId);
    const p = this.renderer.toLogical(e.clientX, e.clientY);
    this.ui.pointer = p;
    this.downPos = p;
    this.moved = false;

    const t = this.hitTower(p);
    if (t !== null && this.getState().towers[t].owner === this.ui.local) {
      this.ui.dragFrom = t;
      return;
    }

    // 타워 밖에서 시작 = 경로를 자르려는 스와이프
    this.cutting = true;
    this.ui.cutPath = [p];
  };

  private onMove = (e: PointerEvent): void => {
    const p = this.renderer.toLogical(e.clientX, e.clientY);
    this.ui.pointer = p;

    if (Math.hypot(p.x - this.downPos.x, p.y - this.downPos.y) > DRAG_THRESHOLD) {
      this.moved = true;
    }

    if (this.cutting) {
      this.extendCut(p);
      return;
    }

    if (this.ui.dragFrom !== null && this.moved) {
      const t = this.hitTower(p);
      this.ui.dragTarget = t !== null && t !== this.ui.dragFrom ? t : null;
    }
  };

  private onUp = (): void => {
    if (this.cutting) {
      this.commitCut();
      this.reset();
      return;
    }

    const from = this.ui.dragFrom;
    if (from !== null) {
      if (this.moved && this.ui.dragTarget !== null) {
        this.emit({
          kind: 'toggleRoute',
          player: this.ui.local,
          fromId: from,
          toId: this.ui.dragTarget,
        });
      }
      // 전에는 여기서 탭이 레벨업 명령을 냈다. 레벨업이 사라져(2026-07-30)
      // 내 타워를 그냥 탭하는 것은 아무 일도 하지 않는다.
    }
    this.reset();
  };

  private onCancel = (): void => {
    this.reset();
  };

  // ── 경로 절단 ───────────────────────────────────────────────────

  private extendCut(p: Vec): void {
    const path = this.ui.cutPath;
    const last = path[path.length - 1];
    if (last && Math.hypot(p.x - last.x, p.y - last.y) < CUT_SAMPLE_DIST) return;

    path.push(p);
    if (path.length > CUT_MAX_POINTS) path.shift();

    this.ui.cutRoutes = this.routesCrossedByCut();
  }

  /**
   * 스와이프 궤적이 가로지른 "내" 경로들.
   * 적 경로는 자를 수 없다 — 그럴 수 있으면 상대 보급선을 공짜로 끊는 셈이라 게임이 망가진다.
   */
  private routesCrossedByCut(): number[] {
    const state = this.getState();
    const path = this.ui.cutPath;
    if (path.length < 2) return [];

    const hit: number[] = [];
    for (const r of state.routes) {
      if (r.owner !== this.ui.local) continue;
      const a = state.towers[r.fromId];
      const b = state.towers[r.toId];
      if (!a || !b) continue;

      for (let i = 1; i < path.length; i++) {
        if (segmentsIntersect(path[i - 1], path[i], a, b)) {
          hit.push(r.id);
          break;
        }
      }
    }
    return hit;
  }

  private commitCut(): void {
    const state = this.getState();
    for (const id of this.ui.cutRoutes) {
      const r = state.routes.find((x) => x.id === id);
      if (!r) continue;
      this.emit({
        kind: 'toggleRoute',
        player: this.ui.local,
        fromId: r.fromId,
        toId: r.toId,
      });
    }
  }

  // ── 공통 ────────────────────────────────────────────────────────

  private hitTower(p: Vec): number | null {
    const state = this.getState();
    let best: number | null = null;
    let bestD = Infinity;
    for (const t of state.towers) {
      const d = Math.hypot(t.x - p.x, t.y - p.y);
      // 손가락 조작을 감안해 실제 반경보다 넉넉하게 잡는다
      if (d <= towerRadiusOf(t) + 16 && d < bestD) {
        bestD = d;
        best = t.id;
      }
    }
    return best;
  }

  private reset(): void {
    this.ui.dragFrom = null;
    this.ui.dragTarget = null;
    this.ui.cutPath = [];
    this.ui.cutRoutes = [];
    this.moved = false;
    this.cutting = false;
  }

  /** 상한에 걸린 내 타워가 있는지 — 메인 루프가 힌트를 띄우는 데 쓴다. */
  hasCappedTower(): boolean {
    const state = this.getState();
    return state.towers.some((t) => t.owner === this.ui.local && t.troops >= capacityOf(t) - 0.5);
  }
}
