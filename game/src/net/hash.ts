/**
 * 상태 해시. 두 클라이언트가 정말 같은 판을 돌고 있는지 확인하는 데만 쓴다.
 *
 * 요구 조건 하나뿐이다: **같은 상태면 반드시 같은 문자열.**
 * 그래서 부동소수를 그대로 넣지 않고 고정 자리에서 끊는다 — 누적 오차가 마지막 자리에서만
 * 갈리는 경우까지 데싱크로 신고하면 쓸모없는 경보만 쌓인다.
 *
 * 암호학적 성질은 필요 없다. 상대가 해시를 위조해도 얻는 게 없고(판정은 어차피 양쪽 비교),
 * 진짜 방어는 서버 권위로 갈 때 붙는다.
 */
import type { MatchState } from '../sim/types';

/** 소수 셋째 자리에서 끊는다. 부동소수 누적 차이는 보통 그보다 아래에서 난다. */
function q(v: number): number {
  return Math.round(v * 1000);
}

export function hashState(state: MatchState): string {
  const parts: (string | number)[] = [state.tick];

  for (const t of state.towers) {
    parts.push(t.id, t.owner, q(t.troops), t.relayCursor);
  }
  // 경로와 유닛은 배열 순서 자체가 시뮬레이션 상태다 (충돌 순회가 인덱스 순).
  // 정렬하지 않고 그대로 넣어야 순서가 갈린 것도 잡힌다.
  for (const r of state.routes) {
    parts.push(r.id, r.owner, r.fromId, r.toId, q(r.cooldown));
  }
  for (const u of state.units) {
    parts.push(u.id, u.owner, u.fromId, u.toId, q(u.power), q(u.progress), u.hops);
  }
  parts.push(state.winner === null ? 'n' : state.winner);

  return fnv1a(parts.join(','));
}

/** FNV-1a 32비트. 짧고 빠르고 의존성이 없다. */
function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    // 32비트 곱셈을 오버플로 없이. Math.imul 이 없으면 자리가 날아간다.
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
