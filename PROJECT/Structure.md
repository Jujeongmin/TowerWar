# Structure — TowerWar

## 루트

- **`server.js`** — Verse8 GameServer (레거시 단일 파일). 매치메이킹, 명령 릴레이, 계정, 보상, 순위표, 광고 보상 서버 로직.
- **`vite.config.ts`** — root: `game`, envDir: 루트, outDir: `../dist`
- **`tools/server-harness.mjs`** — server.js 검증 하네스 (136 테스트). `__TW_NO_DEBUG_UNLOCK: true` 주입.
- **`.agent8.lock` / `.env`** — 플랫폼 관리 파일. 절대 수정 금지.

## `game/src/`

클라이언트 전체. 캔버스 2D, 프레임워크 없음.

- **`main.ts`** — 부트스트랩 + 씬 전환. 광고 provider 선택 분기 (DEV → 가짜, 프로덕션 → 실물).
- **`account/`** — 계정 데이터 (`account.ts`), 저장소 분기 (`store.ts`). `DEBUG_UNLOCK_ALL` 여기.
- **`net/`** — 네트워크 계층.
  - `ads.ts` — 보상형 광고 유일한 이음매. `AdProvider` 인터페이스 + `@verse8/ads` 실물 provider.
  - `agent8.ts` — Verse8 실물 트랜스포트 (`GameServer` 래핑). `shopUrl()`, `onAssets()`.
  - `vx.ts` — VX 유료 결제 연결. `ASSET_IDS` 표.
  - `local-backend.ts` — DEV 전용 로컬 백엔드 (동적 import라 프로덕션 번들에서 제외).
  - lockstep 관련: `lockstep.ts`, `lockstep-check.ts`, `loopback.ts`, `types.ts`, `hash.ts`.
- **`sim/`** — 결정론적 lockstep 시뮬레이션. **절대 수정 금지** (DOM/오디오/i18n 참조 금지).
- **`app/`** — 씬들 (lobby, shop, match, pvp, board, settings, name).
- **`render/`** — 캔버스 렌더러.
- **`audio.ts` / `i18n.ts` / `units.ts` / `profiles.ts` / `style.css`**

## 게임·서버 동기화 대상 (어긋나면 안 되는 값)

- 유닛 가격/종류: `units.ts` ↔ `server.js` `UNIT_PRICES` / `PREMIUM_UNITS`
- 배속 항목 id: `account.ts` `TEMPO_ITEM` ↔ `server.js` `TEMPO_ITEM` ↔ `net/vx.ts` `TEMPO_ITEM`
- 닉네임 규칙: `account.ts` `cleanName` ↔ `server.js` `cleanName`
- 보상 금액: `account.ts` ↔ `server.js`
- 광고 금액: `shop-scene.ts` ↔ `server.js` `AD_COINS`
