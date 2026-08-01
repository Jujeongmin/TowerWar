/**
 * 캔버스 2D 렌더러. 상태를 읽기만 하고 절대 바꾸지 않는다.
 *
 * 표현 규칙 하나만 지킨다: 플레이어가 판단에 필요한 정보는 전부 화면에 있어야 한다.
 * 이 게임에서 그건 세 가지다 —
 *   1) 재고가 몇 개의 경로를 열 수 있는가 (타워 아래 슬롯 표시)
 *   2) 지금 재고가 쌓이는 중인가 흘러나가는 중인가 (경로 유무 + 상한 경고)
 *   3) 이 경로를 왜 못 긋는가 (막고 있는 타워를 짚어줌)
 *
 * 누를 수 있는 것은 DOM이 맡는다. 로비·결과 화면의 버튼은 여기서 그리지 않는다 —
 * 캔버스에 버튼을 그리면 히트테스트를 손으로 짜야 하고, 버튼이 늘수록 그 비용이
 * 선형으로 늘어난다.
 */
import {
  FIELD_H,
  FIELD_W,
  MATCH_TIME,
  ROUTE_SLOT_MAX,
  TICK_DT,
  TOWER_CAP,
  routeSlotsFor,
  towerRadiusOf,
} from '../sim/config';
import { type Vec } from '../sim/geometry';
import { routeBlockedBy, towerCount, unitPosition, unitProgressRate } from '../sim/sim';
import type { MatchState, Owner, PlayerId, Route, TickEvents, Tower } from '../sim/types';
import { DEFAULT_PROFILE, profileBg, type ProfileId } from '../profiles';
import { DEFAULT_UNIT_KIND, UNIT_KIND_META, sizeFactorOf, type UnitKind } from '../units';
import { t } from '../i18n';
import { Profiles } from './profiles';
import { Sprites, type UnitDir } from './sprites';

export interface UiState {
  local: PlayerId;
  /** 드래그 중인 출발 타워. */
  dragFrom: number | null;
  /** 논리 좌표 기준 포인터 위치. */
  pointer: Vec | null;
  /** 드래그가 걸린 유효 목표 타워. */
  dragTarget: number | null;
  /** 빈 공간에서 시작한 절단 스와이프 궤적(논리 좌표). */
  cutPath: Vec[];
  /** 지금 손을 떼면 끊길 내 경로의 id. 미리 붉게 보여준다. */
  cutRoutes: number[];
}

interface Effect {
  kind: 'capture' | 'clash';
  x: number;
  y: number;
  age: number;
  life: number;
  color: string;
}

const BG = '#0b1017';

/**
 * 위험·취소 계열 표시색(절단 궤적, 끊길 경로, 거부된 레벨업).
 *
 * P2가 빨강이 되면서 붉은색을 여기 쓸 수 없게 됐다 — 적 색과 "이건 취소된다"는 신호가
 * 같은 색이면 화면에서 구분이 안 된다. 그래서 호박색으로 옮겼다.
 */
const CUT_COLOR = '#fbbf24';

/**
 * 진영색. 이 표가 경로·유닛 배지·HUD의 색을 결정한다.
 *
 * 건물 스프라이트 색은 Tiny Swords 원본에 구워져 있어 이 표를 바꿔도 안 따라온다
 * (에셋을 다시 뽑아야 한다). 값은 실제 스프라이트에서 샘플링해 맞췄다.
 */
const OWNER_COLOR: Record<Owner, { main: string; fill: string; dim: string }> = {
  0: { main: '#8b9bb0', fill: '#222c39', dim: 'rgba(139,155,176,0.35)' },
  1: { main: '#3fbdf1', fill: '#0d3a52', dim: 'rgba(63,189,241,0.35)' },
  2: { main: '#f2555f', fill: '#4d1116', dim: 'rgba(242,85,95,0.35)' },
};

/**
 * 건물 높이 = 타워 지름 × 이 값.
 *
 * Tiny Swords 건물은 위에서 비스듬히 본 그림이라 세로가 길다. 그래서 이전 Kenney
 * 정탑다운 스프라이트처럼 원 안에 욱여넣지 않고, **바닥을 타워 지점에 대고 세운다.**
 * 재고 링과 숫자는 그 발치에 남아 타워의 실제 위치를 계속 가리킨다.
 */
const TOWER_SPRITE_H = 1.85;

/**
 * 건물 폭 상한 = 타워 지름 × 이 값.
 *
 * 높이만 맞추면 가로로 넓은 건물(성채는 312×208)이 지름의 2.8배까지 벌어져 경로를 덮는다.
 * 두 상한 중 더 빡빡한 쪽을 쓴다.
 */
const TOWER_SPRITE_W = 1.75;

/** 건물 바닥이 타워 중심에서 아래로 얼마나 내려가는가 (반경 배수). */
const TOWER_FOOT = 0.55;

/** 바닥에 눕힌 원의 납작한 정도. 3/4 시점 건물과 같은 각도로 보이게 맞춘 값. */
const GROUND_SQUASH = 0.42;

/** HUD 아바타 반지름(화면 px). HUD는 논리 좌표가 아니라 화면 좌표로 그린다. */
const AVATAR_R = 11;

/** 유닛 키(논리 px)와 러닝 사이클 속도(초당 프레임). */
const UNIT_SPRITE_H = 20;

// ── HUD 레이아웃 (전부 화면 px) ─────────────────────────────────
//
// **HUD는 필드 위에 얹힌다는 전제로 짠다.** 판은 620×1000 비율이라 세로가 긴 화면에서는
// 위아래에 여백이 남지만(375×812 → 위아래 104px씩), 375×667 같은 비율에서는 31px밖에
// 안 남아 HUD가 필드를 덮는다. 그래서 글자를 바로 얹지 않고 **판때기를 깔고 그 위에**
// 그린다 — 밝은 건물 스프라이트가 밑으로 지나가도 읽힌다.

/** 판때기 좌우 여백. */
const HUD_PAD = 12;
/** 판때기 높이(`safeTop` 아래로). 이름 줄 + 점수 줄 + 전선 막대가 들어간다. */
const HUD_H = 66;
/** 이름 줄의 세로 중심. 타이머도 이 줄이다. */
const HUD_NAME_Y = 18;
/**
 * 점수 줄의 세로 중심. **이름 밑에 따로 놓는다** — 같은 줄에 붙이면 375px에서
 * 이름에 남는 자리가 네 글자로 줄어든다.
 */
const HUD_RATING_Y = 34;
/** 전선 막대의 위쪽 y와 두께. */
const HUD_BAR_Y = 46;
const HUD_BAR_H = 9;

/**
 * 타이머가 가운데에서 좌우로 차지하는 폭의 절반. 이름은 여기까지만 온다.
 *
 * 고정값인 이유: 타이머 글자 폭으로 잡으면 `9:59`→`10:00` 에서 자리가 넓어지며
 * 양쪽 이름이 동시에 줄어든다. 화면이 이유 없이 들썩이는 것보다 자리를 미리 비워 두는
 * 편이 낫다. `MATCH_TIME` 이 10분을 넘게 되면 이 값을 다시 재야 한다.
 */
const HUD_TIMER_HALF = 36;

/**
 * 아래쪽 조작 안내가 그대로 떠 있는 시간(초)과 사라지는 데 걸리는 시간.
 *
 * 상시 문구로 두지 않는 이유: 이건 상태가 아니라 힌트다. 한 번 읽으면 그만인데
 * 세로 화면에서는 그 한 줄이 계속 자리를 먹는다. **판 시간(`state.elapsed`)으로
 * 재므로 판마다 다시 뜬다** — 오랜만에 켠 사람도 한 번은 본다.
 */
const HINT_HOLD = 6;
const HINT_FADE = 1.5;

/**
 * 아래쪽에 비워 두는 높이. 조작 안내가 여기 들어간다.
 *
 * [항복] 버튼(우하단, 44px)까지 다 비우지는 않는다 — 구석 하나 때문에 판을 더 줄이면
 * 손해가 크고, 버튼은 경로를 긋는 자리에서 이미 가장 먼 곳이다.
 */
const HUD_BOTTOM = 48;

/**
 * 유닛 그림 방향을 바꿀 때 요구하는 우세폭. **이미 쓰던 방향에 이만큼 가산점을 준다.**
 *
 * 한 구간(`fromId`→`toId`) 안에서는 이동 벡터가 안 변하므로 프레임마다 깜빡이지는
 * 않는다. 이 값이 값을 하는 곳은 **중계**다 (`relayThrough`) — 상한에 찬 타워를
 * 통과하며 구간이 갈아끼워질 때 45°에 가까운 두 구간을 오가면 그림이 톡톡 바뀐다.
 *
 * 1.0이면 히스테리시스가 없는 것과 같다. 1.35는 **약 8° 폭의 불감대**에 해당한다.
 */
const DIR_HYSTERESIS = 1.35;
const UNIT_FPS = 12;

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private scale = 1;
  private ox = 0;
  private oy = 0;
  private effects: Effect[] = [];
  private time = 0;
  /** 맞물린 경로쌍의 마지막 전선 위치. 유닛이 잠깐 비는 순간에 경계가 튀지 않게 잡아준다. */
  private frontMemory = new Map<string, Vec>();
  /**
   * 유닛 id → 지금 쓰고 있는 그림 방향. 히스테리시스가 이걸 본다 (`DIR_HYSTERESIS`).
   * `drawUnits` 가 매 프레임 살아 있는 것만 담아 통째로 갈아 끼운다 — 안 그러면
   * 죽은 유닛 id가 한 판 내내 쌓인다.
   */
  private unitDir = new Map<number, UnitDir>();
  private lastTick = -1;
  private sprites = new Sprites();
  /**
   * 플레이어별 유닛 종류. **렌더러만 아는 값이다** — 시뮬레이션은 종류 이름을 모른다.
   *
   * 2026-07-31부터 종류가 힘을 정하지만(`units.ts` 의 `power`), **sim 에 들어가는 것은
   * 숫자뿐이다** (`PlayerMods.unitPower`). 이름을 `MatchState` 에 넣으면 서버 권위로 갈 때
   * 검증 대상이 하나 더 늘고, 카탈로그가 바뀔 때마다 저장된 판이 깨진다.
   *
   * **여기 든 종류와 `state.mods` 의 힘은 반드시 같은 종류에서 나와야 한다.**
   * 색이 곧 세기라 어긋나면 화면이 거짓말을 한다 — 맞추는 곳은 `MatchScene.restart` 다.
   */
  private unitKinds: Record<PlayerId, UnitKind> = {
    1: DEFAULT_UNIT_KIND,
    2: DEFAULT_UNIT_KIND,
  };
  /** 상대 입력 대기 중. PVP에서만 켜진다 (setWaiting). */
  private waitingForPeer = false;
  /** 플레이어별 닉네임. 비어 있으면 HUD에 이름 줄을 안 그린다. */
  private names: Record<PlayerId, string> = { 1: '', 2: '' };
  /**
   * 플레이어별 PVP 점수. 이름 밑에 한 줄로 나간다.
   *
   * **0이면 안 그린다** — 점수를 못 받은 판(옛 서버·오프라인)에서 `0점` 이라고 쓰면
   * 밑바닥까지 떨어진 사람으로 읽힌다. 빈칸이 낫다.
   */
  private ratings: Record<PlayerId, number> = { 1: 0, 2: 0 };
  /** 플레이어별 프로필 아바타. 원본이 908px이라 필요한 것만 그때 불러온다. */
  private readonly profiles = new Profiles();
  private profileIds: Record<PlayerId, ProfileId> = { 1: DEFAULT_PROFILE, 2: DEFAULT_PROFILE };

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D 컨텍스트를 만들 수 없습니다');
    this.ctx = ctx;
    this.resize();

    // window resize 이벤트만으로는 부족하다. 캔버스가 0×0으로 시작하는 경우
    // (숨겨진 패널·iframe 안에서 로드되는 경우 등) 보이는 시점에 스스로 복구해야 한다.
    new ResizeObserver(() => this.resize()).observe(document.documentElement);
  }

  /**
   * 노치·홈 인디케이터가 먹는 높이. **캔버스는 `env()` 를 못 읽어** CSS 변수로 받는다
   * (`style.css` 의 `--safe-top`/`--safe-bottom`). 안 쓰면 HUD의 이름·아바타가
   * 노치 밑으로 들어가 안 보인다.
   */
  private safeTop = 0;
  private safeBottom = 0;

  resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, window.innerWidth);
    const h = Math.max(1, window.innerHeight);
    const cs = getComputedStyle(document.documentElement);
    this.safeTop = parseFloat(cs.getPropertyValue('--safe-top')) || 0;
    this.safeBottom = parseFloat(cs.getPropertyValue('--safe-bottom')) || 0;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;

    // 논리 좌표계를 화면에 레터박스로 맞춘다. **HUD가 먹는 높이를 먼저 빼고 남은
    // 자리에 넣는다** — 전에는 화면 전체에 맞춰서, 620×1000보다 짧은 비율(375×667 등)
    // 에서는 위아래 여백이 HUD보다 좁아 상단 타워가 HUD 밑으로 들어갔다.
    //
    // 세로가 긴 화면에서는 어차피 가로가 먼저 걸리므로(375×812 → 0.605) 이 뺄셈이
    // 판 크기를 안 건드린다. 짧은 화면에서만 판이 조금 작아지고, 대신 다 보인다.
    const top = this.safeTop + HUD_H;
    const usable = Math.max(1, h - top - this.safeBottom - HUD_BOTTOM);
    this.scale = Math.min(w / FIELD_W, usable / FIELD_H);
    this.ox = (w - FIELD_W * this.scale) / 2;
    this.oy = top + (usable - FIELD_H * this.scale) / 2;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /**
   * 상대 입력을 기다리느라 시뮬레이션이 멈춰 있는가.
   *
   * 이걸 안 보여주면 화면이 이유 없이 얼어붙은 것처럼 보인다 — 플레이어는 자기 조작이
   * 씹혔는지 게임이 죽었는지 구분할 수 없다. 봇전에서는 늘 false다.
   */
  setWaiting(waiting: boolean): void {
    this.waitingForPeer = waiting;
  }

  /**
   * 판이 시작될 때 양쪽 닉네임을 정한다.
   *
   * PVP는 서버가 내려준 이름을 그대로 쓴다 (클라이언트가 보내면 남의 이름을 자칭할 수 있다).
   * 봇전 상대 이름은 클라이언트가 만든다 — 봇이라는 것을 화면에 안 알리기로 했다(§-7).
   */
  setNames(names: Partial<Record<PlayerId, string>>): void {
    if (names[1] !== undefined) this.names[1] = names[1];
    if (names[2] !== undefined) this.names[2] = names[2];
  }

  /**
   * 판이 시작될 때 양쪽 점수를 정한다. 판 도중에는 안 바뀐다 — 서버가 판 시작에
   * 찍어 둔 스냅샷이고, 판이 끝난 뒤 Elo 계산도 같은 값으로 한다 (§-27).
   *
   * 봇전 상대 점수는 클라이언트가 만든다 (`botRating`) — 이름·아바타와 같은 이유다.
   */
  setRatings(ratings: Partial<Record<PlayerId, number>>): void {
    if (ratings[1] !== undefined) this.ratings[1] = ratings[1];
    if (ratings[2] !== undefined) this.ratings[2] = ratings[2];
  }

  /**
   * 판이 시작될 때 양쪽 아바타를 정한다. **여기서 불러오기가 시작된다** —
   * 아바타 원본이 장당 0.6~1.0MB라 앱 시작 때 다 불러오면 첫 로딩이 늘어진다.
   * 한 판에 필요한 것은 두 장뿐이다.
   */
  setProfiles(ids: Partial<Record<PlayerId, ProfileId>>): void {
    if (ids[1]) this.profileIds[1] = ids[1];
    if (ids[2]) this.profileIds[2] = ids[2];
    this.profiles.load(this.profileIds[1]);
    this.profiles.load(this.profileIds[2]);
  }

  /** 판이 시작될 때 플레이어별 유닛 종류를 정한다. 힘은 sim이 따로 받는다 (위 주석). */
  setUnitKinds(kinds: Partial<Record<PlayerId, UnitKind>>): void {
    if (kinds[1]) this.unitKinds[1] = kinds[1];
    if (kinds[2]) this.unitKinds[2] = kinds[2];
    // **여기서 불러오기가 시작된다.** 종류·진영·방향을 다 곱하면 240장이라
    // 미리 다 받으면 첫 로딩만 늘어진다. 이 판에 나올 48장만 받는다 (sprites.ts).
    this.sprites.loadUnit(1, this.unitKinds[1]);
    this.sprites.loadUnit(2, this.unitKinds[2]);
  }

  /** 화면 좌표 → 논리 좌표. 입력 처리에서 쓴다. */
  toLogical(clientX: number, clientY: number): Vec {
    const r = this.canvas.getBoundingClientRect();
    return {
      x: (clientX - r.left - this.ox) / this.scale,
      y: (clientY - r.top - this.oy) / this.scale,
    };
  }

  ingest(state: MatchState, ev: TickEvents): void {
    for (const c of ev.captures) {
      const t = state.towers[c.towerId];
      this.effects.push({
        kind: 'capture', x: t.x, y: t.y, age: 0, life: 0.55, color: OWNER_COLOR[c.by].main,
      });
    }
    for (const c of ev.clashes) {
      this.effects.push({ kind: 'clash', x: c.x, y: c.y, age: 0, life: 0.26, color: '#ffffff' });
    }
  }

  render(state: MatchState, ui: UiState, alpha: number, dt: number): void {
    this.time += dt;
    this.stepEffects(dt);

    // 새 판이 시작되면 이전 판의 기억은 버린다 — 타워·유닛 id가 재사용되기 때문이다
    if (state.tick < this.lastTick) {
      this.frontMemory.clear();
      this.unitDir.clear();
    }
    this.lastTick = state.tick;

    const ctx = this.ctx;
    ctx.save();
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.translate(this.ox, this.oy);
    ctx.scale(this.scale, this.scale);

    this.drawField();
    this.drawRoutes(state, ui);
    this.drawDrag(state, ui);
    this.drawCut(ui);
    this.drawEffects();
    this.drawUnits(state, alpha);
    for (const t of state.towers) this.drawTower(t, state, ui);

    ctx.restore();
    this.drawHud(state, ui);
    if (state.winner !== null) this.drawResult(state, ui);
  }

  // ── 배경 ────────────────────────────────────────────────────────

  private drawField(): void {
    const ctx = this.ctx;
    // **격자를 안 그린다** (2026-08-03 사용자 지시). 전에는 50논리px 간격의 옅은 선을
    // 깔았는데, 건물 스프라이트가 들어온 뒤로는 판이 지도가 아니라 모눈종이로 읽혔다.
    // 중앙선. **세로형이라 가로로 긋는다** (2026-07-31) — 진영이 위아래로 마주본다.
    // `maps.ts` 가 y = FIELD_H/2 를 축으로 거울을 찍으므로 여기와 같은 선이어야 한다.
    ctx.strokeStyle = 'rgba(120,160,200,0.12)';
    ctx.setLineDash([6, 10]);
    ctx.beginPath();
    ctx.moveTo(0, FIELD_H / 2);
    ctx.lineTo(FIELD_W, FIELD_H / 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // ── 경로 ────────────────────────────────────────────────────────

  /**
   * 목적지 방향으로 대시가 흐르는 보급선.
   *
   * 적 보급선과 부딪히면 그 지점에서 색이 갈린다 — 앞은 내 색, 너머는 상대 색.
   * 파랑에서 빨강으로 바뀌는 자리가 곧 유닛이 실제로 소멸하는 전선이다.
   */
  private drawRoutes(state: MatchState, ui: UiState): void {
    const ctx = this.ctx;
    for (const r of state.routes) {
      const a = state.towers[r.fromId];
      const b = state.towers[r.toId];
      if (!a || !b) continue;

      const n = { x: b.x - a.x, y: b.y - a.y };
      const len = Math.hypot(n.x, n.y) || 1;
      const ux = n.x / len;
      const uy = n.y / len;
      const sx = a.x + ux * (towerRadiusOf(a) + 3);
      const sy = a.y + uy * (towerRadiusOf(a) + 3);
      const ex = b.x - ux * (towerRadiusOf(b) + 3);
      const ey = b.y - uy * (towerRadiusOf(b) + 3);

      // 끊길 예정인 경로는 통째로 붉게. 교차 표시보다 이쪽이 더 급한 정보다.
      const doomed = ui.cutRoutes.includes(r.id);
      const cross = doomed ? null : this.enemyFront(state, r, a, b);
      const split = cross ? splitPointOn(cross.point, sx, sy, ex, ey) : null;
      const mid = split?.mid ?? null;

      // 색을 가르는 건 실제로 선을 둘로 나눌 수 있을 때뿐이다. 전선이 타워에 붙어
      // 못 나눌 때는 통째로 우세한 쪽 색이 된다 — 상대가 내 문앞까지 밀고 들어온
      // 통로를 내 색으로 칠하면 거짓말이 되기 때문이다.
      const enemyColor = cross ? OWNER_COLOR[cross.owner] : OWNER_COLOR[r.owner];
      const overrun = !mid && cross && split?.whole === 'far';
      const near = doomed
        ? { main: CUT_COLOR, dim: 'rgba(251,191,36,0.5)' }
        : overrun
          ? enemyColor
          : OWNER_COLOR[r.owner];
      const far = mid ? enemyColor : near;

      // 바닥 굵은 선
      ctx.lineWidth = 6;
      ctx.globalAlpha = 0.25;
      ctx.setLineDash([]);
      this.strokeLine(sx, sy, mid ? mid.x : ex, mid ? mid.y : ey, near.dim);
      if (mid) this.strokeLine(mid.x, mid.y, ex, ey, far.dim);

      // 흐르는 대시. 음수라야 출발지 → 목적지로 흐른다.
      const baseOffset = -this.time * 70;
      ctx.globalAlpha = 1;
      ctx.lineWidth = 2.5;
      ctx.setLineDash([9, 13]);
      ctx.lineDashOffset = baseOffset;
      this.strokeLine(sx, sy, mid ? mid.x : ex, mid ? mid.y : ey, near.main);

      if (mid) {
        // 대시 위상을 앞 구간 길이만큼 밀어야 색만 바뀌고 흐름은 이어져 보인다
        ctx.lineDashOffset = baseOffset + Math.hypot(mid.x - sx, mid.y - sy);
        this.strokeLine(mid.x, mid.y, ex, ey, far.main);
      }

      ctx.setLineDash([]);
      ctx.lineDashOffset = 0;
      this.drawArrowHead(ex, ey, Math.atan2(n.y, n.x), far.main);
    }
  }

  private strokeLine(x1: number, y1: number, x2: number, y2: number, color: string): void {
    const ctx = this.ctx;
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }

  /**
   * 이 경로와 정면으로 맞물린 적 경로의 전선. 없으면 null.
   *
   * 색을 가르는 건 정면 맞물림뿐이다. 서로 다른 통로가 X자로 스쳐 지나가는 단순 교차는
   * 통로를 뺏은 게 아니므로 색을 바꾸지 않는다 — 내 타워 둘을 잇는 보급선의 뒤쪽 절반이
   * 상대 색으로 칠해지면, 얻는 정보보다 부르는 오해가 크다.
   */
  private enemyFront(
    state: MatchState,
    route: Route,
    a: Tower,
    b: Tower,
  ): { point: Vec; owner: PlayerId } | null {
    for (const other of state.routes) {
      if (other.owner === route.owner) continue;
      if (other.fromId !== route.toId || other.toId !== route.fromId) continue;

      const front = this.headOnFront(state, route, other, a, b);
      return front ? { point: front, owner: other.owner } : null;
    }
    return null;
  }

  /**
   * 같은 구간을 정면으로 마주 달리는 두 경로의 전선 위치.
   *
   * 전선은 경로의 성질이지 유닛의 성질이 아니다. 유닛은 일정 간격으로 나오고 부딪히면
   * 둘 다 사라지므로 "지금 살아 있는 유닛"만 보면 배출 간격마다 전선이 사라졌다
   * 나타나기를 반복한다. 그래서 유닛이 없는 순간에도 답을 내야 한다:
   *
   *   양쪽에 유닛 있음 → 두 선두의 중점. 같은 속도로 마주 오므로 이 점은 둘이
   *                      부딪힐 때까지 움직이지 않고, 실제 소멸 지점과 일치한다.
   *   한쪽만 있음     → 그 선두 자신. 맞설 상대가 없으니 전선이 그 유닛을 따라 밀린다.
   *   양쪽 다 없음    → 마지막 전선을 유지한다. 아무 일도 안 일어난 것이지
   *                      전선이 사라진 게 아니다.
   */
  private headOnFront(
    state: MatchState,
    mine: Route,
    theirs: Route,
    a: Tower,
    b: Tower,
  ): Vec | null {
    let lead = -1;
    let counterLead = -1;
    for (const u of state.units) {
      if (u.power <= 0) continue;
      if (u.fromId === mine.fromId && u.toId === mine.toId) lead = Math.max(lead, u.progress);
      else if (u.fromId === theirs.fromId && u.toId === theirs.toId) {
        counterLead = Math.max(counterLead, u.progress);
      }
    }

    // 방향과 무관한 키. 맞물린 두 경로가 같은 기억을 공유해야 경계가 어긋나지 않는다.
    const key = mine.fromId < mine.toId
      ? `${mine.fromId}-${mine.toId}`
      : `${mine.toId}-${mine.fromId}`;

    let t: number;
    // 상대 선두는 반대 방향 progress라 이쪽 축으로 뒤집어야 같은 자로 잴 수 있다
    if (lead >= 0 && counterLead >= 0) t = (lead + (1 - counterLead)) / 2;
    else if (lead >= 0) t = lead;
    else if (counterLead >= 0) t = 1 - counterLead;
    else return this.frontMemory.get(key) ?? null;

    const point = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    this.frontMemory.set(key, point);
    return point;
  }

  private drawArrowHead(x: number, y: number, angle: number, color: string): void {
    const ctx = this.ctx;
    const s = 7;
    ctx.fillStyle = color;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(-s, -s * 0.6);
    ctx.lineTo(-s, s * 0.6);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // ── 타워 ────────────────────────────────────────────────────────

  private drawTower(t: Tower, state: MatchState, ui: UiState): void {
    const ctx = this.ctx;
    const c = OWNER_COLOR[t.owner];
    const r = towerRadiusOf(t);
    const routesOut = state.routes.filter((rt) => rt.fromId === t.id).length;

    const foot = t.y + r * TOWER_FOOT;

    if (ui.dragTarget === t.id) {
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.ellipse(t.x, foot, r * 1.35, r * GROUND_SQUASH * 1.35, 0, 0, Math.PI * 2);
      ctx.stroke();
    }

    this.drawStockRing(t, r, foot, c.main);

    // 건물은 소유자 색만 다르고 전부 같은 모양이다 (레벨 제거, 2026-07-30).
    // 스프라이트가 아직 안 떴으면 원으로 폴백한다 — 첫 프레임과 헤드리스 검증에서
    // 화면이 비지 않아야 하기 때문이다.
    const body = this.sprites.tower(t.owner);
    if (body) {
      // 높이·폭 두 상한 중 빡빡한 쪽에 맞추고 바닥을 발치에 댄다.
      // 높이만 맞추면 성채(312×208)가 지름의 2.8배까지 벌어져 경로를 덮는다.
      const d = r * 2;
      const k = Math.min((d * TOWER_SPRITE_H) / body.h, (d * TOWER_SPRITE_W) / body.w);
      const w = body.w * k;
      const h = body.h * k;
      ctx.drawImage(body.canvas, t.x - w / 2, foot - h, w, h);
    } else {
      ctx.fillStyle = c.fill;
      ctx.strokeStyle = c.main;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(t.x, t.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    // 재고 숫자는 건물 발치에 배지로 얹는다. 건물 그림 위에 그냥 쓰면 벽돌 무늬에
    // 묻히므로 뒤에 어두운 원을 깔아 대비를 만든다.
    const badge = r * 0.66;
    ctx.fillStyle = 'rgba(10,14,20,0.72)';
    ctx.beginPath();
    ctx.arc(t.x, foot, badge, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = c.main;
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = '#f2f7fb';
    ctx.font = `700 ${Math.round(r * 0.78)}px ui-sans-serif, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(Math.floor(t.troops)), t.x, foot + 1);

    if (t.owner !== 0) this.drawRouteSlots(t, r, foot, routesOut, c.main);
  }

  /**
   * 재고 게이지. 발치에 눕힌 타원이 troops / TOWER_CAP 만큼 찬다.
   *
   * 레벨이 사라진 뒤로 **타워에서 변하는 것은 이 게이지와 소유자 색뿐이다.**
   * 타원이 한 바퀴 다 차면 그게 곧 상한(60) 도달이고, 그 타워는 중계기가 된다.
   */
  private drawStockRing(t: Tower, r: number, foot: number, color: string): void {
    const ctx = this.ctx;
    // 건물이 발치에서 위로 서 있으므로 정원으로 두르면 링이 몸체를 관통한다.
    // 바닥에 눕힌 타원이라야 3/4 시점에서 "발판"으로 읽히고 건물과 안 겹친다.
    const rx = r * 1.15;
    const ry = r * GROUND_SQUASH * 1.15;
    const frac = Math.max(0, Math.min(1, t.troops / TOWER_CAP));

    ctx.lineWidth = 3.5;
    ctx.strokeStyle = 'rgba(255,255,255,0.14)';
    ctx.beginPath();
    ctx.ellipse(t.x, foot, rx, ry, 0, 0, Math.PI * 2);
    ctx.stroke();

    if (frac <= 0) return;
    const start = -Math.PI / 2;
    // 상한에 닿으면 흰색으로 넘긴다. 중계기가 됐다는 신호는 진영색보다 세야 한다.
    ctx.strokeStyle = frac >= 0.999 ? '#ffffff' : color;
    ctx.beginPath();
    ctx.ellipse(t.x, foot, rx, ry, 0, start, start + Math.PI * 2 * frac);
    ctx.stroke();
  }

  /**
   * 재고가 여는 경로 슬롯. 채워진 칸 = 사용 중, 빈 칸 = 남은 슬롯, 회색 = 아직 못 여는 칸.
   * 이 표시가 없으면 "재고 10마다 경로 하나"라는 규칙을 플레이어가 알 길이 없다.
   */
  private drawRouteSlots(t: Tower, r: number, foot: number, used: number, color: string): void {
    const ctx = this.ctx;
    const slots = routeSlotsFor(t.troops);
    const gap = 9;
    // 바닥 타원(반높이 r * GROUND_SQUASH * 1.15) 아래로 내려야 점이 링에 안 겹친다.
    const y = foot + r * GROUND_SQUASH * 1.15 + 8;
    const x0 = t.x - ((ROUTE_SLOT_MAX - 1) * gap) / 2;

    for (let i = 0; i < ROUTE_SLOT_MAX; i++) {
      ctx.beginPath();
      ctx.arc(x0 + i * gap, y, 3, 0, Math.PI * 2);
      if (i < used) {
        ctx.fillStyle = color;
        ctx.fill();
      } else if (i < slots) {
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.4;
        ctx.stroke();
      } else {
        ctx.strokeStyle = 'rgba(255,255,255,0.13)';
        ctx.lineWidth = 1.4;
        ctx.stroke();
      }
    }
  }

  // ── 유닛 ────────────────────────────────────────────────────────

  private drawUnits(state: MatchState, alpha: number): void {
    const ctx = this.ctx;
    // 살아 있는 유닛만 담아 매 프레임 갈아 끼운다. 죽은 유닛 id를 지우지 않으면
    // 한 판 내내 쌓인다 — 유닛 id는 계속 증가하고 재사용되지 않는다.
    const dirNow = new Map<number, UnitDir>();

    for (const u of state.units) {
      // 틱 사이 보간 — 30Hz 시뮬레이션을 60fps로 부드럽게 보여준다
      const p = unitPosition(state, u, unitProgressRate(u) * alpha * TICK_DT);
      const c = OWNER_COLOR[u.owner];

      // 유닛 스프라이트는 진영색이 원본에 들어 있어 색을 입히지 않는다.
      // 러닝 사이클은 유닛마다 위상을 어긋나게 해서 전부 같은 발로 뛰지 않게 한다.
      const kind = this.unitKinds[u.owner];
      const from = state.towers[u.fromId];
      const to = state.towers[u.toId];

      // ── 어느 그림을 쓸 것인가 ────────────────────────────────
      //
      // 세로형이라(§-23) 유닛이 대부분 위아래로 움직인다. 옆모습 한 장만 쓰면
      // 위로 가는 유닛도 오른쪽을 보고 있어 걷는 방향이 안 읽힌다.
      // 이동 벡터에서 **큰 성분**을 골라 정면/후면/옆모습을 가른다.
      //
      // 회전은 여전히 안 건다 — 사람 모양이라 돌리면 옆으로 눕는다(§7).
      // 옆모습일 때만 좌우 반전을 걸고, 정면·후면은 반전도 안 한다.
      // 45° 근처에서는 우세가 종이 한 장 차이라 중계로 구간이 갈아끼워질 때
      // 그림이 톡톡 바뀐다. **이미 쓰던 방향에 가산점**을 줘서 넘어갈 만할 때만 넘어간다.
      const dx = from && to ? to.x - from.x : 0;
      const dy = from && to ? to.y - from.y : 0;
      const prev = this.unitDir.get(u.id);
      const sideScore = Math.abs(dx) * (prev === 'run' ? DIR_HYSTERESIS : 1);
      const vertScore = Math.abs(dy) * (prev === 'up' || prev === 'down' ? DIR_HYSTERESIS : 1);
      const vertical = vertScore >= sideScore;
      const dir: UnitDir = vertical ? (dy > 0 ? 'down' : 'up') : 'run';
      dirNow.set(u.id, dir);
      const facingLeft = !vertical && dx < 0;

      const sprite = this.sprites.unit(u.owner, kind, dir, this.time * UNIT_FPS + u.id * 2);
      if (sprite) {
        // 종류마다 잘린 상자 비율이 달라 높이를 그대로 맞추면 크기가 들쭉날쭉해진다.
        // `scale` 은 추출 상자 비율 보정이고, `sizeFactorOf` 는 **힘을 크기로 보여주는**
        // 축이다 (`units.ts`). 상점 카드도 같은 함수를 쓴다 — 한쪽만 크게 그리면
        // 산 것이 판에서는 똑같아 보인다.
        const meta = UNIT_KIND_META[kind];
        const h = UNIT_SPRITE_H * meta.scale * sizeFactorOf(meta.power);
        const w = (sprite.w / sprite.h) * h;

        ctx.save();
        ctx.translate(p.x, p.y);
        // 아우라는 뒤집기 **전에** 그린다. 원이라 뒤집어도 같지만, 뒤집힌 좌표계에서
        // 그리면 나중에 색 순서를 바꿀 때 좌우가 반대가 된다.
        if (meta.aura === 'rainbow') this.drawRainbowAura(h);
        if (facingLeft) ctx.scale(-1, 1);
        ctx.drawImage(sprite.canvas, -w / 2, -h / 2, w, h);
        ctx.restore();
        continue;
      }

      const r = 5;
      ctx.fillStyle = c.main;
      ctx.strokeStyle = 'rgba(8,12,18,0.85)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    this.unitDir = dirNow;
  }

  private drawDrag(state: MatchState, ui: UiState): void {
    if (ui.dragFrom === null || !ui.pointer) return;
    const from = state.towers[ui.dragFrom];
    const to = ui.dragTarget !== null ? state.towers[ui.dragTarget] : ui.pointer;

    const willClose =
      ui.dragTarget !== null &&
      state.routes.some((r) => r.fromId === ui.dragFrom && r.toId === ui.dragTarget);
    const blocker =
      ui.dragTarget !== null && !willClose
        ? routeBlockedBy(state, from, state.towers[ui.dragTarget])
        : null;
    const full =
      !willClose &&
      !blocker &&
      state.routes.filter((r) => r.fromId === ui.dragFrom).length >= routeSlotsFor(from.troops);

    const ctx = this.ctx;
    ctx.strokeStyle = willClose
      ? 'rgba(251,191,36,0.85)'
      : blocker
        ? 'rgba(148,163,184,0.5)'
        : ui.dragTarget !== null
          ? 'rgba(255,255,255,0.75)'
          : 'rgba(255,255,255,0.28)';
    ctx.lineWidth = 3;
    ctx.setLineDash([9, 7]);
    ctx.lineDashOffset = -this.time * 40;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineDashOffset = 0;

    if (ui.dragTarget === null) return;

    const mx = (from.x + to.x) / 2;
    const my = (from.y + to.y) / 2;
    ctx.fillStyle = willClose
      ? 'rgba(251,191,36,0.95)'
      : blocker
        ? 'rgba(203,213,225,0.9)'
        : 'rgba(255,255,255,0.92)';
    ctx.font = '700 13px ui-sans-serif, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(
      willClose
        ? '경로 끊기'
        : blocker
          ? '막힘 — 사이에 타워가 있다'
          : full
            ? '경로 개설 (가장 오래된 것 대체)'
            : '경로 개설',
      mx,
      my - 14,
    );

    // 어느 타워가 막고 있는지 짚어준다. 안 짚으면 왜 안 되는지 알 수 없다.
    if (blocker) {
      ctx.strokeStyle = 'rgba(251,191,36,0.9)';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(blocker.x, blocker.y, towerRadiusOf(blocker) + 8, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  /** 절단 스와이프 궤적. 끝으로 갈수록 진해져서 손이 지나간 방향이 보인다. */
  private drawCut(ui: UiState): void {
    if (ui.cutPath.length < 2) return;
    const ctx = this.ctx;

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (let i = 1; i < ui.cutPath.length; i++) {
      const t = i / (ui.cutPath.length - 1);
      ctx.strokeStyle = `rgba(251,191,36,${0.15 + t * 0.75})`;
      ctx.lineWidth = 2 + t * 3;
      ctx.beginPath();
      ctx.moveTo(ui.cutPath[i - 1].x, ui.cutPath[i - 1].y);
      ctx.lineTo(ui.cutPath[i].x, ui.cutPath[i].y);
      ctx.stroke();
    }
    ctx.lineCap = 'butt';
    ctx.lineJoin = 'miter';

    if (ui.cutRoutes.length > 0) {
      const tip = ui.cutPath[ui.cutPath.length - 1];
      ctx.fillStyle = CUT_COLOR;
      ctx.font = '700 13px ui-sans-serif, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`경로 ${ui.cutRoutes.length}개 절단`, tip.x, tip.y - 20);
    }
  }

  // ── HUD ─────────────────────────────────────────────────────────

  private drawHud(state: MatchState, ui: UiState): void {
    const ctx = this.ctx;
    const w = window.innerWidth;
    const h = window.innerHeight;
    const enemy: PlayerId = ui.local === 1 ? 2 : 1;

    ctx.save();
    ctx.textBaseline = 'middle';

    // 노치 밑으로 들어가면 이름과 아바타가 통째로 안 보인다.
    const top = this.safeTop;

    this.drawHudPlate(top, w);

    // **타워 수로 잰다.** 전에는 `totalPower`(타워 재고 + 이동 중인 유닛)였는데,
    // 그 값은 "누가 이기고 있나"가 아니라 **"누가 안 쓰고 쌓아뒀나"** 를 보여줬다:
    // 공격하면 내 유닛도 적 병력도 같이 죽으므로 미는 쪽의 숫자가 오히려 줄고,
    // 가만히 있으면 타워마다 초당 1.9씩 60까지 쌓인다. 실측으로 봇에게 판을 내주는
    // 동안 막대가 파랑 97%였다 (2026-08-02).
    //
    // 타워 수는 **승패 판정과 같은 기준**이다 (`checkEnd` — 타워 수 우선, 동수일 때만
    // 전투력). 중립은 양쪽 어디에도 안 센다: 아직 아무의 것도 아니라서 색이 없다.
    const t1 = towerCount(state, 1);
    const t2 = towerCount(state, 2);
    this.drawFrontBar(top, w, ui.local, t1 + t2 > 0 ? t1 / (t1 + t2) : 0.5);

    // 시간은 **고정폭 숫자**로 찍는다. 비례폭이면 초가 바뀔 때마다 글자 폭이 달라져
    // 가운데 정렬한 시계가 좌우로 흔들린다.
    const left = Math.max(0, MATCH_TIME - state.elapsed);
    // 남은 10초는 붉게. 유일하게 "지금 서둘러라"를 뜻하는 자리다.
    ctx.fillStyle = left <= 10 ? OWNER_COLOR[2].main : '#f2f7fb';
    ctx.font = '700 17px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.textAlign = 'center';
    ctx.fillText(
      `${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')}`,
      w / 2,
      top + HUD_NAME_Y,
    );

    // 양 끝은 아바타 + 닉네임 한 줄이다. 전에는 이 자리에 `타워 N` 이 있고 이름이
    // 그 위에 따로 있었는데, 사용자 지시로 타워 수를 빼고 이름만 남겼다 (2026-07-30).
    //
    // **타워 수는 숫자로는 어디에도 없다.** 전선 막대가 그 비율을 보여준다.
    //
    // 이름이 없으면(오프라인 옛 저장본 등) 그쪽을 아예 안 그린다 — 빈칸을 남기면
    // 레이아웃이 흔들린 것처럼 보인다.
    const nameY = top + HUD_NAME_Y;
    const budget = w / 2 - HUD_TIMER_HALF - HUD_PAD - AVATAR_R * 2 - 6;
    if (this.names[ui.local]) {
      const x = this.drawAvatar(ui.local, HUD_PAD, nameY, 'left');
      this.drawHudName(this.names[ui.local], x, nameY, budget, 'left');
      this.drawHudRating(this.ratings[ui.local], x, top + HUD_RATING_Y, 'left');
    }
    if (this.names[enemy]) {
      const x = this.drawAvatar(enemy, w - HUD_PAD, nameY, 'right');
      this.drawHudName(this.names[enemy], x, nameY, budget, 'right');
      this.drawHudRating(this.ratings[enemy], x, top + HUD_RATING_Y, 'right');
    }

    // 홈 인디케이터가 먹는 만큼 띄운다.
    const bottom = h - this.safeBottom;
    ctx.textAlign = 'center';

    // 조작 안내는 **처음 몇 초만** 띄우고 사라진다. 세로 화면에서 상시 문구는 자리를
    // 계속 먹는데, 이건 상태가 아니라 힌트라 한 번 읽으면 그만이다.
    const hint = 1 - Math.max(0, Math.min(1, (state.elapsed - HINT_HOLD) / HINT_FADE));
    if (hint > 0) {
      ctx.globalAlpha = hint;
      ctx.fillStyle = 'rgba(170,186,202,0.6)';
      ctx.font = '500 12px ui-sans-serif, system-ui, sans-serif';
      ctx.fillText(t().hint, w / 2, bottom - 24);
      ctx.globalAlpha = 1;
    }

    // 상대 입력 대기. 안 그리면 화면이 이유 없이 얼어붙은 것처럼 보인다.
    // 점 개수를 시간으로 돌려 "멈춘 화면"이 아니라 "기다리는 중"으로 읽히게 한다.
    if (this.waitingForPeer && state.winner === null) {
      const dots = '.'.repeat(1 + (Math.floor(this.time * 2) % 3));
      ctx.font = '700 14px ui-sans-serif, system-ui, sans-serif';
      ctx.fillStyle = CUT_COLOR;
      ctx.fillText(`${t().waitingPeer}${dots}`, w / 2, bottom - 48);
    }
    ctx.restore();
  }

  /**
   * HUD가 얹히는 판때기. 아래로 갈수록 옅어져 필드와 이어진다 — 단색 띠로 자르면
   * 화면이 두 동강 난 것처럼 보인다.
   */
  private drawHudPlate(top: number, w: number): void {
    const ctx = this.ctx;
    const h = top + HUD_H;
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, 'rgba(7,11,17,0.92)');
    g.addColorStop(0.75, 'rgba(7,11,17,0.78)');
    g.addColorStop(1, 'rgba(7,11,17,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }

  /**
   * 전선 막대. **이 게임의 본론이 여기 있다** — 두 진영이 밀고 밀리는 경계가
   * 출발선(가운데)에서 얼마나 옮겨 갔는지를 그대로 보여 준다.
   *
   * 세 가지가 겹쳐 있다:
   *   1. 두 색이 만나는 **경계 눈금** — 지금 전선의 위치
   *   2. 가운데의 **출발선 자국** — 여기서 얼마나 밀렸는지 잴 기준
   *   3. 그 둘 사이를 잇는 **가는 선** — 밀린 폭 자체
   *
   * `local` 을 받는 이유: 내 색이 언제나 왼쪽이어야 한다. 슬롯 번호로 그리면
   * P2로 배정된 판에서 내 세력이 오른쪽에 붙어 매 판 좌우가 뒤집힌다.
   *
   * **눈금은 부드럽게 안 움직이고 툭툭 뛴다.** 타워 수 비율이라 그렇다 —
   * 한 번 뛸 때마다 타워가 하나 주인이 바뀌었다는 뜻이라 오히려 읽기 쉽다.
   */
  private drawFrontBar(top: number, w: number, local: PlayerId, ratioP1: number): void {
    const ctx = this.ctx;
    const enemy: PlayerId = local === 1 ? 2 : 1;
    const mine = local === 1 ? ratioP1 : 1 - ratioP1;
    const x = HUD_PAD;
    const y = top + HUD_BAR_Y;
    const bw = w - HUD_PAD * 2;
    const r = HUD_BAR_H / 2;

    ctx.save();
    // 막대 전체를 둥근 사각형으로 잘라 두면 안쪽은 사각형으로 칠해도 끝이 둥글다.
    //
    // **`roundRect` 이 없는 브라우저가 있다** (Safari 16 미만). 없는 채로 부르면
    // 매 프레임 던지고, 이건 `render()` 안이라 **판 전체가 안 그려진다.** 모서리를
    // 포기하는 것과 화면이 검게 죽는 것은 비교 대상이 아니다.
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(x, y, bw, HUD_BAR_H, r);
    } else {
      ctx.rect(x, y, bw, HUD_BAR_H);
    }
    ctx.clip();
    ctx.fillStyle = OWNER_COLOR[enemy].main;
    ctx.fillRect(x, y, bw, HUD_BAR_H);
    ctx.fillStyle = OWNER_COLOR[local].main;
    ctx.fillRect(x, y, bw * mine, HUD_BAR_H);

    // 출발선 자국. 막대 안에 있어야 경계와 같은 자로 읽힌다.
    ctx.fillStyle = 'rgba(11,16,23,0.55)';
    ctx.fillRect(x + bw / 2 - 0.5, y, 1, HUD_BAR_H);
    ctx.restore();

    // 경계 눈금. 막대 위아래로 살짝 튀어나오게 그려 "지금 여기가 전선"으로 읽히게 한다.
    const fx = x + bw * mine;
    ctx.fillStyle = '#f2f7fb';
    ctx.fillRect(fx - 1, y - 3, 2, HUD_BAR_H + 6);

    // 출발선에서 밀린 폭. 이긴 쪽 색으로 잇는다 — 어느 쪽으로 밀렸는지가 색이다.
    const mid = x + bw / 2;
    if (Math.abs(fx - mid) > 1) {
      ctx.fillStyle = mine > 0.5 ? OWNER_COLOR[local].main : OWNER_COLOR[enemy].main;
      ctx.fillRect(Math.min(mid, fx), y - 5, Math.abs(fx - mid), 1.5);
    }
  }

  /**
   * 이름 한 줄. **자리를 넘치면 잘라서 말줄임표를 붙인다** — 세로 화면(375px)에서
   * 12자 닉네임을 그대로 그리면 반대쪽 이름과 시계까지 덮어 셋이 겹쳐 읽힌다.
   *
   * 색은 진영색이 아니라 밝은 회백색이다. 파랑·빨강 글자는 어두운 판때기 위에서
   * 대비가 모자라고, 어느 편인지는 옆의 아바타 테두리가 이미 말한다.
   */
  private drawHudName(
    name: string,
    x: number,
    y: number,
    maxW: number,
    align: 'left' | 'right',
  ): void {
    const ctx = this.ctx;
    ctx.font = '700 14px ui-sans-serif, system-ui, sans-serif';
    ctx.textAlign = align;
    ctx.fillStyle = '#e6eef7';

    let text = name;
    if (ctx.measureText(text).width > maxW) {
      while (text.length > 1 && ctx.measureText(`${text}…`).width > maxW) {
        text = text.slice(0, -1);
      }
      text = `${text}…`;
    }
    ctx.fillText(text, x, y);
  }

  /**
   * 이름 밑의 점수 한 줄. **이름보다 작고 흐리다** — 누구와 붙었는지가 먼저고
   * 점수는 그 다음이다. 둘이 같은 무게면 어느 쪽을 읽어야 할지 알 수 없다.
   *
   * 고정폭 숫자를 쓰는 이유는 시계와 같다 — 자릿수가 같으면 폭도 같아야 한다.
   * `점` 을 붙이는 것은 로비·결과 화면과 같은 표기를 쓰기 위해서다. 숫자만 두면
   * 이 판에서 딴 점수로 읽힐 수 있다.
   *
   * 0이면 아무것도 안 그린다 (`ratings` 주석).
   */
  private drawHudRating(rating: number, x: number, y: number, align: 'left' | 'right'): void {
    if (!(rating > 0)) return;
    const ctx = this.ctx;
    ctx.font = '700 11px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.textAlign = align;
    ctx.fillStyle = 'rgba(170,186,202,0.72)';
    ctx.fillText(t().points(rating), x, y);
  }

  /**
   * 유료 종류의 무지개 아우라. **캐릭터 뒤에 깐다** — 위에 얹으면 재킷 색을 덮는데
   * 그게 "누구 편인가"의 유일한 신호다 (`units.ts` 의 변형색 주석).
   *
   * 그림이 없어서 코드로 그리는 구분이다. 무지개 비어갱은 기본 스프라이트를 빌려 쓰므로
   * (`spriteKindOf`) 이게 없으면 기본과 구분이 안 된다. 상점 카드도 같은 것을 CSS로 낸다.
   *
   * 시간으로 색을 돌린다 — 정지 상태로 두면 그냥 얼룩으로 보인다.
   */
  private drawRainbowAura(h: number): void {
    const ctx = this.ctx;
    const r = h * 0.42;
    // `time` 은 판 시작부터의 초. 유닛마다 위상을 안 나눈다 — 같은 종류가 같은 색으로
    // 함께 도는 편이 "이건 특별한 부대"로 읽힌다.
    const t = (this.time * 0.5) % 1;
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
    const hue = Math.floor(t * 360);
    g.addColorStop(0, `hsla(${hue}, 90%, 65%, 0.55)`);
    g.addColorStop(0.6, `hsla(${(hue + 120) % 360}, 90%, 60%, 0.28)`);
    g.addColorStop(1, 'hsla(0, 0%, 100%, 0)');
    ctx.save();
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /**
   * 이름 옆 아바타. 이름 글자가 시작될 x를 돌려준다.
   *
   * 캐릭터 그림은 모두가 같고 **뒤에 깔리는 원 색이 그 사람이 고른 값**이다
   * (`src/profiles.ts`). 그래서 색을 먼저 칠하고 그림을 그 위에 얹는다 — 원본 PNG에
   * 알파가 있어 색이 캐릭터 뒤로 비친다. DOM 카드도 같은 값(`--avatar-bg`)을 쓴다.
   *
   * 아직 안 불러왔으면 배경색만 남는다 — 자리를 비우면 이름이 좌우로 튄다.
   * 원본이 정사각형(908×908)이라 원으로 잘라 넣는다.
   */
  private drawAvatar(player: PlayerId, edgeX: number, cy: number, side: 'left' | 'right'): number {
    const ctx = this.ctx;
    const r = AVATAR_R;
    const cx = side === 'left' ? edgeX + r : edgeX - r;
    const id = this.profileIds[player];
    const img = this.profiles.get(id);

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = profileBg(id);
    ctx.fill();
    if (img) {
      ctx.clip();
      ctx.drawImage(img, cx - r, cy - r, r * 2, r * 2);
    }
    ctx.restore();

    // 진영색 테두리. 아바타 그림만으로는 어느 쪽이 나인지 안 읽힌다.
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.strokeStyle = OWNER_COLOR[player].main;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();

    return side === 'left' ? cx + r + 6 : cx - r - 6;
  }

  /**
   * 승패 표시. 화면을 어둡게 깔고 글자만 얹는다.
   *
   * 다음 행동은 결과 화면의 DOM 버튼([다시 하기] / [로비로])이 안내한다.
   * 여기에 "화면을 눌러 재시작"을 그리면 그 버튼과 안내가 어긋난다.
   */
  private drawResult(state: MatchState, ui: UiState): void {
    const ctx = this.ctx;
    const w = window.innerWidth;
    const h = window.innerHeight;
    ctx.save();
    ctx.fillStyle = 'rgba(6,10,16,0.78)';
    ctx.fillRect(0, 0, w, h);

    const won = state.winner === ui.local;
    const draw = state.winner === 0;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = draw
      ? '#cbd5e1'
      : won
        ? OWNER_COLOR[ui.local].main
        : OWNER_COLOR[ui.local === 1 ? 2 : 1].main;
    ctx.font = '800 54px ui-sans-serif, system-ui, sans-serif';
    ctx.fillText(draw ? t().draw : won ? t().victory : t().defeat, w / 2, h / 2 - 16);
    ctx.restore();
  }

  // ── 이펙트 ──────────────────────────────────────────────────────

  private stepEffects(dt: number): void {
    for (const e of this.effects) e.age += dt;
    this.effects = this.effects.filter((e) => e.age < e.life);
  }

  private drawEffects(): void {
    const ctx = this.ctx;
    for (const e of this.effects) {
      const k = e.age / e.life;

      if (e.kind === 'clash') {
        // 짧고 밝은 스파크 — 소모전이 어디서 벌어지는지 한눈에 보여야 한다
        const s = 4 + k * 7;
        ctx.strokeStyle = e.color;
        ctx.globalAlpha = 1 - k;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(e.x - s, e.y - s);
        ctx.lineTo(e.x + s, e.y + s);
        ctx.moveTo(e.x + s, e.y - s);
        ctx.lineTo(e.x - s, e.y + s);
        ctx.stroke();
      } else {
        ctx.strokeStyle = e.color;
        ctx.globalAlpha = (1 - k) * 0.9;
        ctx.lineWidth = e.kind === 'capture' ? 4 : 2;
        ctx.beginPath();
        ctx.arc(e.x, e.y, 18 + k * (e.kind === 'capture' ? 46 : 22), 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
  }
}

/** 색을 가르려면 양쪽 구간이 최소 이만큼은 남아야 한다. 안 그러면 나눈 티가 안 난다. */
const SPLIT_MARGIN = 14;

/**
 * 부딪히는 지점을 실제로 그리는 구간 위의 분할점으로 변환한다.
 *
 * 지점은 타워 "중심"을 잇는 선 기준으로 계산되는데 그리는 선은 타워 반경만큼 짧다.
 * 그래서 지점이 타워에 가려지는 구간에 떨어질 수 있고, 그걸 억지로 끌어다 쓰면
 * 한쪽 구간 길이가 0이 되어 경로 전체가 엉뚱한 색으로 칠해진다.
 *
 * 나눌 수 없을 때는 `whole`이 어느 쪽이 통로를 차지했는지 알려준다:
 * 경계가 출발점에 붙었으면 상대가('far'), 도착점에 붙었으면 내가('near') 차지한 것이다.
 */
function splitPointOn(
  p: Vec,
  sx: number,
  sy: number,
  ex: number,
  ey: number,
): { mid: Vec | null; whole: 'near' | 'far' } {
  const dx = ex - sx;
  const dy = ey - sy;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return { mid: null, whole: 'near' };

  const len = Math.sqrt(lenSq);
  const t = ((p.x - sx) * dx + (p.y - sy) * dy) / lenSq;
  if (len < SPLIT_MARGIN * 2) return { mid: null, whole: t < 0.5 ? 'far' : 'near' };

  const margin = SPLIT_MARGIN / len;
  if (t < margin) return { mid: null, whole: 'far' };
  if (t > 1 - margin) return { mid: null, whole: 'near' };

  return { mid: { x: sx + t * dx, y: sy + t * dy }, whole: 'near' };
}
