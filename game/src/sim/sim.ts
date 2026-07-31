/**
 * 순수 시뮬레이션. DOM·캔버스·타이머에 의존하지 않는다.
 *
 * 계약:
 *   - `step()`은 결정론적이다. 같은 state + 같은 command 배열이면 언제나 같은 결과.
 *   - 난수를 쓰지 않는다 (맵 생성만 시드 난수를 쓰고, 그건 매치 시작 전에 끝난다).
 *   - 시간은 오직 TICK_DT 단위로만 흐른다. 실제 경과 시간을 참조하지 않는다.
 * 이 세 가지 덕분에 나중에 서버에서 같은 코드를 돌려 클라이언트 결과를 검증할 수 있다.
 *
 * 경제 모델:
 *   경로가 하나도 없는 타워만 재고가 늘어난다. 경로를 열면 생산이 재고로 적립되는
 *   대신 경로마다 독립적으로 유닛이 되어 빠져나간다. 재고는 줄지 않지만 늘지도 않는다.
 *   재고를 깎는 것은 오직 적의 공격뿐이다 (레벨업은 2026-07-30에 제거됐다).
 */
import {
  COLLISION_RADIUS,
  MATCH_TIME,
  RELAY_MAX_HOPS,
  ROUTE_CLEARANCE,
  TICK_DT,
  TOWER_GEN,
  UNIT_SPEED,
  capacityOf,
  defenseMultiplierOf,
  emitIntervalOf,
  isFull,
  routeSlotsFor,
  towerRadiusOf,
} from './config';
import { clamp, dist, distToSegment } from './geometry';
import {
  defaultMods,
  emptyEvents,
  type Command,
  type MatchState,
  type Owner,
  type PlayerId,
  type PlayerMods,
  type Route,
  type TickEvents,
  type Tower,
  type Unit,
} from './types';

/**
 * 새 판. `mods`는 로비 상점의 영구 강화가 매치로 들어오는 유일한 통로다.
 * 안 넘기면 양쪽 다 기본값이라 강화 없는 순수 대전이 된다.
 */
export function createMatch(
  towers: Tower[],
  mods?: Partial<Record<PlayerId, PlayerMods>>,
): MatchState {
  return {
    tick: 0,
    elapsed: 0,
    towers,
    routes: [],
    units: [],
    nextRouteId: 1,
    nextUnitId: 1,
    mods: {
      1: { ...defaultMods(), ...mods?.[1] },
      2: { ...defaultMods(), ...mods?.[2] },
    },
    winner: null,
  };
}

export function cloneState(s: MatchState): MatchState {
  return {
    ...s,
    mods: { 1: { ...s.mods[1] }, 2: { ...s.mods[2] } },
    towers: s.towers.map((t) => ({ ...t })),
    routes: s.routes.map((r) => ({ ...r })),
    units: s.units.map((u) => ({ ...u })),
  };
}

/**
 * 한 틱 전진. state를 제자리에서 변경한다.
 * 순서가 곧 규칙이다 — 명령 → 경로정리 → 생산 → 배출 → 충돌 → 이동/착탄 → 승패.
 * 충돌이 착탄보다 먼저여야 "도착 직전에 요격당한다"가 성립한다.
 */
export function step(state: MatchState, commands: Command[] = []): TickEvents {
  const ev = emptyEvents();
  if (state.winner !== null) return ev;

  applyCommands(state, commands, ev);
  pruneRoutes(state, ev);
  produce(state);
  emitUnits(state);
  resolveCollisions(state, ev);
  advanceUnits(state, ev);

  state.tick += 1;
  state.elapsed = state.tick * TICK_DT;
  resolveOutcome(state);
  return ev;
}

// ── 명령 처리 ─────────────────────────────────────────────────────

function applyCommands(state: MatchState, commands: Command[], ev: TickEvents): void {
  for (const cmd of commands) {
    switch (cmd.kind) {
      case 'toggleRoute':
        applyToggleRoute(state, cmd.player, cmd.fromId, cmd.toId, ev);
        break;
      case 'resign':
        applyResign(state, cmd.player);
        break;
    }
  }
}

/**
 * 항복. 상대를 승자로 박는다.
 *
 * **이미 끝난 판에는 안 먹는다.** 같은 틱에 시간 종료와 항복이 겹치면 나중에 처리된 쪽이
 * 이기는데, 그러면 명령 순서(플레이어 번호 순)가 승자를 바꾼다 — 양쪽 클라이언트가
 * 같은 순서로 처리하므로 갈라지지는 않지만, 규칙으로 설명할 수 없는 결과가 된다.
 * 먼저 정해진 결과를 유지하는 편이 읽기 쉽다.
 *
 * `resolveOutcome` 이 뒤에 돌지만 `winner` 를 **지우지는 않으므로** 이 값이 살아남는다.
 */
function applyResign(state: MatchState, player: PlayerId): void {
  if (state.winner !== null) return;
  state.winner = player === 1 ? 2 : 1;
}

function applyToggleRoute(
  state: MatchState,
  player: PlayerId,
  fromId: number,
  toId: number,
  ev: TickEvents,
): void {
  if (fromId === toId) return;
  const from = state.towers[fromId];
  const to = state.towers[toId];
  if (!from || !to || from.owner !== player) return;

  const existing = state.routes.findIndex((r) => r.fromId === fromId && r.toId === toId);
  if (existing >= 0) {
    state.routes.splice(existing, 1);
    ev.routesClosed.push({ fromId, toId });
    return;
  }

  // 막힌 경로는 열 수 없다. 슬롯을 밀어내기 전에 확인해야
  // 열리지도 않을 경로 때문에 멀쩡한 경로를 잃지 않는다.
  if (routeBlockedBy(state, from, to)) return;

  // 슬롯이 꽉 찼으면 가장 오래된 경로를 밀어낸다. 거부하는 것보다 손에 붙는다.
  const slots = routeSlotsFor(from.troops);
  while (countRoutesFrom(state, fromId) >= slots) {
    const oldest = oldestRouteFrom(state, fromId);
    if (!oldest) break;
    closeRoute(state, oldest, ev);
  }

  state.routes.push({
    id: state.nextRouteId++,
    owner: player,
    fromId,
    toId,
    // 첫 유닛은 한 박자 쉬고 나간다 — 경로 애니메이션이 먼저 깔리고,
    // 토글을 연타해서 유닛을 공짜로 뽑는 것도 막힌다.
    // 소유자의 공속 강화를 여기서도 반영해야 첫 박자만 강화 전 속도가 되지 않는다.
    cooldown: emitIntervalOf(from, state.mods[player].speedMul),
    openedTick: state.tick,
  });
}

/**
 * 출발지-목적지 직선에 걸치는 제3의 타워. 없으면 null.
 *
 * 개설 시점에만 검사한다. 타워 반경이 이제 고정이라 개설 후에 판정이 바뀔 일은 없지만,
 * 검사를 매 틱 돌리면 그만큼 비싸고 결과도 같다.
 *
 * 입력·렌더러도 이 함수를 써서 드래그 중에 미리 "막힘"을 보여준다.
 * 판정이 두 곳에 있으면 화면과 실제가 어긋난다.
 */
export function routeBlockedBy(state: MatchState, from: Tower, to: Tower): Tower | null {
  for (const t of state.towers) {
    if (t.id === from.id || t.id === to.id) continue;
    if (distToSegment(t, from, to) <= towerRadiusOf(t) + ROUTE_CLEARANCE) return t;
  }
  return null;
}

// ── 경로 유지 ─────────────────────────────────────────────────────

/** 주인이 바뀐 타워의 경로와, 재고가 줄어 슬롯을 초과하게 된 경로를 정리한다. */
function pruneRoutes(state: MatchState, ev: TickEvents): void {
  for (let i = state.routes.length - 1; i >= 0; i--) {
    const r = state.routes[i];
    const from = state.towers[r.fromId];
    if (!from || from.owner !== r.owner) {
      state.routes.splice(i, 1);
      ev.routesClosed.push({ fromId: r.fromId, toId: r.toId });
    }
  }

  for (const t of state.towers) {
    if (t.owner === 0) continue;
    const slots = routeSlotsFor(t.troops);
    while (countRoutesFrom(state, t.id) > slots) {
      const oldest = oldestRouteFrom(state, t.id);
      if (!oldest) break;
      closeRoute(state, oldest, ev);
    }
  }
}

/** 중립 타워(owner 0)에는 보정이 없다. */
function modsOf(state: MatchState, owner: Owner): PlayerMods {
  return owner === 0 ? NEUTRAL_MODS : state.mods[owner];
}

// 중립은 항상 기본값이다. 손으로 쓰면 `PlayerMods` 에 필드가 늘 때마다 여기가 뒤처진다.
const NEUTRAL_MODS: PlayerMods = defaultMods();

function countRoutesFrom(state: MatchState, towerId: number): number {
  let n = 0;
  for (const r of state.routes) if (r.fromId === towerId) n++;
  return n;
}

function oldestRouteFrom(state: MatchState, towerId: number): Route | null {
  let best: Route | null = null;
  for (const r of state.routes) {
    if (r.fromId !== towerId) continue;
    if (!best || r.openedTick < best.openedTick || (r.openedTick === best.openedTick && r.id < best.id)) {
      best = r;
    }
  }
  return best;
}

function closeRoute(state: MatchState, route: Route, ev: TickEvents): void {
  const i = state.routes.indexOf(route);
  if (i < 0) return;
  state.routes.splice(i, 1);
  ev.routesClosed.push({ fromId: route.fromId, toId: route.toId });
}

// ── 생산과 배출 ───────────────────────────────────────────────────

/**
 * 경로가 하나도 없는 타워만 재고가 쌓인다.
 * 경로를 여는 순간 성장이 멈추는 것 — 이게 "쌓기 vs 흘리기" 딜레마의 전부다.
 */
function produce(state: MatchState): void {
  const routed = new Set<number>();
  for (const r of state.routes) routed.add(r.fromId);

  for (const t of state.towers) {
    if (t.owner === 0 || routed.has(t.id)) continue;
    const cap = capacityOf(t);
    if (t.troops >= cap) continue;

    // 소유자의 영구 공속 강화가 생산에도 같이 걸린다. emit에만 걸면
    // "경로 1개 = ±0"이라는 경제 균형점이 깨진다.
    const gen = TOWER_GEN * modsOf(state, t.owner).speedMul;
    t.troops = Math.min(cap, t.troops + gen * TICK_DT);
  }
}

/** 경로마다 독립적으로 배출한다. 경로 3개면 출력도 3배다. */
function emitUnits(state: MatchState): void {
  for (const r of state.routes) {
    const from = state.towers[r.fromId];
    const to = state.towers[r.toId];
    if (!from || !to) continue;

    r.cooldown -= TICK_DT;
    if (r.cooldown > 0) continue;

    const mods = state.mods[r.owner];
    // 초과분을 남긴다. `=` 로 재설정하면 배출 간격이 틱 단위로 올림돼
    // 실제 배출률이 emit보다 낮아지고, 무엇보다 공속 강화가 계단으로 뭉개진다
    // (레벨 5 타워는 ×1.00~×1.16이 전부 7틱으로 같아져 1~4단계가 무효였다).
    r.cooldown += emitIntervalOf(from, mods.speedMul);

    state.units.push({
      id: state.nextUnitId++,
      owner: r.owner,
      fromId: r.fromId,
      toId: r.toId,
      // 상점에서 산 유닛 종류가 정하는 값이다 (`PlayerMods.unitPower`).
      // sim 은 종류 이름을 모른다 — `units.ts` 를 아는 것은 app/ 까지다.
      power: mods.unitPower,
      progress: 0,
      distance: Math.max(1, dist(from, to)),
      hops: 0,
    });
  }
}

export function unitPosition(state: MatchState, u: Unit, extraProgress = 0): { x: number; y: number } {
  const a = state.towers[u.fromId];
  const b = state.towers[u.toId];
  const p = clamp(u.progress + extraProgress, 0, 1);
  return { x: a.x + (b.x - a.x) * p, y: a.y + (b.y - a.y) * p };
}

/** 렌더러가 틱 사이를 보간할 때 쓰는 초당 progress 증가율. */
export function unitProgressRate(u: Unit): number {
  return UNIT_SPEED / u.distance;
}

// ── 충돌 ──────────────────────────────────────────────────────────

/**
 * 정면으로 맞물린 보급선 위에서만 적 유닛끼리 전투력을 맞교환한다.
 * 모든 유닛이 1이므로 마주친 둘은 언제나 함께 사라진다 — 순수한 1:1 소모전이다.
 *
 * 조건은 하나뿐이다: 두 유닛이 정확히 서로의 반대편 구간을 달리고 있을 것.
 * A가 B로 경로를 긋고 B도 A로 경로를 그은 그 통로에서만 싸움이 난다.
 *
 * 서로 다른 통로가 X자로 스쳐 지나가는 것은 충돌이 아니다. 그런 교차까지 판정하면
 * 엉뚱한 데서 병력이 사라지는데 화면에는 이유가 안 보여서, 플레이어는 자기 유닛이
 * 왜 줄었는지 알 수 없게 된다. 화면에서 색이 갈리는 통로가 곧 싸움이 나는 통로다.
 *
 * O(n²)이지만 유닛이 100기 안쪽이고 판정이 id 비교 두 번뿐이라 30Hz에서 문제없다.
 * 인덱스 순서로 순회하므로 결정론도 유지된다.
 */
function resolveCollisions(state: MatchState, ev: TickEvents): void {
  const units = state.units;
  if (units.length < 2) return;

  const pos = units.map((u) => unitPosition(state, u));

  for (let i = 0; i < units.length; i++) {
    const a = units[i];
    if (a.power <= 0) continue;

    for (let j = i + 1; j < units.length; j++) {
      const b = units[j];
      if (b.power <= 0 || b.owner === a.owner) continue;
      if (a.fromId !== b.toId || a.toId !== b.fromId) continue;
      if (dist(pos[i], pos[j]) > COLLISION_RADIUS) continue;

      const traded = Math.min(a.power, b.power);
      a.power -= traded;
      b.power -= traded;
      ev.clashes.push({ x: (pos[i].x + pos[j].x) / 2, y: (pos[i].y + pos[j].y) / 2 });

      if (a.power <= 0) break; // a가 죽었으면 더 부딪힐 것도 없다
    }
  }
}

// ── 이동 및 착탄 ──────────────────────────────────────────────────

function advanceUnits(state: MatchState, ev: TickEvents): void {
  const survivors: Unit[] = [];

  for (const u of state.units) {
    if (u.power <= 0) continue; // 충돌로 소멸

    u.progress += unitProgressRate(u) * TICK_DT;
    if (u.progress < 1) {
      survivors.push(u);
      continue;
    }
    // 중계된 유닛은 사라지지 않고 새 구간을 계속 달린다
    if (resolveImpact(state, u, ev)) survivors.push(u);
  }

  state.units = survivors;
}

/** 유닛이 중계되어 계속 살아 움직이면 true. */
function resolveImpact(state: MatchState, u: Unit, ev: TickEvents): boolean {
  const target = state.towers[u.toId];
  if (!target) return false;

  if (target.owner === u.owner) {
    // 상한에 찬 아군 타워는 흡수하지 못한다. 버리는 대신 경로로 흘려보낸다.
    if (isFull(target) && relayThrough(state, target, u, ev)) return true;

    // 아군 보급. 상한을 넘기지는 못한다.
    target.troops = Math.min(capacityOf(target), target.troops + u.power);
    ev.impacts.push({ towerId: target.id, by: u.owner, captured: false });
    return false;
  }

  const defMul = defenseMultiplierOf(target);
  const defPower = target.troops * defMul;

  if (u.power > defPower) {
    target.owner = u.owner;
    target.relayCursor = 0;
    target.troops = u.power - defPower;

    ev.captures.push({ towerId: target.id, by: u.owner });
    ev.impacts.push({ towerId: target.id, by: u.owner, captured: true });
  } else {
    // 수비 보정은 방어에만 붙는다. 깎인 방어력을 다시 재고로 환산해 되돌린다.
    target.troops = (defPower - u.power) / defMul;
    ev.impacts.push({ towerId: target.id, by: u.owner, captured: false });
  }
  return false;
}

/**
 * 상한에 찬 타워를 통과시킨다. 유닛은 소멸하지 않고 그 타워의 경로 중 하나를 타고 계속 간다.
 *
 * 경로가 여러 개면 번갈아 하나씩 내보낸다(라운드 로빈). 모든 경로로 복제하면
 * 중계기를 사슬처럼 이어 유닛을 기하급수로 불릴 수 있어 게임이 무너진다.
 *
 * 전투력은 그대로 유지된다 — 통과지 변환이 아니다.
 */
function relayThrough(state: MatchState, relay: Tower, u: Unit, ev: TickEvents): boolean {
  if (u.hops >= RELAY_MAX_HOPS) return false;

  const outs = state.routes.filter((r) => r.fromId === relay.id);
  if (outs.length === 0) return false;

  // 되돌아온 길로 다시 내보내면 두 중계기 사이에서 유닛이 왕복만 하게 된다
  const forward = outs.filter((r) => r.toId !== u.fromId);
  const pool = forward.length > 0 ? forward : outs;

  const route = pool[relay.relayCursor % pool.length];
  relay.relayCursor = (relay.relayCursor + 1) % pool.length;

  const to = state.towers[route.toId];
  if (!to) return false;

  u.fromId = relay.id;
  u.toId = route.toId;
  u.progress = 0;
  u.distance = Math.max(1, dist(relay, to));
  u.hops += 1;

  ev.relays.push({ towerId: relay.id });
  return true;
}

// ── 승패 ──────────────────────────────────────────────────────────

function resolveOutcome(state: MatchState): void {
  const alive1 = hasPresence(state, 1);
  const alive2 = hasPresence(state, 2);

  if (!alive1 && !alive2) {
    state.winner = 0;
    return;
  }
  if (!alive1) {
    state.winner = 2;
    return;
  }
  if (!alive2) {
    state.winner = 1;
    return;
  }
  if (state.elapsed < MATCH_TIME) return;

  // 시간 종료: 타워 수 → 총 전투력 순으로 비교
  const t1 = towerCount(state, 1);
  const t2 = towerCount(state, 2);
  if (t1 !== t2) {
    state.winner = t1 > t2 ? 1 : 2;
    return;
  }
  const p1 = totalPower(state, 1);
  const p2 = totalPower(state, 2);
  state.winner = p1 === p2 ? 0 : p1 > p2 ? 1 : 2;
}

/** 타워가 하나도 없어도 이동 중인 유닛이 있으면 아직 진 게 아니다. */
function hasPresence(state: MatchState, p: PlayerId): boolean {
  return (
    state.towers.some((t) => t.owner === p) || state.units.some((u) => u.owner === p && u.power > 0)
  );
}

export function towerCount(state: MatchState, owner: Owner): number {
  return state.towers.reduce((n, t) => n + (t.owner === owner ? 1 : 0), 0);
}

export function totalPower(state: MatchState, p: PlayerId): number {
  let total = 0;
  for (const t of state.towers) if (t.owner === p) total += t.troops;
  for (const u of state.units) if (u.owner === p) total += u.power;
  return total;
}

export function routesFrom(state: MatchState, towerId: number): Route[] {
  return state.routes.filter((r) => r.fromId === towerId);
}

// 기하 유틸은 sim/geometry.ts 에 있다. 기존 import 경로를 유지하려고 여기서 다시 내보낸다.
export { clamp, dist } from './geometry';
