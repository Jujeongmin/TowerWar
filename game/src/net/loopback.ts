/**
 * 검증용 트랜스포트. 두 클라이언트를 한 프로세스에 붙인다.
 *
 * Verse8에 배포하지 않고 락스텝을 통째로 돌려 볼 수 있어야 한다 —
 * 배포는 계정이 있어야 하고, 데싱크는 배포 후에 발견하면 원인을 찾기가 훨씬 어렵다.
 *
 * 실서버를 흉내 내는 부분이 하나 있다: **보낸 배치가 자기 자신에게도 돌아온다.**
 * `$room.broadcastToRoom` 이 보낸 사람에게도 가기 때문이고, 락스텝이 그 에코를
 * 제대로 버리는지까지 여기서 확인해야 한다.
 */
import type { InputBatch, MatchTransport } from './types';

export class LoopbackHub {
  private handlers = new Set<(b: InputBatch) => void>();
  /** 도착을 미룬 배치들. `flush(now)` 로 시간을 흘린다. */
  private queue: { at: number; batch: InputBatch }[] = [];
  private now = 0;

  /** 편도 지연(ms). 실제 왕복을 흉내 내 입력 지연이 충분한지 본다. */
  constructor(private latencyMs = 0) {}

  port(): MatchTransport {
    return {
      send: (batch) => {
        // 구조적 복사. 참조를 그대로 넘기면 한쪽이 배열을 재사용했을 때
        // 상대 상태가 조용히 바뀌어, 실제로는 없는 결정론을 검증하게 된다.
        const copy: InputBatch = JSON.parse(JSON.stringify(batch));
        this.queue.push({ at: this.now + this.latencyMs, batch: copy });
      },
      onBatch: (h) => {
        this.handlers.add(h);
        return () => this.handlers.delete(h);
      },
    };
  }

  /** 시간을 `ms` 만큼 흘려 도착할 것들을 배달한다. */
  advance(ms: number): void {
    this.now += ms;
    const due = this.queue.filter((q) => q.at <= this.now);
    this.queue = this.queue.filter((q) => q.at > this.now);
    for (const { batch } of due) {
      for (const h of this.handlers) h(batch);
    }
  }

  get pending(): number {
    return this.queue.length;
  }
}
