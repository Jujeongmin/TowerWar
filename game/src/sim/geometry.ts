/**
 * 순수 기하 유틸. 시뮬레이션·입력·렌더러가 공유한다.
 * 상태를 모르는 함수들만 둔다.
 */

export interface Vec {
  x: number;
  y: number;
}

export function dist(a: Vec, b: Vec): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * 선분 ab와 cd가 교차하는가.
 * 방향(외적 부호) 판정 — 부동소수 오차에 관대하도록 일직선 겹침은 교차로 보지 않는다.
 * 스와이프로 경로를 끊을 때 쓴다.
 */
export function segmentsIntersect(a: Vec, b: Vec, c: Vec, d: Vec): boolean {
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/**
 * 선분 ab와 cd가 만나는 지점. 만나지 않거나 평행하면 null.
 * segmentsIntersect가 "만나는가"만 답한다면 이쪽은 "어디서"까지 답한다.
 */
export function segmentIntersectionPoint(a: Vec, b: Vec, c: Vec, d: Vec): Vec | null {
  const r = { x: b.x - a.x, y: b.y - a.y };
  const s = { x: d.x - c.x, y: d.y - c.y };
  const denom = r.x * s.y - r.y * s.x;
  if (denom === 0) return null; // 평행하거나 일직선

  const t = ((c.x - a.x) * s.y - (c.y - a.y) * s.x) / denom;
  const u = ((c.x - a.x) * r.y - (c.y - a.y) * r.x) / denom;
  if (t <= 0 || t >= 1 || u <= 0 || u >= 1) return null; // 선분 바깥에서 만남

  return { x: a.x + t * r.x, y: a.y + t * r.y };
}

/**
 * 점 p에서 선분 ab까지의 최단 거리.
 * 경로 위에 다른 타워가 걸쳐 있는지 판정하는 데 쓴다.
 */
export function distToSegment(p: Vec, a: Vec, b: Vec): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return dist(p, a);

  // 선분 위로 투영한 위치를 [0,1]로 자른다 — 끝점 바깥이면 끝점까지의 거리가 답이다
  const t = clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq, 0, 1);
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** (p2-p1) × (p-p1) 의 z성분. 부호가 p의 좌우를 알려준다. */
function cross(p1: Vec, p2: Vec, p: Vec): number {
  return (p2.x - p1.x) * (p.y - p1.y) - (p2.y - p1.y) * (p.x - p1.x);
}
