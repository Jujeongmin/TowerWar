# Status — TowerWar

## 마지막 작업 (Verse8 SDK 연동)

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
