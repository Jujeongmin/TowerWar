# Status — TowerWar

## 마지막 작업 (PVP 교착 버그 수정)

- **증상**: PVP 매칭 후 "상대를 기다리는중"이 뜨고 시뮬레이션·클릭이 영원히 멈춤.
- **원인**: `net/lockstep.ts` `pump()` 가 `state.tick`에 묶여, stalled로 틱이 멈추면 배치를 안 보내 양쪽이 서로를 기다리는 교착.
- **고침**: `lastSentFor`를 execTick 기준으로 두고, 멈춰도 빈 배치를 계속 보내 `ackTick`을 올려 복구되게 함.
- **검증**: 락스텝 검증 10/10 (지연 500/1000ms stall 케이스 포함), `npm run verify` 158/158.

## 마지막 작업 (화면 스크롤 제거)

- `:root` 에 `--ui-scale: clamp(0.78, calc(100dvh / 780px), 1)` 추가 — 짧은 화면(가로 모드·작은 세로)에서 폰트·간격·버튼을 비례 축소해 한 화면에 맞춤.
- `.screen` 에 `overflow: hidden`, `.screen-scroll` 은 `overflow-y: hidden` 으로 — 어떤 화면도 스크롤바가 안 생김.
- 상점/로비/PVP 요소들에 `--ui-scale` 반영 (유닛 카드, `.shop-row`, `.btn`, `.logo`, `.mascot`, PVP 코드 등).
- 실측: 812px→1.0, 667px→0.855, 480px 이하→0.78.

## 이전 작업 (모바일 효과음 수정)

- **원인**: `sfx/` 효과음 10개가 전부 `.ogg` 였다. iOS Safari 는 `.ogg` 를 디코딩 못 해 효과음만 조용했다 (BGM은 `.mp3` 라 들림).
- **고침**: `ffmpeg-static` 으로 전부 `.mp3` 변환 (모노 44.1kHz/128kbps). `.ogg` 삭제. 배포물에 mp3 10개 포함 확인.

## 이전 작업 (세로형 반응형)

- **게임 컬럼 폭 제한**: `style.css` 에 `--app-w: min(100vw, 620px)` 추가. 캔버스·DOM 화면(`.screen`)·HUD 버튼(항복·배속)이 넓은 화면에서도 컬럼 안에 붙는다 (이전에는 필드만 좁고 HUD/DOM이 뷰포트 전체 폭을 차지해 따로 놀았다).
- **렌더러**: `resize()` 가 `window.innerWidth` 대신 캔버스 실제 배치 폭(`getBoundingClientRect`)을 읽고 `viewW/viewH` 로 저장. `drawHud`/`drawResult` 가 이 값을 씀.

## 이전 작업 (Verse8 SDK 연동)

1. **보상형 광고 실물 붙임** — `@verse8/ads` 추가. `net/ads.ts` 에 `verse8AdProvider()` 구현 (showRewarded, `rewarded`일 때만 true, `unsupported_env`면 ready false). `main.ts` 에서 프로덕션은 실물, DEV는 가짜.
2. **VX 자산 id** — `ASSET_IDS` (net/vx.ts)는 여전히 비어 있음. **Verse8 대시보드에 상품 등록 + 실제 자산 id 필요.** 지어내면 안 됨 (사용자 지시).
3. **CrossRamp 실물 확인** — `getCrossRampShopUrl(lang?)`, `subscribeAsset(account, cb)` 둘 다 GameServer에 실제 존재. 시그니처 일치, 코드 수정 불필요.
4. **디버그 플래그 off** — `account.ts:43` `DEBUG_UNLOCK_ALL = false`, `server.js:172` `DEBUG_UNLOCK_ALL = false`.

## 검증

- `npm run verify`: **136/136 테스트 통과 + tsc 에러 0 + 빌드 성공** (확인 완료).

## 다음 단계 (사용자가 직접)

- Verse8 대시보드에 상품 등록 → `beergang_rainbow` / `tempo_boost` 실제 자산 id를 `net/vx.ts` `ASSET_IDS` 에 채우기.
- 그 뒤 `subscribeAsset` 이 그 id를 내려주는지 콘솔 확인.
- 배포.
