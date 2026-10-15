/**
 * 캠페인 맵 검증을 node 에서 돌린다 (`game/src/campaign/stages-check.ts`).
 *
 * TS 를 그대로 못 읽으므로 vite 에 딸려 오는 esbuild 로 한 파일로 묶어 메모리에서 평가한다.
 * sim/ 은 브라우저 API 를 안 쓰므로 node 에서 그대로 돈다 (README).
 */
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';

const res = await build({
  entryPoints: [new URL('../game/src/campaign/stages-check.ts', import.meta.url).pathname.replace(/^\/(\w:)/, '$1')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
  logLevel: 'silent',
});
const code = res.outputFiles[0].text;
const mod = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
const problems = mod.checkStages();

// 금액표가 서버와 같은가. 서버가 지급하고 클라이언트는 화면에 적기만 하므로, 어긋나면
// "+300 코인"이라 적어 놓고 다른 금액이 들어간다.
const server = readFileSync(new URL('../server.js', import.meta.url), 'utf8');
const table = server.match(/const CAMPAIGN_FIRST_CLEAR = \[([^\]]*)\]/);
const serverFirst = table ? table[1].split(',').map((s) => Number(s.trim())).filter((n) => n > 0) : [];
const clientFirst = mod.STAGES_FOR_CHECK.map((s) => s.firstClear);
if (JSON.stringify(serverFirst) !== JSON.stringify(clientFirst)) {
  problems.push(`첫 클리어 금액이 server.js 와 다름: 서버 ${serverFirst} / 클라 ${clientFirst}`);
}
const num = (re) => Number((server.match(re) || [])[1]);
if (num(/const CAMPAIGN_STAGES = (\d+)/) !== clientFirst.length) problems.push('스테이지 수가 server.js 와 다름');
if (num(/const CAMPAIGN_REPLAY_WIN = (\d+)/) !== mod.REPLAY_FOR_CHECK) problems.push('재클리어 금액이 server.js 와 다름');
if (problems.length) {
  console.error(`캠페인 맵 문제 ${problems.length}건:`);
  for (const p of problems) console.error('  ' + p);
  process.exit(1);
}
console.log('캠페인 맵 20판 이상 없음');
