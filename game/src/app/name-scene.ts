/**
 * 닉네임과 아바타 설정. 첫 실행에서 로비보다 먼저 뜬다.
 *
 * **이름이 없으면 여기서 못 나간다.** 상대에게 빈칸으로 보이면 누구와 붙었는지
 * 알 수가 없다 — 그래서 [시작]은 이름이 정리 후에도 남아 있을 때만 통과한다.
 * 아바타는 안 골라도 된다 — 기본값이 있고, 순수 외형이라 게임을 막을 이유가 없다.
 *
 * 이름 정리 규칙(`cleanName`)은 **서버와 같다.** 화면에 보이는 것과 저장되는 것이
 * 다르면 왜 이름이 바뀌었는지 알 수가 없다.
 */
import { NAME_MAX, cleanName } from '../account/account';
import {
  DEFAULT_PROFILE,
  PROFILE_IDS,
  profileLabel,
  profileBg,
  profileSrc,
  type ProfileId,
} from '../profiles';
import { t } from '../i18n';
import type { Scene } from './scene';

export class NameScene implements Scene {
  private readonly input: HTMLInputElement;
  private readonly error: HTMLElement;
  private readonly cards: { id: ProfileId; el: HTMLButtonElement }[];
  private picked: ProfileId = DEFAULT_PROFILE;
  private busy = false;

  constructor(
    private readonly root: HTMLElement,
    /** 이름과 아바타를 저장한다. 실패하면 메시지를 던진다. */
    private readonly submit: (name: string, profile: ProfileId) => Promise<void>,
    private readonly done: () => void,
  ) {
    const input = root.querySelector<HTMLInputElement>('#name-input');
    const error = root.querySelector<HTMLElement>('#name-error');
    const grid = root.querySelector<HTMLElement>('#avatar-grid');
    const ok = root.querySelector<HTMLButtonElement>('#btn-name-ok');
    if (!input || !error || !grid || !ok) throw new Error('닉네임 화면 DOM이 예상과 다릅니다');
    this.input = input;
    this.error = error;

    this.cards = PROFILE_IDS.map((id) => {
      const el = document.createElement('button');
      el.className = 'avatar-card';
      el.id = `avatar-${id}`;
      el.title = profileLabel(id);
      // 그림은 9장 다 같은 파일이다 — 캐릭터는 고정이고 뒤에 깔리는 원 색만 다르다.
      // 그래서 브라우저가 한 번만 받는다.
      el.innerHTML = `<img alt="${profileLabel(id)}" src="${profileSrc(id)}" />`;
      el.style.setProperty('--avatar-bg', profileBg(id));
      el.addEventListener('click', () => {
        this.picked = id;
        this.paint();
      });
      grid.appendChild(el);
      return { id, el };
    });

    ok.addEventListener('click', () => void this.commit());
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') void this.commit();
    });
    // 입력하는 동안 오류 문구를 지운다. 남아 있으면 고쳐도 안 된 것처럼 보인다.
    input.addEventListener('input', () => {
      this.error.textContent = '';
    });
  }

  enter(): void {
    this.error.textContent = '';
    this.paint();
    this.root.hidden = false;
    // 모바일에서 자동 포커스가 키보드를 띄워 화면을 덮는 경우가 있어 강제하지 않는다.
    if (!/Android|iPhone|iPad/i.test(navigator.userAgent)) this.input.focus();
  }

  exit(): void {
    this.root.hidden = true;
  }

  frame(): void {
    // DOM이 알아서 그려진다.
  }

  private paint(): void {
    for (const { id, el } of this.cards) el.classList.toggle('is-picked', id === this.picked);
  }

  private async commit(): Promise<void> {
    if (this.busy) return;
    const name = cleanName(this.input.value);
    if (name.length === 0) {
      this.error.textContent = t().nameRequired(NAME_MAX);
      return;
    }
    // 정리 결과를 입력칸에 되돌려 보여준다. 저장될 값이 무엇인지 먼저 보여야 한다.
    this.input.value = name;

    this.busy = true;
    try {
      await this.submit(name, this.picked);
      this.done();
    } catch (e) {
      this.error.textContent = String((e as Error)?.message ?? e);
    } finally {
      this.busy = false;
    }
  }
}
