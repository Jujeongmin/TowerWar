/**
 * 락스텝 진행 속도 조절 — **멈추는 대신 늦춘다** (2026-10-15).
 *
 * ── 왜 필요한가 ────────────────────────────────────────────────
 *
 * 락스텝은 상대 약속(`ackTick`)을 넘어설 수 없다. 두 기기의 시계는 처음부터 어긋나 있고
 * (시작 신호 도착 차이) 판 도중에도 어긋난다(모바일 프레임 튐·`MAX_ACCUMULATOR` 로 버린
 * 시간). 그러면 **앞선 쪽은 늘 상대 약속의 경계에 붙어** 배치가 올 때마다(130ms) 몇 틱
 * 돌고 멈추기를 반복한다. 멈춤이 400ms 미만이면 "대기 중"도 안 떠서 사람 눈에는 그냥
 * 버벅임·프레임 드랍으로 보인다.
 *
 * 랜덤디펜스는 이 문제가 없다 — 각자 자기 판만 돌려서 상대를 기다릴 일이 없다. TowerWar 는
 * 판 하나를 같이 쓰므로 기다림 자체는 못 없앤다. 대신 **기다림이 멈춤으로 보이지 않게**
 * 한다: 여유(`headroom`)가 줄면 미리 천천히 돌아서 경계에 닿지 않게 하고, 반대로 상대보다
 * 한참 뒤처졌으면 조금 빨리 돌아 따라잡는다.
 *
 * ── 왜 결정론에 안 걸리는가 ────────────────────────────────────
 *
 * 이 값은 **벽시계를 틱으로 바꾸는 비율**만 바꾼다. 틱 하나가 계산하는 내용, 명령이 걸리는
 * 틱은 그대로다. 배속(`tempoScaleOf`)과 같은 자리에 곱해진다.
 *
 * ── 왜 둘이 동시에 빨라지지 않는가 ─────────────────────────────
 *
 * 여유 = 상대 약속 − 내 틱 = (상대 틱 + 입력 지연) − 내 틱. 둘 다 `SPEED_UP_ABOVE`(입력
 * 지연보다 큼)를 넘으려면 서로가 서로보다 앞서야 해서 불가능하다. 그래서 따라잡기는 언제나
 * 뒤처진 한쪽만 하고, 판 전체가 실시간보다 빨라지는 일은 없다.
 */

/**
 * 여유를 볼 창(ms). **최솟값**을 쓴다 — 여유는 배치가 올 때마다 몇 틱씩 뛰었다가 줄어드는
 * 톱니 모양이라, 순간값을 쓰면 배치 사이마다 빨라졌다 느려졌다를 반복한다. 전송 주기(80ms)의
 * 몇 배는 돼야 톱니 바닥을 잡는다.
 */
const WINDOW_MS = 500;

/** 여유가 이보다 적으면 늦추기 시작한다(틱). 0에 닿으면 멈춤이다. */
const SLOW_BELOW = 4;
/** 늦출 때의 바닥. 이보다 느리면 멈춘 것과 다를 바 없이 보인다. */
const MIN_FACTOR = 0.7;
/** 여유가 입력 지연보다 이만큼 넘게 남으면 뒤처진 것으로 보고 따라잡는다(틱). */
const SPEED_UP_ABOVE = 3;
/** 따라잡을 때의 천장. 너무 빠르면 유닛이 눈에 띄게 빨라진다. */
const MAX_FACTOR = 1.12;
/** 여유 1틱당 배율 변화. */
const SLOPE = 0.075;

export class Pacer {
  private readonly samples: { at: number; headroom: number }[] = [];

  /**
   * 이번 프레임의 진행 배율.
   *
   * @param headroom    지금 더 돌릴 수 있는 틱 수 (상대 약속 − 다음 틱)
   * @param delayTicks  지금 배속에서의 입력 지연(틱). 따라잡기 기준이다
   * @param nowMs       벽시계(ms)
   */
  factor(headroom: number, delayTicks: number, nowMs: number): number {
    this.samples.push({ at: nowMs, headroom });
    while (this.samples.length > 1 && nowMs - this.samples[0].at > WINDOW_MS) this.samples.shift();
    let low = Infinity;
    for (const s of this.samples) if (s.headroom < low) low = s.headroom;

    if (low < SLOW_BELOW) return Math.max(MIN_FACTOR, 1 - (SLOW_BELOW - low) * SLOPE);
    const over = low - (delayTicks + SPEED_UP_ABOVE);
    if (over > 0) return Math.min(MAX_FACTOR, 1 + over * SLOPE * 0.5);
    return 1;
  }
}
