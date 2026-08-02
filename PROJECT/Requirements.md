# Requirements — TowerWar

## Coding Patterns

- **`sim/` 보호**: 결정론적 lockstep이라 브라우저 API(DOM/오디오/i18n) 참조 금지. 절대 수정하지 않는다.
- **서버는 판정 안 한다**: `server.js` 는 시뮬레이션을 돌리지 않는다. 승패·타워 수는 클라이언트 보고로 믿고, 금액은 서버가 정한다 (클라이언트가 액수 보내면 무한 코인).
- **광고는 `net/ads.ts` 하나로**: 다른 파일은 이 모듈만 본다. `ready()` 가 false면 화면이 버튼을 안 그린다.
- **VX 결제는 `net/vx.ts`**: `ASSET_IDS` 가 비면 상점에 "준비 중". 자산 id는 실제 등록값만 사용.
- **상수 동기화**: 클라이언트-서버 상수는 어긋나면 안 된다 (Structure.md 참고).

## Known Issues / Constraints

- `server.js` 샌드박스에 자산 읽기 API가 없다. `grantEntitlement` 는 클라이언트를 믿는다 (남은 구멍, HANDOFF 참고).
- 광고를 봤는지 서버가 확인할 수 없다. 서버는 금액·간격·하루 상한만 막는다.
- `DEBUG_UNLOCK_ALL` 켜진 채 배포되면 유닛·배속이 전부 무료로 풀려 VX 상품이 안 팔린다. **배포 전 반드시 false 확인.**
