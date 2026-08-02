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
};

export class SettingsScene implements Scene {
  private readonly buttons: { lang: Lang; el: HTMLButtonElement }[];
  private readonly volLabels: { key: string; el: HTMLElement }[] = [];

  constructor(
    private readonly root: HTMLElement,
    /** 언어가 바뀌었다. 지금 보이는 화면을 다시 그리게 앱에 알린다. */
    private readonly onLangChange: () => void,
    back: () => void,
  ) {
    const row = root.querySelector<HTMLElement>('#lang-row');
    const vols = root.querySelector<HTMLElement>('#vol-rows');
    const backBtn = root.querySelector<HTMLButtonElement>('#btn-settings-back');
    if (!row || !vols || !backBtn) throw new Error('설정 화면 DOM이 예상과 다릅니다');

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
    this.paint();
    this.root.hidden = false;
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
  }

  exit(): void {
    this.root.hidden = true;
  }

  frame(): void {
    // DOM이 알아서 그려진다.
  }
}
