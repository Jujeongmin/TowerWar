/**
 * 봇 상대에게 붙이는 이름.
 *
 * ── 왜 사람 같은 이름을 붙이는가 ───────────────────────────────
 *
 * 사용자가 **봇 대체를 화면에 알리지 않기로 결정했다**(§-7). 그런데 HUD에 닉네임이
 * 생겼으므로 상대 자리를 비워 두거나 'BOT' 이라고 쓰면 그 결정이 그 자리에서 무너진다.
 * 그래서 사람 이름처럼 보이는 값을 만든다.
 *
 * **이건 기만이다.** 정직한 대안은 '연습 상대' 처럼 봇임을 드러내는 이름이고,
 * 그러려면 §-7 결정을 되돌려야 한다. 되돌리려면 이 파일의 `botName` 을
 * `() => '연습 상대'` 로 바꾸면 끝난다 — 다른 곳은 안 건드려도 된다.
 *
 * ── 순수 외형이다 ─────────────────────────────────────────────
 *
 * 시뮬레이션도 서버도 이 값을 모른다. 렌더러 HUD에만 들어간다.
 * 시드로 만들기 때문에 같은 판에서는 몇 번을 다시 그려도 같은 이름이 나온다.
 */

import { PROFILE_IDS, type ProfileId } from '../profiles';

const HEAD = [
  '검은', '푸른', '붉은', '조용한', '빠른', '늦은', '작은', '커다란',
  '외로운', '성난', '느긋한', '차가운', '뜨거운', '흐린',
] as const;

const TAIL = [
  '기사', '늑대', '까마귀', '방패', '창날', '바람', '노을', '서리',
  '망치', '여우', '북풍', '등불', '모래', '파도',
] as const;

/** 이름 뒤에 붙는 두 자리 숫자. 같은 조합이 두 번 나와도 달라 보이게 한다. */
const TAG_MOD = 90;

/** mulberry32. `sim/maps.ts` 와 같은 것 — 시드 하나로 안정된 값을 뽑기만 하면 된다. */
function rand(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 봇 상대의 아바타. 이름과 같은 이유로 사람처럼 보이는 것을 골라 준다.
 *
 * **전에는 `default` 를 뺐다** — 빈 실루엣이라 "아직 안 고른 사람"으로 읽혀서 봇이라는
 * 힌트가 됐기 때문이다. 2026-07-31에 아바타가 "캐릭터 고정 + 배경색"으로 바뀌면서
 * 안 고른 것과 고른 것이 그림으로 구분되지 않게 됐다. 그래서 전부에서 고른다 —
 * 오히려 한 색만 빼 두면 그 색이 절대 안 나오는 것이 신호가 된다.
 */
export function botProfile(seed: number): ProfileId {
  const r = rand((seed ^ 0x2545f491) >>> 0);
  return PROFILE_IDS[Math.floor(r() * PROFILE_IDS.length)];
}

export function botName(seed: number): string {
  // 맵 생성과 다른 스트림을 쓴다. 같은 스트림을 이어 쓰면 이름 규칙을 건드리는 것만으로
  // 모든 시드의 맵이 흔들린다.
  const r = rand((seed ^ 0x5bf03635) >>> 0);
  const head = HEAD[Math.floor(r() * HEAD.length)];
  const tail = TAIL[Math.floor(r() * TAIL.length)];
  const tag = 10 + Math.floor(r() * TAG_MOD);
  return `${head}${tail}${tag}`;
}
