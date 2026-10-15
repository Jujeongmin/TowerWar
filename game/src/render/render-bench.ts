/**
 * 렌더 비용 측정. 게임 코드가 아니다 — 어디서도 import 하지 않아 빌드에 안 실린다.
 *
 * dev 서버 콘솔에서:
 * ```js
 * const B = await import('/src/render/render-bench.ts?v=' + Date.now());
 * await B.bench();
 * ```
 *
 * 실제 판처럼 유닛이 깔린 상태(봇 둘이 20초 싸운 뒤)를 만들어 `render` 를 여러 번 부르고
 * 한 번에 몇 ms 걸리는지 잰다. 캔버스는 폰 크기(390×844)·DPR 2 로 고정한다 — PC 화면
 * 크기로 재면 폰에서의 비용과 다르다. **절대값보다 고치기 전후 비교가 목적이다.**
 */
import { BOT_NORMAL, Bot } from '../ai/bot';
import { TICK_DT } from '../sim/config';
import { generateMap } from '../sim/maps';
import { createMatch, step } from '../sim/sim';
import { Renderer, type UiState } from './renderer';

/**
 * 같은 판·같은 시각을 한 장 그려 화면에 띄우고, 20×40 칸 평균색을 돌려준다.
 * 고치기 전후 서버에서 각각 불러 값을 비교하면 겉모습이 바뀌었는지 숫자로 보인다.
 */
export async function snapshot(): Promise<number[]> {
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:fixed;left:0;top:0;width:390px;height:844px;z-index:99999';
  document.body.append(canvas);
  Object.defineProperty(window, 'devicePixelRatio', { value: 2, configurable: true });
  const r = new Renderer(canvas);
  r.resize();
  await new Promise((res) => setTimeout(res, 1500));
  const state = createMatch(generateMap(7));
  const a = new Bot(1, BOT_NORMAL);
  const b = new Bot(2, BOT_NORMAL);
  for (let i = 0; i < 20 * 30; i++) step(state, [...a.think(state, TICK_DT), ...b.think(state, TICK_DT)]);
  const ui: UiState = { local: 1, dragFrom: null, pointer: null, dragTarget: null, cutPath: [], cutRoutes: [] };
  for (let i = 0; i < 30; i++) r.render(state, ui, 0.5, 1 / 60);
  const c = canvas.getContext('2d')!;
  const img = c.getImageData(0, 0, canvas.width, canvas.height).data;
  const out: number[] = [];
  const bw = canvas.width / 20;
  const bh = canvas.height / 40;
  for (let by = 0; by < 40; by++) {
    for (let bx = 0; bx < 20; bx++) {
      let s = 0;
      let n = 0;
      for (let y = Math.floor(by * bh); y < Math.floor((by + 1) * bh); y += 2) {
        for (let x = Math.floor(bx * bw); x < Math.floor((bx + 1) * bw); x += 2) {
          const i = (y * canvas.width + x) * 4;
          s += img[i] + img[i + 1] + img[i + 2];
          n++;
        }
      }
      out.push(Math.round(s / n / 3));
    }
  }
  return out;
}

export async function bench(frames = 600): Promise<{ msPerFrame: number; units: number }> {
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:fixed;left:0;top:0;width:390px;height:844px;z-index:-1';
  document.body.append(canvas);
  Object.defineProperty(window, 'devicePixelRatio', { value: 2, configurable: true });
  const r = new Renderer(canvas);
  r.resize();
  // 그림이 다 들어올 때까지 잠깐 기다린다 — 안 그러면 폴백(원)으로 그려 비용이 다르다.
  await new Promise((res) => setTimeout(res, 1500));

  const state = createMatch(generateMap(7));
  const a = new Bot(1, BOT_NORMAL);
  const b = new Bot(2, BOT_NORMAL);
  for (let i = 0; i < 20 * 30 && state.winner === null; i++) {
    step(state, [...a.think(state, TICK_DT), ...b.think(state, TICK_DT)]);
  }
  const ui: UiState = { local: 1, dragFrom: null, pointer: null, dragTarget: null, cutPath: [], cutRoutes: [] };

  for (let i = 0; i < 60; i++) r.render(state, ui, 0.5, 1 / 60); // 데우기
  const t0 = performance.now();
  for (let i = 0; i < frames; i++) r.render(state, ui, (i % 10) / 10, 1 / 60);
  // 그리기 명령이 GPU 에서 실제로 끝나기를 기다린다 — 안 그러면 큐에 쌓기만 잰다.
  canvas.getContext('2d')!.getImageData(0, 0, 1, 1);
  const ms = (performance.now() - t0) / frames;
  canvas.remove();
  return { msPerFrame: Math.round(ms * 100) / 100, units: state.units.length };
}
