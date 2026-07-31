# 로비 + 씬 전환 설계

작성일: 2026-07-28

## 무엇을 만드는가

로비 화면과 씬 전환 뼈대. 이번 사이클의 범위는 **그것뿐이다.**

```
로비 [PVE 시작]  →  매치(봇전)  →  결과  →  [다시 하기] | [로비로]
```

## 왜 이 범위인가 — 분해

"로비"라는 요청 안에 독립적인 덩어리가 다섯 개 들어 있었다. 한 스펙에 담기지 않아 쪼갰다.

| 조각 | 상태 | 이번 사이클 |
|---|---|---|
| A. 화면 전환 구조 | 미착수 | **이번에 함** |
| B. 계정 저장 + 재화 | 미착수 | 다음 |
| C. 로비 상점 | B에 의존 | B 다음 |
| D-1. PVE 캠페인 (스테이지) | 미착수 | 이후 |
| D-2. PVP 매치메이킹 + 네트코드 | 미착수. 가장 큼 | 마지막 |

A를 먼저 하는 이유:

- 상점의 화폐를 정하려면 "어디서 버는가"가 필요하고 그건 PVE 보상 구조 결정이다.
  지금 정하면 D-1을 앞당겨 설계하는 셈이 된다
- `main.ts`가 전역에 `state` / `bot` / `pending`을 들고 rAF를 돈다. 씬 전환을 넣으려면
  이걸 먼저 정리해야 한다. 뼈대를 세워두면 B·C·D가 각각 독립 작업이 된다

**PVP 버튼과 상점 버튼은 이번에 화면에 만들지 않는다.** 비활성 자리조차 두지 않기로 했다.
뼈대는 나중에 붙일 수 있게 짜되, 갈 곳 없는 버튼은 안 보여준다.

## 결정 사항

### 로비 UI는 DOM

로비는 버튼·목록·계정 정보처럼 문서에 가까운 UI다. 캔버스에 그리면 히트테스트를 손으로 짜야 한다.
매치 내 상점 버튼 하나 때문에 `renderer.shopHit`을 만들고, 그 뒤에서 절단 스와이프가 시작되는
버그를 따로 막아야 했다 — 버튼이 늘수록 이 비용이 선형으로 늘어난다.

역할 분담:

| 그리는 것 | 담당 |
|---|---|
| 매치 화면 전부 | 캔버스 |
| 승리/패배 글자, 화면 어둡게 | 캔버스 (`renderer.drawResult`) |
| **누를 수 있는 것 전부** | DOM |

### 씬 매니저 + 매치 캡슐화

`main.ts`는 전환만 맡고, 지금의 루프·상태·입력은 `MatchScene`으로 옮긴다.

대안으로 (a) `main.ts`에 `mode` 분기만 두는 안과 (b) 해시 라우터를 검토했다.
(a)는 오늘 가장 빠르지만 B·C·D를 붙일 때마다 `main.ts`가 부푼다. (b)는 지금 없는 문제를
푸는 데다 Verse8 임베드에서 URL 조작이 되는지 불확실하다.

## 구조

```
game/src/
  main.ts              앱 진입. rAF 루프 하나를 들고 씬 전환만
  app/
    scene.ts           Scene 인터페이스
    lobby-scene.ts     DOM 로비
    match-scene.ts     기존 루프·상태·입력을 옮긴 것
  render/  sim/  ai/   그대로
```

```ts
export interface Scene {
  enter(): void;
  exit(): void;
  /** rAF마다 호출. 로비는 아무것도 안 한다. */
  frame(dt: number): void;
}

export interface MatchOptions {
  mode: 'pve';
}
```

`MatchScene.enter(opts: MatchOptions = { mode: 'pve' })` 처럼 **선택 인자로 넓힌다.**
인자에 기본값이 있으면 `enter(): void` 를 그대로 만족하므로 인터페이스를 `unknown` 으로
느슨하게 만들 필요가 없다. 씬마다 다른 인자를 인터페이스에 욱여넣지 않는다.

**rAF 루프는 `main.ts`에 하나만 둔다.** 씬마다 루프를 돌리면 전환 순간에 둘이 겹쳐 돈다.

**`Renderer`는 앱 수명 동안 하나만 만든다.** 매치마다 새로 만들면 스프라이트 27장을 매번
다시 로드하고 틴트 캐시도 버려진다. `main.ts`가 만들어 `MatchScene`에 넘긴다.

**`sim/`은 한 줄도 안 바뀐다.** 그래서 이 작업의 밸런스 회귀 위험은 0이다.

## DOM

```html
<div id="lobby" class="screen">
  <h1>TowerWar</h1>
  <button id="btn-pve">PVE 시작</button>
</div>

<canvas id="stage"></canvas>

<div id="result" class="screen" hidden>
  <p id="result-title"></p>
  <button id="btn-again">다시 하기</button>
  <button id="btn-lobby">로비로</button>
</div>
```

## 수명 주기

| 시점 | 하는 일 |
|---|---|
| `MatchScene.enter({ mode })` | 캔버스 표시 → `renderer.resize()` → `createMatch(generateMap(seed))` → 봇 생성 → `InputController` 부착 → **`last`/`accumulator` 리셋** |
| `MatchScene.frame(dt)` | 고정 타임스텝 루프 → `renderer.render` → 승부가 났고 결과창이 안 떴으면 표시 |
| `MatchScene.restart()` | 상태만 새로 만들고 결과창 숨김. 입력·렌더러 재사용 |
| `MatchScene.exit()` | `input.dispose()` → 캔버스 숨김 → 결과창 숨김 |
| `LobbyScene.enter/exit` | `#lobby` 표시/숨김 |
| `LobbyScene.frame` | 빈 함수 |

전환:

```
로비 [PVE 시작] → switchTo('match', { mode: 'pve' })
매치 승부 결정   → 결과창 표시 (씬 유지)
결과 [다시 하기] → matchScene.restart()
결과 [로비로]    → switchTo('lobby')
```

승부가 나도 씬을 유지한다. `state.winner`가 정해져도 렌더러는 계속 그린다 —
여기서 씬을 바꾸면 마지막 점령 이펙트가 잘린다.

PVE 모드는 지금 봇전 그대로다. `enter`가 `new Bot(2)`를 만드는 것 외에 분기가 없다.
맵 시드도 지금과 같이 `generateMap(Date.now() & 0xffff)` 로 매판 새로 뽑는다.
스테이지가 생기면 `MatchOptions` 에 `stage` 를 더한다.

## 기존 코드에서 손대야 하는 곳

| 파일 | 변경 |
|---|---|
| `main.ts` | 루프·상태를 `MatchScene`으로 옮기고 씬 전환만 남긴다 |
| `render/input.ts` | `dispose()` 추가. `onDown`의 "승부 후 아무 데나 누르면 재시작" 제거 |
| `render/renderer.ts` | `drawResult`에서 "R 키 또는 화면을 눌러 다시 시작" 안내문만 제거 |
| `index.html` | 로비·결과 DOM 추가 |
| `style.css` | `.screen` 레이아웃, 버튼 스타일 |

`InputController.onDown`의 재시작 분기를 지우는 이유: 두면 결과 화면에서 아무 데나 눌러도
재시작돼 [로비로] 버튼을 누를 수 없다. R 키 재시작은 `main.ts`에 남긴다.

## 엣지 케이스

| 상황 | 대처 |
|---|---|
| PVE 버튼 연타 | `switchTo`가 이미 그 씬이면 즉시 반환 |
| 씬 왕복 시 리스너 누적 | `dispose()`에서 `pointerdown/move/up/cancel/contextmenu` 전부 제거 |
| 로비에서 R 키 | 현재 씬이 매치일 때만 처리 |
| 결과창 뜬 채 R 키 | `restart()` 경로로 합류시켜 결과창도 숨김 |

**누산기 리셋이 빠지면 버그가 난다.** 로비에 30초 머물다 진입하면 `now - last`가 30초가 되고
고정 타임스텝 루프가 한 프레임에 여러 틱을 몰아 돈다. 기존 `Math.min(0.25, …)` 클램프 덕에
최악이 7.5틱이지만 시작하자마자 화면이 튄다.

## 검증

테스트 프레임워크는 없다. 이 프로젝트 표준대로 헤드리스 브라우저 검증이다 (HANDOFF §6).

1. **씬 전환** — `switchTo` 후 `#lobby` / `#stage` / `#result` 표시 상태를 DOM에서 확인
2. **리스너 누수** (가장 중요) — 로비↔매치 **5회 왕복** 후 `pointerdown`+`pointerup` 한 번에
   emit된 Command 개수가 **정확히 1개**인지 확인. `dispose()`가 빠지면 6개가 나온다
3. **누산기 리셋** — 로비에 3초 머문 뒤 진입해 첫 프레임 `state.tick` 증가량이 1~2인지
   (리셋이 빠지면 7~8)
4. **`sim/` 무변경** — `sim/`·`config.ts` diff 없음 확인 → 밸런스 재측정 불필요
5. **렌더 성능** — 프레임당 0.688ms 근처 유지 (Renderer 재사용이 되면 안 변한다)

브라우저 패널이 숨겨져 있으면 `window.innerWidth`가 0이라 `Renderer.resize()`가 1px 캔버스를
잡는다. 검증 코드에서 `Object.defineProperty(window, 'innerWidth', { value: 1280 })` 로 고정할 것.

## 안 하는 것

씬 전환 애니메이션, 라우팅/딥링크, 로비 배경 연출, 설정 화면, 씬 스택(뒤로가기),
PVP·상점 버튼(비활성 포함), 스테이지 선택, 난이도 선택.
