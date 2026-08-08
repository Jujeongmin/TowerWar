/**
 * 노치·펀치홀·상태바가 먹는 여백을 확정한다.
 *
 * CSS 는 `env(safe-area-inset-*)` 로 이미 밀어 두었는데(`style.css`, index.html 의
 * `viewport-fit=cover`), **그 값이 0으로 떨어지는 환경이 둘 있다**:
 *
 * 1. **iframe 안** — `viewport-fit=cover` 는 최상위 문서에만 먹는다. 중첩 문서의
 *    inset 은 규격상 언제나 0이다. Verse8 셸은 게임을 iframe 으로 싣는다
 *    (`settings-scene.ts` 의 `?auth=` 판정이 그 흔적이다).
 * 2. **앱으로 감싼 WebView** — 네이티브가 화면 끝까지(edge-to-edge) 그려 놓고
 *    inset 을 WebView 로 넘기지 않으면 웹 쪽은 가려진 줄이 있다는 것을 모른다.
 *    안드로이드 15(API 35)부터는 edge-to-edge 가 기본이라 이 쪽이 더 흔하다.
 *
 * 두 경우 다 화면은 카메라 구멍까지 뻗는데 웹은 0을 받는다. 그래서 전투 HUD
 * (판때기 66px, `renderer.ts` 의 `HUD_H`)가 카메라 밑으로 들어갔다
 * (2026-08-08 사용자 제보 — 아이폰 노치·갤럭시 상단 카메라).
 *
 * 여기서 **실측 → 폴백** 순으로 값을 정해 `--safe-top`/`--safe-bottom` 에 px 로 박는다.
 * CSS 도 렌더러도(`Renderer.resize`) 이 변수를 읽으므로 고칠 곳은 여기 하나다.
 */

/**
 * 폴백 상단 여백. **실측이 0인데 화면이 물리 화면 끝까지 뻗은 경우에만** 쓴다.
 *
 * 정확한 값은 웹에서 알 길이 없어(그 값을 안 주는 것이 문제다) 기기군의 최대치를
 * 잡았다. 넘치면 HUD 가 조금 내려올 뿐이고, 모자라면 글자가 가려진다 — 비대칭이라
 * 넉넉한 쪽으로 둔다.
 *
 * iOS: 노치 47, 다이나믹 아일랜드 59 → 59.
 * 안드로이드: 상태바 24~32dp 에 펀치홀 기기 여유를 더해 36.
 */
const FALLBACK_TOP_IOS = 59;
const FALLBACK_TOP_ANDROID = 36;

/**
 * "화면 끝까지 뻗었다"고 볼 높이 오차(px). 기기 배율 반올림으로 1~2px 은 늘 어긋난다.
 */
const EDGE_SLACK = 8;

const isIOS = (): boolean => /iPhone|iPad|iPod/i.test(navigator.userAgent);

/**
 * `env()` 실측.
 *
 * **커스텀 프로퍼티로 읽지 않는다.** `getComputedStyle` 이 돌려주는 커스텀 프로퍼티
 * 값은 브라우저에 따라 `env(...)` 원문 그대로여서 `parseFloat` 가 NaN 이 된다
 * (전에 `Renderer.resize` 가 `--safe-top` 을 그렇게 읽어 늘 0을 봤다). 실제 속성인
 * padding 에 넣으면 어느 브라우저든 px 로 해결된 값이 나온다.
 */
function measureEnv(): { top: number; bottom: number } {
  const probe = document.createElement('div');
  probe.style.cssText =
    'position:fixed;top:0;left:0;width:0;height:0;visibility:hidden;pointer-events:none;' +
    'padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)';
  document.body.appendChild(probe);
  const cs = getComputedStyle(probe);
  const top = parseFloat(cs.paddingTop) || 0;
  const bottom = parseFloat(cs.paddingBottom) || 0;
  probe.remove();
  return { top, bottom };
}

/**
 * 뷰포트가 물리 화면을 꽉 채우는가 — 즉 우리 위에 우리를 가려 줄 것이 없는가.
 *
 * 주소창이 있는 브라우저에서는 그 줄이 이미 카메라를 가리므로 폴백을 켜면 여백이
 * 두 번 들어간다. 높이가 사실상 같을 때만 켠다.
 *
 * **손가락 화면에서만** 본다. 데스크톱 전체화면(F11)도 높이가 같아지는데, 거기는
 * 가려질 카메라가 없다.
 */
function fillsScreen(): boolean {
  if (!window.matchMedia('(pointer: coarse)').matches) return false;
  return Math.abs(window.screen.height - window.innerHeight) <= EDGE_SLACK;
}

/**
 * 실측하고, 0으로 떨어졌으면 폴백을 얹어 `:root` 에 px 로 박는다.
 *
 * **하단은 폴백을 안 쓴다** — 제보된 것은 상단뿐이고, 하단을 넓히면 판이 그만큼
 * 작아진다. 실측이 되는 환경에서는 하단도 원래대로 들어간다.
 */
export function measureSafeArea(): void {
  const { top, bottom } = measureEnv();
  const safeTop =
    top > 0 || !fillsScreen() ? top : isIOS() ? FALLBACK_TOP_IOS : FALLBACK_TOP_ANDROID;
  const root = document.documentElement;
  root.style.setProperty('--safe-top', `${safeTop}px`);
  root.style.setProperty('--safe-bottom', `${bottom}px`);
}

/**
 * 회전·창 크기 변화마다 다시 잰다. 세로↔가로로 돌면 노치가 먹는 변이 바뀌고,
 * 주소창이 접히면 뷰포트가 화면을 꽉 채우게 되어 판정 자체가 뒤집힌다.
 *
 * `onChange` 는 값을 새로 박은 **뒤에** 부른다 — 렌더러는 CSS 변수를 읽어 가므로
 * 순서가 뒤집히면 한 프레임 옛 값으로 그린다. `Renderer` 의 ResizeObserver 는
 * 캔버스 크기가 안 바뀌면 안 도니 여기서 직접 깨워야 한다.
 */
export function watchSafeArea(onChange: () => void): void {
  const update = (): void => {
    measureSafeArea();
    onChange();
  };
  window.addEventListener('resize', update);
  window.addEventListener('orientationchange', update);
  // 주소창 접힘·소프트키보드처럼 화면 높이만 바뀌는 경우는 resize 가 안 올 수 있다.
  window.visualViewport?.addEventListener('resize', update);
}
