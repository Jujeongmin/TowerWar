/**
 * 글씨를 상자 폭에 맞춰 줄인다. **자르지도 줄바꿈하지도 않는다** (2026-08-10 사용자
 * 지시 — "…으로 하지 말고 버튼 크기에 맞춰 텍스트 크기를 줄어들게").
 *
 * CSS 만으로는 못 한다. 상자 폭에 비례하는 단위(`cqi`)는 있지만 그것은 **글자 수를
 * 안 본다** — `English` 와 `Tiếng Việt` 이 똑같이 줄어들 뿐, 긴 쪽이 넘치는 것은
 * 그대로다. 실제로 그려진 글씨 폭을 재야 한다.
 *
 * 재려면 화면에 떠 있어야 한다. `hidden` 인 화면은 폭이 0 이라 아무것도 못 잰다 —
 * 그래서 씬이 `enter()` 에서 부르고, 여기서 창 크기 변화도 따로 받는다.
 */

/** 이보다 작아지면 멈춘다. 더 줄이면 읽을 수 없어서, 그때는 넘치는 편이 낫다. */
const MIN_PX = 8;

/** 창이 바뀌면 다시 재야 하는 것들. */
const watched = new Set<HTMLElement>();

/**
 * `label` 을 부모 상자의 안쪽 폭에 맞춘다.
 *
 * **`label` 은 인라인이어야 한다.** 블록이면 제 폭이 곧 상자 폭이라 넘쳤는지를 알 수 없다.
 */
export function fitText(label: HTMLElement): void {
  const box = label.parentElement;
  if (!box) return;

  const cs = getComputedStyle(box);
  const avail = box.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  // 아직 안 보이는 화면. 뜰 때 씬이 다시 부른다.
  if (!(avail > 0)) return;

  watched.add(label);

  // 스타일을 걷어 내고 원래 크기부터 다시 잰다. 화면 높이에 따라 기준 크기 자체가
  // 달라지므로(`--ui-scale`) 지난번 값을 그대로 쓰면 안 된다.
  label.style.fontSize = '';
  let size = parseFloat(getComputedStyle(label).fontSize);

  // 0.5px 씩 줄인다. 글자가 열 자 안팎이라 이분 탐색으로 얻을 것이 없다.
  while (size > MIN_PX && label.getBoundingClientRect().width > avail) {
    size -= 0.5;
    label.style.fontSize = `${size}px`;
  }
}

// 창이 바뀌면 상자 폭도 기준 글씨 크기도 달라진다. 화면에 안 떠 있는 것은 `avail` 이
// 0 이라 위에서 조용히 빠진다 — 그것들은 다음 `enter()` 가 맞춘다.
window.addEventListener('resize', () => {
  for (const label of watched) fitText(label);
});
