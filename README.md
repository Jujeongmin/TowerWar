# TowerWar

보급선을 긋고 전선을 미는 실시간 전략 게임. 세로형 모바일 웹.

TypeScript + Canvas 2D, 렌더 라이브러리 없음. 배포는 [Verse8](https://verse8.io) 플랫폼.

```
로비 ─┬─ 자동 매칭 ── 상대를 못 찾으면 조용히 봇전
      ├─ 친구랑 하기 ── 방 코드 4자리
      └─ 상점 ── 생산 속도 강화 · 유닛 5종
```

- **1v1 실시간.** 결정론적 락스텝 — 양쪽이 같은 시드로 같은 시뮬레이션을 돌리고
  서버는 명령만 중계한다. 매 틱 상태 해시를 비교해 데싱크를 잡는다.
- **재화·강화·소유 판정은 서버에 있다.** 클라이언트가 보낸 숫자를 안 믿는다.
- **`sim/` 은 브라우저 API를 일절 안 쓴다.** 서버 권위로 옮길 때 그대로 돌리기 위해서다.

## 실행

```bash
npm install
npm run dev
```

| 명령 | 하는 일 |
|---|---|
| `npm run dev` | 개발 서버 (포트 고정 아님) |
| `npm run build` | `tsc && vite build` → `dist/` |
| `npm run test:server` | `server.js` 로직 검증. 배포 없이 돈다 |
| `npx tsc --noEmit` | 타입 체크 |

배포 전에도 끝까지 플레이된다 — 실서버에 못 붙으면 조용히 봇전으로 넘어간다.
개발 빌드에서는 진짜 `server.js` 를 브라우저에서 돌리는 로컬 백엔드가 붙어
방 코드 발급까지 시험할 수 있다 (프로덕션 번들에는 안 실린다).

## ⚠ 그림이 저장소에 없다

`game/public/assets/` 는 `.gitignore` 에 있다. **라이선스 때문이다** —
[Tiny Swords](https://pixelfrog-assets.itch.io/tiny-swords)(건물)는 에셋 재배포를
금지하고, 유닛·아바타로 쓰는 BeerGang 3D 는 상용 사용 권한이 아직 확인되지 않았다.

**클론해서 바로 돌리면 게임은 정상 작동하되 그림 대신 원·도형으로 그려진다.**
렌더러가 스프라이트를 못 받았을 때의 폴백 경로이고, 일부러 남겨 둔 것이다.

그림까지 되살리려면 원본을 `assets-src/` 에 놓고 다시 뽑아야 한다. 방법은
`HANDOFF.md` 의 §-16(유닛 베이커) · §-24(정면·후면) · §7(타워 추출)에 있다.

## 구조

```
vite.config.ts        root:'game', outDir:'../dist'
server.js             Verse8 게임서버. 매치메이킹·명령 릴레이·계정·보상
tools/                server.js 검증 하네스
game/src/
  sim/                결정론적 시뮬레이션. DOM 의존 없음
  ai/bot.ts           사람과 똑같은 Command 만 낸다
  net/                락스텝 PVP 계층
  render/             Canvas 2D. 상태를 읽기만 한다
  app/                씬 전환 · 로비 · 상점 · 매칭
  account/            계정. 서버/로컬 중 어디가 진짜인지 정한다
  tools/bake-units.ts 3D(GLB/FBX) → 2D 스프라이트 베이커. 빌드에 안 실린다
```

## 이어서 작업할 때

**`HANDOFF.md` 를 먼저 읽을 것.** 왜 그렇게 했는지, 뭘 재봤는지, 어디가 지뢰인지가
전부 거기 있다. 특히 §0(지뢰)과 §8(작업 스타일)부터.

작업 브랜치는 `dev` 다.
