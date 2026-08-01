/**
 * 시뮬레이션 도메인 타입.
 *
 * 이 폴더(`sim/`)의 코드는 브라우저 API와 렌더링에 일절 의존하지 않는다.
 * 서버 권위 PVP로 갈 때 Verse8의 server.js에서 그대로 돌려야 하기 때문이다.
 *
 * 핵심 모델: 타워는 "재고(troops)"를 쌓고, 경로(Route)를 열면 생산이 재고로
 * 적립되는 대신 경로를 타고 유닛(Unit)으로 흘러나간다. 재고는 줄지 않지만 늘지도 않는다.
 */

/** 0 = 중립. 1, 2 = 플레이어. */
export type Owner = 0 | 1 | 2;

export type PlayerId = 1 | 2;

export interface Tower {
  id: number;
  x: number;
  y: number;
  owner: Owner;
  /** 재고. 유닛 마리 수이자 그대로 방어 병력이다. */
  troops: number;
  /**
   * 중계 시 다음에 쓸 경로 인덱스. 통과 유닛을 경로들에 번갈아 내보내기 위한 것으로,
   * 렌더링이 아니라 시뮬레이션 상태다 — 서버와 클라이언트가 같은 값을 가져야 한다.
   */
  relayCursor: number;
}

/**
 * 지속되는 보급선. 한 번 깔면 끊을 때까지 유닛을 계속 뱉는다.
 * 경로 수는 출발 타워의 재고가 결정한다 (config.routeSlotsFor).
 */
export interface Route {
  id: number;
  owner: PlayerId;
  fromId: number;
  toId: number;
  /** 다음 유닛 배출까지 남은 시간(초). */
  cooldown: number;
  /** 슬롯이 모자랄 때 오래된 것부터 닫기 위한 순번. */
  openedTick: number;
}

/** 경로 위를 홀로 이동하는 유닛 1기. */
export interface Unit {
  id: number;
  owner: PlayerId;
  /** 경로가 닫혀도 이미 출발한 유닛은 목적지까지 간다. 그래서 좌표를 따로 들고 있다. */
  fromId: number;
  toId: number;
  /**
   * 남은 전투력. 항상 1로 태어나고 충돌에서 깎인다. 0이 되면 소멸.
   *
   * 값이 1 하나뿐인데도 남겨 둔 이유: 타워를 때릴 때 방어력과 비교하는 양이 이것이고,
   * 충돌이 `min(a.power, b.power)`로 맞교환하는 대상도 이것이다.
   */
  power: number;
  /** 0 → 1. 1이면 착탄. */
  progress: number;
  distance: number;
  /** 지금까지 거친 중계 횟수. RELAY_MAX_HOPS를 넘으면 더는 중계되지 않는다. */
  hops: number;
}

/**
 * 명령은 한 종류뿐이다.
 *
 * 레벨업(`upgrade`)은 2026-07-30에 사용자 지시로 제거했다. 되살리면 재고가
 * 경로 슬롯과 레벨업 두 곳에 쓰이게 되어 딜레마가 다시 두 축이 된다.
 */
export type Command =
  /** 같은 쌍에 이미 경로가 있으면 닫고, 없으면 연다. */
  | { kind: 'toggleRoute'; player: PlayerId; fromId: number; toId: number }
  /**
   * 항복. 상대의 승리로 판을 즉시 끝낸다.
   *
   * **씬이 아니라 커맨드인 것이 핵심이다.** PVP는 락스텝이라 내 쪽에서만 판을 끝내면
   * 두 시뮬레이션이 갈라지고, 그냥 나가면 상대가 내 입력을 기다리며 멈춘다.
   * `toggleRoute` 와 같은 파이프로 흘려야 양쪽이 **같은 틱에** 같은 결과를 낸다.
   *
   * 남 대신 항복시키는 것은 서버가 막는다 — `cmd.player` 를 서버가 덮어쓴다 (§-5).
   */
  | { kind: 'resign'; player: PlayerId }
  /**
   * 배속 토글. **판 전체가 빨라진다 — 누른 사람만이 아니다.**
   *
   * 켠 사람 수만큼 `+0.5` 씩 더한다 (`tempoScaleOf`): 아무도 안 켜면 1.0, 한 명이면
   * 1.5, 둘이면 2.0. 그래서 **양쪽이 언제나 같은 배속으로 돈다** — 락스텝이 깨지지
   * 않는 이유가 이것이다. 한쪽만 빠르게 하면 같은 틱을 다르게 돌아 즉시 데싱크다.
   *
   * 시뮬레이션 내용물은 한 글자도 안 바뀐다. 바뀌는 것은 **"현실 1초에 틱을 몇 개
   * 돌리나"** 뿐이라, 판 길이는 여전히 `MATCH_TIME` 초(게임 안 시간)다.
   *
   * 살 수 있는 사람만 켤 수 있다 — 판정은 `mods[player].canTempo` 이고 그 값은
   * 서버가 판 시작에 정한다. **클라이언트가 아니라 상태로 거르는 이유**: 조작된
   * 클라이언트가 이 명령을 보내도 양쪽이 똑같이 무시해야 갈라지지 않는다.
   */
  | { kind: 'setTempo'; player: PlayerId; on: boolean };

/**
 * 매치 밖에서 정해져 들어오는 플레이어별 보정. 로비 상점의 영구 강화가 여기로 들어온다.
 *
 * **매치가 시작될 때 한 번 정해지고 그 뒤로 안 바뀐다.** 매치 중에 이 값을 올리는 명령은
 * 없다 — 그건 로비에서 하는 일이다. 그래서 커맨드가 아니라 상태의 일부다.
 *
 * 시뮬레이션 결과를 바꾸는 값이므로 반드시 MatchState 안에 있어야 한다.
 * 클라이언트가 따로 들고 있으면 서버 권위 PVP에서 결과가 갈라진다.
 */
export interface PlayerMods {
  /** 재고 생산(gen)과 유닛 배출(emit)에 함께 곱하는 배수. 기본 1. */
  speedMul: number;
  /**
   * 배속을 켤 수 있는 사람인가 (유료 항목). **서버가 판 시작에 정한다.**
   *
   * 여기 두는 이유: `setTempo` 를 무시할지 말지는 **양쪽이 똑같이** 판단해야 한다.
   * 클라이언트가 "나는 못 켜니까 안 보낸다"로만 막으면, 조작된 클라이언트가 보낸
   * 순간 그쪽만 배속이 걸려 갈라진다.
   */
  canTempo?: boolean;
  /**
   * 이 사람의 유닛 1기가 갖는 힘. 기본 1. **상점에서 산 유닛 종류가 정한다.**
   *
   * `Unit.power` 하나가 **체력이자 공격력**이다. 충돌이
   * `traded = Math.min(a.power, b.power)` 라, "각자 자기 power 만큼 때리고 power 만큼
   * 버틴다"와 결과가 정확히 같다 — 체력과 공격력을 필드 둘로 나눠도 죽는 쪽·남는 값이
   * 한 글자도 안 달라진다. 그래서 필드를 안 나눴다.
   *
   * 같은 값이 **타워에 넣는 재고량**과 **적 타워 공격력**도 겸한다 (`resolveImpact`).
   * 즉 이 축은 전투만이 아니라 경제도 같이 키운다 — §-0.75가 잰 중계 폭증의 원인이다.
   */
  unitPower: number;
}

export function defaultMods(): PlayerMods {
  return { speedMul: 1, unitPower: 1 };
}

/** 한 판의 전체 상태. 이 객체만으로 화면을 완전히 복원할 수 있어야 한다. */
export interface MatchState {
  tick: number;
  /** 경과 시간(초). 항상 tick * TICK_DT 와 같다. */
  elapsed: number;
  towers: Tower[];
  routes: Route[];
  units: Unit[];
  nextRouteId: number;
  nextUnitId: number;
  /** 플레이어별 보정. 매치 생성 시 로비 상점 강화가 주입된다. */
  mods: Record<PlayerId, PlayerMods>;
  /**
   * 지금 배속을 켜 둔 사람들. `setTempo` 가 여기를 바꾼다.
   *
   * **시뮬레이션은 이 값을 안 읽는다.** 틱 하나가 계산하는 것은 배속과 무관하고,
   * 이 값을 보는 것은 틱을 얼마나 자주 돌릴지 정하는 바깥 루프(`MatchScene.frame`)와
   * 화면뿐이다. 그래도 상태에 두는 이유는 **양쪽이 같은 값을 같은 틱에** 가져야
   * 하기 때문이다 — 씬이 따로 들면 명령이 도착하는 순서에 따라 갈린다.
   */
  tempo: Record<PlayerId, boolean>;
  /** null이면 진행 중. 0이면 무승부. */
  winner: Owner | null;
}

/** 이번 틱에 실제로 일어난 일 — 렌더러가 이펙트를 트리거하는 데 쓴다. */
export interface TickEvents {
  captures: { towerId: number; by: PlayerId }[];
  impacts: { towerId: number; by: PlayerId; captured: boolean }[];
  /** 적 유닛끼리 부딪힌 지점. */
  clashes: { x: number; y: number }[];
  /** 상한에 찬 타워를 그대로 통과해 나간 유닛. */
  relays: { towerId: number }[];
  /** 슬롯 부족·타워 상실 등으로 자동으로 닫힌 경로. */
  routesClosed: { fromId: number; toId: number }[];
}

export function emptyEvents(): TickEvents {
  return {
    captures: [],
    impacts: [],
    clashes: [],
    relays: [],
    routesClosed: [],
  };
}
