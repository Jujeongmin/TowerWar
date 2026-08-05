/**
 * 설정. 지금은 언어 하나뿐이다.
 *
 * **매치 중에는 못 연다.** 판 위에 뜨는 설정 창은 봇전에서만 판을 멈춰서 "상대가
 * 봇이다"를 알려 줬다 (§-38에서 그래서 통째로 걷어냈다). 여기는 로비 전용이다.
 *
 * 언어를 바꾸면 **정적 문자열을 다시 칠하고 화면을 다시 그린다.** 새로고침을 시키지
 * 않는 이유: 매칭 중이거나 상점에서 뭘 보고 있었을 수 있고, 그게 날아가면 언어 하나
 * 바꾸는 값으로는 너무 비싸다.
 */
import { audio } from '../audio';
import { LANGS, applyStaticText, getLang, setLang, t, type Lang } from '../i18n';
import type { Scene } from './scene';

/** 음량 슬라이더 세 줄. 라벨 키와 어느 값을 만지는지만 다르다. */
const VOL_ROWS = [
  { key: 'volMaster', field: 'master' },
  { key: 'volSfx', field: 'sfx' },
  { key: 'volBgm', field: 'bgm' },
] as const;

/** 각 언어를 **그 언어로** 적는다. 한국어 화면에서 'Korean' 은 아무 도움이 안 된다. */
const ENDONYM: Record<Lang, string> = {
  en: 'English',
  ko: '한국어',
  zh: '中文',
};

export class SettingsScene implements Scene {
  private readonly buttons: { lang: Lang; el: HTMLButtonElement }[];
  private readonly volLabels: { key: string; el: HTMLElement }[] = [];
  private readonly resetBtn: HTMLButtonElement;
  private readonly resetNote: HTMLElement;
  /** 초기화 버튼이 지금 "한 번 더 누르면" 확인 상태인가. */
  private confirming = false;
  /** 확인 상태를 자동으로 되돌리는 타이머. */
  private confirmTimer: ReturnType<typeof setTimeout> | null = null;
  /** 초기화 직후 완료 문구를 보여주는 중인가 — 그때는 전적 안내를 덮는다. */
  private justReset = false;

  constructor(
    private readonly root: HTMLElement,
    /** 언어가 바뀌었다. 지금 보이는 화면을 다시 그리게 앱에 알린다. */
    private readonly onLangChange: () => void,
    back: () => void,
    /** 전적(승/패)만 초기화한다. 점수는 유지. */
    private readonly onResetRecord: () => Promise<void>,
    /** 지금 전적. 버튼 밑에 "현재 N승 M패"로 보여준다. */
    private readonly getRecord: () => { wins: number; losses: number },
  ) {
    const row = root.querySelector<HTMLElement>('#lang-row');
    const vols = root.querySelector<HTMLElement>('#vol-rows');
    const backBtn = root.querySelector<HTMLButtonElement>('#btn-settings-back');
    const resetBtn = root.querySelector<HTMLButtonElement>('#btn-reset-record');
    const resetNote = root.querySelector<HTMLElement>('#reset-record-note');
    if (!row || !vols || !backBtn || !resetBtn || !resetNote) {
      throw new Error('설정 화면 DOM이 예상과 다릅니다');
    }
    this.resetBtn = resetBtn;
    this.resetNote = resetNote;
    resetBtn.addEventListener('click', () => void this.onResetClick());

    for (const { key, field } of VOL_ROWS) {
      const line = document.createElement('label');
      line.className = 'vol-row';
      const label = document.createElement('span');
      label.className = 'vol-label';
      const slider = document.createElement('input');
      slider.type = 'range';
      slider.min = '0';
      slider.max = '100';
      slider.className = 'vol-slider';
      slider.value = String(Math.round(audio.volumes[field] * 100));
      // `input` 이다 (`change` 가 아니다). 끌면서 바로 들려야 어느 크기인지 안다.
      slider.addEventListener('input', () => {
        audio.unlock(); // 설정에서 처음 만질 수도 있다
        audio.setVolumes({ [field]: Number(slider.value) / 100 });
        // 만진 축의 소리를 낸다 — 숫자만 바뀌면 얼마나 큰지 알 수가 없다.
        if (field !== 'bgm') audio.play('tap');
      });
      line.append(label, slider);
      vols.appendChild(line);
      this.volLabels.push({ key, el: label });
    }
    backBtn.addEventListener('click', back);

    this.buttons = LANGS.map((lang) => {
      const el = document.createElement('button');
      el.className = 'btn lang-btn';
      el.textContent = ENDONYM[lang];
      el.addEventListener('click', () => {
        if (getLang() === lang) return;
        setLang(lang);
        // 순서가 중요하다: 정적 문자열을 먼저 칠하고, 그 다음 씬들이 값을 다시 읽는다.
        applyStaticText();
        this.paint();
        this.onLangChange();
      });
      row.appendChild(el);
      return { lang, el };
    });
  }

  enter(): void {
    // 화면을 다시 열면 확인·완료 상태는 초기로 되돌린다.
    this.clearConfirm();
    this.justReset = false;
    this.paint();
    this.root.hidden = false;
  }

  /**
   * 초기화 버튼. **두 번 눌러야 실행된다** — 실수로 한 번 눌러 전적이 날아가지
   * 않게. 첫 클릭은 확인 상태로 바꾸고, 4초 안에 다시 누르면 초기화한다.
   */
  private async onResetClick(): Promise<void> {
    if (!this.confirming) {
      this.confirming = true;
      this.justReset = false;
      // 4초 안에 다시 안 누르면 확인 상태를 스스로 되돌린다 — 눌러 둔 것을 잊고
      // 나중에 실수로 확정하는 것을 막는다.
      this.confirmTimer = setTimeout(() => {
        this.confirming = false;
        this.confirmTimer = null;
        this.paint();
      }, 4000);
      this.paint();
      return;
    }
    this.clearConfirm();
    await this.onResetRecord();
    this.justReset = true;
    this.paint();
  }

  private clearConfirm(): void {
    this.confirming = false;
    if (this.confirmTimer !== null) {
      clearTimeout(this.confirmTimer);
      this.confirmTimer = null;
    }
  }

  /** 지금 언어를 눌린 상태로. 고른 것이 어느 쪽인지 안 보이면 고를 이유가 없다. */
  private paint(): void {
    const now = getLang();
    for (const { lang, el } of this.buttons) {
      el.classList.toggle('is-picked', lang === now);
      // 이미 쓰고 있는 언어는 누를 이유가 없다.
      el.disabled = lang === now;
      el.title = t().language;
    }
    // 음량 라벨도 언어를 따라야 한다. 코드가 만든 요소라 `data-i18n` 이 안 붙는다.
    const s = t() as unknown as Record<string, string>;
    for (const { key, el } of this.volLabels) el.textContent = s[key] ?? key;

    // 전적 초기화 버튼·안내. 확인 상태면 문구가 바뀌고, 방금 지웠으면 완료 문구.
    this.resetBtn.textContent = this.confirming ? t().resetRecordConfirm : t().resetRecord;
    this.resetBtn.classList.toggle('is-confirming', this.confirming);
    if (this.justReset) {
      this.resetNote.textContent = t().resetRecordDone;
    } else {
      const { wins, losses } = this.getRecord();
      this.resetNote.textContent = t().resetRecordNote(wins, losses);
    }
  }

  exit(): void {
    this.clearConfirm();
    this.root.hidden = true;
  }

  frame(): void {
    // DOM이 알아서 그려진다.
  }
}
