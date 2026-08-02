# Context — TowerWar

## Project Overview

세로형 모바일 실시간 전략 게임. 캔버스 2D(프레임워크 없음) + TypeScript + Vite. 결정론적 lockstep 시뮬레이션이 `game/src/sim/` 에 있고, Verse8 GameServer(`server.js`)가 매치메이킹·명령 릴레이·계정·보상을 맡는다. 서버는 시뮬레이션을 돌리지 않는다 — 승패는 클라이언트 보고로 믿는다.

## Tech Stack

- **클라이언트**: Vite + TypeScript, 캔버스 2D (React/Three 아님)
- **서버**: Verse8 GameServer SDK (루트 `server.js`, 레거시 단일 파일)
- **결제**: Verse8 VX / CrossRamp (`getCrossRampShopUrl` + `subscribeAsset`)
- **광고**: `@verse8/ads` (보상형) — `net/ads.ts` 가 유일한 이음매
- **시뮬레이션**: 결정론적 lockstep (`game/src/sim/`) — DOM/오디오/i18n 참조 금지

## Critical Memory

- `game/src/sim/` 은 절대 건드리지 않는다. DOM/오디오/i18n 참조가 하나라도 들어가면 PVP 동기화가 깨진다.
- `server.js` 는 `class Server` 를 정의만 하고 export 하지 않는다. `setTimeout`/`setInterval` 금지.
- 광고 제공자는 `setAdProvider()` 로 하나만 붙는다. DEV에선 가짜, 프로덕션에선 `@verse8/ads` 실물.
- VX 자산 id(`ASSET_IDS`)는 Verse8 대시보드에 상품을 등록해 받은 실제 값만 채운다. 지어내면 안 된다.
- `DEBUG_UNLOCK_ALL` 은 클라이언트(`account.ts`)와 서버(`server.js`) 양쪽에 있다. 배포 전 둘 다 `false` 여야 한다.
