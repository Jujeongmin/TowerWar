/**
 * 7일 출석판 (CrazyGames 판에서 이식, 2026-11-24). 금액·날짜는 서버(`server.js` claimAttendance)가 정한다.
 * 로비에 올 때 오늘 칸이 열려 있으면 자동으로 뜬다. 받으면 도장이 찍히고 "내일" 칸이 보인다.
 */
import { ATTENDANCE, attendanceState, type Account } from '../account/account';
import { audio } from '../audio';
import { tx } from '../i18n-cg';

export class AttendanceModal {
  private onChange: (() => void) | null = null;

  constructor(
    private readonly root: HTMLElement,
    private readonly getAccount: () => Account,
    private readonly claim: () => Promise<{ gained: number; day: number } | null>,
  ) {
    root.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t === root || t.closest('[data-act=close]')) this.close();
      else if (t.closest('[data-act=claim]')) void this.doClaim();
    });
  }

  open(onChange?: () => void): void {
    this.onChange = onChange ?? null;
    this.draw(0);
    this.root.hidden = false;
  }

  close(): void {
    this.root.hidden = true;
    this.onChange?.();
  }

  /** 결과 화면 약속 문구: 오늘 아직 안 받았으면 "로비에서 받으세요", 받았으면 "내일 +N". */
  promise(): string {
    const st = attendanceState(this.getAccount(), Date.now());
    const amt = ATTENDANCE[st.next - 1];
    return st.canClaim ? tx('promiseClaim', amt) : tx('promiseTomorrow', amt);
  }

  private busy = false;
  private async doClaim(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    const btn = this.root.querySelector<HTMLButtonElement>('[data-act=claim]');
    if (btn) btn.disabled = true;
    const r = await this.claim();
    this.busy = false;
    if (r && r.gained > 0) {
      audio.play('reward');
      this.draw(r.day);
      this.onChange?.();
    } else {
      this.draw(0); // 서버가 거절(오프라인·이미 받음) — 지금 상태로 다시 그린다
    }
  }

  private draw(justClaimed: number): void {
    const st = attendanceState(this.getAccount(), Date.now());
    const cells = ATTENDANCE.map((amt, i) => {
      const day = i + 1;
      const done = day <= st.stamped;
      const today = st.canClaim && day === st.next;
      const tomorrow = !st.canClaim && day === st.next;
      const cls = [
        'att-cell',
        done ? 'is-done' : '',
        today ? 'is-today' : '',
        tomorrow ? 'is-tomorrow' : '',
        day === justClaimed ? 'is-stamp' : '',
        day === ATTENDANCE.length ? 'is-big' : '',
      ].join(' ');
      const tag = today ? tx('attendToday') : tomorrow ? tx('attendTomorrow') : '';
      return `<div class="${cls}">
        <span class="att-day">${tx('attendDay', day)}</span>
        <img class="att-ico" src="/assets/ui/${day === ATTENDANCE.length ? 'icon-chest' : 'icon-coin'}.png" alt="" />
        <span class="att-amt">${amt.toLocaleString()}</span>
        ${tag ? `<span class="att-tag">${tag}</span>` : ''}
        ${done ? '<span class="att-check" aria-hidden="true"></span>' : ''}
      </div>`;
    }).join('');
    const amt = ATTENDANCE[st.next - 1];
    this.root.innerHTML = `<div class="modal-panel att-panel">
      <button class="modal-x" data-act="close" aria-label="${tx('close')}"></button>
      <img class="modal-chest" src="/assets/ui/icon-chest.png" alt="" />
      <h2 class="modal-title">${tx('attendTitle')}</h2>
      <div class="att-grid">${cells}</div>
      ${
        st.canClaim
          ? `<button class="btn3d btn-green att-claim" data-act="claim"><img src="/assets/ui/icon-coin.png" alt="" />${tx('attendClaim', amt)}</button>`
          : `<p class="att-done">${tx('attendDone', st.next)}</p><button class="btn3d btn-blue att-claim" data-act="close">${tx('close')}</button>`
      }
    </div>`;
  }
}
