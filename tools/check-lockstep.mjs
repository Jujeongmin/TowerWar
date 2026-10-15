/**
 * 락스텝 체감 측정을 node 에서 돌린다 (`game/src/net/lockstep-sim.ts`).
 * TS 를 vite 에 딸려 오는 esbuild 로 한 파일로 묶어 메모리에서 평가한다 (`check-stages.mjs` 와 같은 방식).
 *
 * 데싱크나 늦은 배치가 하나라도 나오면 실패로 끝난다. 매끄러움 수치는 표로만 찍는다 —
 * 실기 지연은 여기서 못 재므로 합격선을 박지 않는다.
 */
import { build } from 'esbuild';

const res = await build({
  entryPoints: [new URL('../game/src/net/lockstep-sim.ts', import.meta.url).pathname.replace(/^\/(\w:)/, '$1')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
  logLevel: 'silent',
});
const mod = await import('data:text/javascript;base64,' + Buffer.from(res.outputFiles[0].text).toString('base64'));
const results = mod.runAll();

// 네트워크 × 방식으로 묶어 시드 평균을 낸다.
const groups = new Map();
for (const r of results) {
  const key = `${r.net} | ${r.variant}`;
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(r);
}
const avg = (xs) => Math.round((xs.reduce((s, x) => s + x, 0) / xs.length) * 10) / 10;
let bad = 0;
const rows = [];
for (const [key, rs] of groups) {
  const both = (f) => avg(rs.flatMap((r) => [f(r.a), f(r.b)]));
  bad += rs.filter((r) => r.desync || r.lateBatches > 0).length;
  rows.push({
    '조건 | 방식': key,
    '멈춘 프레임%': both((s) => (s.stallFrames / s.frames) * 100),
    '짧은 멈춤(<0.4s)': both((s) => s.shortStalls),
    '긴 멈춤': both((s) => s.longStalls),
    '최장 멈춤ms': both((s) => s.longestStallMs),
    '몰아돌림 프레임': both((s) => s.burstFrames),
    '최대 틱/프레임': both((s) => s.maxTicksPerFrame),
    '진행 속도%': avg(rs.map((r) => r.speedPct)),
    '늦은 배치': rs.reduce((s, r) => s + r.lateBatches, 0),
    '데싱크': rs.filter((r) => r.desync).length,
  });
}
console.table(rows);
if (bad) {
  console.error(`데싱크·늦은 배치 ${bad}건`);
  process.exit(1);
}
console.log('데싱크 0 · 늦은 배치 0');
