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
import { ENDONYM, LANGS, applyStaticText, getLang, setLang, t, type Lang } from '../i18n';
import type { Scene } from './scene';

/** 음량 슬라이더 세 줄. 라벨 키와 어느 값을 만지는지만 다르다. */
const VOL_ROWS = [
  { key: 'volMaster', field: 'master' },
  { key: 'volSfx', field: 'sfx' },
  { key: 'volBgm', field: 'bgm' },
] as const;

/**
 * 팔로우 칸이 지금 무엇을 보여줄지. 서버에 물어봐야 정해진다.
 *
 * **게임에서 제작자 페이지를 열어 주지는 않는다** (2026-08-08 사용자 지시). 앱으로
 * 감싼 WebView 에서 `window.open` 이 조용히 무시돼(새 창을 만들 대리자가 없다) 눌러도
 * 아무 일이 없었고, 부모 프레임에 다이얼로그를 부탁하는 길은 배포 URL 을 직접 여는
 * 앱에는 부모가 없어서 못 쓴다. 그래서 팔로우는 플랫폼에서 하고 오는 것으로 두고,
 * 여기 버튼은 보상 청구만 한다.
 */
type FollowState = 'following' | 'not_following' | 'rewarded' | 'unknown';

/**
 * 팔로우 보상 실패 코드 → 화면 문구.
 *
 * **`includes` 로 본다.** 서버가 던진 `not_following` 이 remote function 을 거치면서
 * 감싸져 오기 때문에 `===` 로 비교하면 절대 안 맞는다 — 실제로 그 버그를 냈다
 * (2026-08-07: 실패해도 안내가 안 바뀌어 눌러도 아무 일이 없어 보였다).
 * 상점의 `adMessage` 가 같은 이유로 같은 규칙을 쓴다.
 */
function followMessage(err: string): string {
  if (err === 'ok') return '';
  if (err.includes('not_following')) return t().followNotYet;
  if (err.includes('already_claimed')) return t().followClaimed;
  if (err === 'offline') return t().adUnavailable;
  // 남은 것은 통신 오류다. **여기서도 문구를 바꾼다** — 안 바꾸면 눌러도 아무 일이
  // 안 일어난 것으로 보인다.
  return t().followFailed;
}

export class SettingsScene implements Scene {
  private readonly buttons: { lang: Lang; el: HTMLButtonElement }[];
  private readonly volLabels: { key: string; el: HTMLElement }[] = [];
  private readonly resetBtn: HTMLButtonElement;
  private readonly resetNote: HTMLElement;
  private readonly followBtn: HTMLButtonElement;
  private readonly followNote: HTMLElement;
  /** 팔로우 보상 청구가 진행 중. 그동안 버튼을 잠가 두 번 안 나가게 한다. */
  private claiming = false;
  /** 방금 청구한 결과. `null` 이면 아직 안 눌렀다는 뜻이고, 안내 문구를 바꾼다. */
  private claimResult: 'ok' | string | null = null;
  /**
   * 서버가 말한 팔로우 상태. `null` 이면 아직 안 물어봤다. `'rewarded'` 면 버튼이
   * '받음'으로 잠긴다.
   */
  private followState: FollowState | null = null;
  /**
   * 팔로우 칸을 아예 안 보여주는가.
   *
   * **터치 기기에서는 통째로 감춘다** (2026-08-08 사용자 지시). 팔로우는 Verse8
   * 플랫폼에서 해야 하는데 게임이 그 페이지를 열어 줄 수 없어(앱 WebView 에서
   * `window.open` 이 무시된다) 폰에서는 누를 수 있는 것이 사실상 없다.
   *
   * 판정을 여기 한 곳에서만 한다 — CSS 로도 감추면 화면과 서버 조회가 따로 놀아
   * 안 보이는 칸 때문에 서버를 계속 부르게 된다.
   */
  private readonly followHidden = window.matchMedia('(pointer: coarse)').matches;
  /** 상태 조회가 도는 중. **화면을 안 건드린다** — 뒤에서 조용히 다녀오는 것이다. */
  private checkingFollow = false;
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
    /** 제작자 팔로우 보상 청구. `null` 이면 성공, 아니면 서버가 준 실패 코드. */
    private readonly onClaimFollow: () => Promise<string | null>,
    /** 이미 받았는가. 받았으면 버튼이 잠긴다. */
    private readonly hasFollowReward: () => boolean,
    /** 팔로우 상태를 서버에 묻는다. 실패는 `'unknown'` 으로 온다. */
    private readonly onFetchFollowState: () => Promise<FollowState>,
  ) {
    const row = root.querySelector<HTMLElement>('#lang-row');
    const vols = root.querySelector<HTMLElement>('#vol-rows');
    const backBtn = root.querySelector<HTMLButtonElement>('#btn-settings-back');
    const resetBtn = root.querySelector<HTMLButtonElement>('#btn-reset-record');
    const resetNote = root.querySelector<HTMLElement>('#reset-record-note');
    const followBtn = root.querySelector<HTMLButtonElement>('#btn-follow-claim');
    const followNote = root.querySelector<HTMLElement>('#follow-note');
    const followSection = root.querySelector<HTMLElement>('#follow-section');
    if (
      !row ||
      !vols ||
      !backBtn ||
      !resetBtn ||
      !resetNote ||
      !followBtn ||
      !followNote ||
      !followSection
    ) {
      throw new Error('설정 화면 DOM이 예상과 다릅니다');
    }
    // 제목까지 함께 감춘다 — 버튼만 빼면 제목이 빈 칸으로 남는다.
    followSection.hidden = this.followHidden;
    this.resetBtn = resetBtn;
    this.resetNote = resetNote;
    resetBtn.addEventListener('click', () => void this.onResetClick());
    this.followBtn = followBtn;
    this.followNote = followNote;
    followBtn.addEventListener('click', () => void this.onFollowClick());
    // **플랫폼에서 팔로우하고 돌아오면 저절로 반영돼야 한다.** 팔로우는 이 게임
    // 밖에서 하므로 돌아왔을 때 이 화면은 살아 있는 채로 가려졌다 다시 보일 뿐이다
    // — `enter()` 가 다시 안 불린다. 이 씬은 앱이 사는 동안 계속 있으므로 리스너를
    // 떼지 않는다. 대신 설정이 실제로 떠 있을 때만 일하도록 `refreshFollowState`
    // 안에서 걸러 낸다.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void this.refreshFollowState();
    });

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
    // 지난번에 실패한 문구를 들고 다시 뜨면 안 된다. 그 사이에 팔로우하고 왔을 수도 있다.
    this.claimResult = null;
    this.paint();
    this.root.hidden = false;
    // 화면을 먼저 띄우고 나서 묻는다. 응답을 기다렸다가 그리면 서버가 느릴 때
    // 설정이 통째로 늦게 뜬다 — 언어·음량은 팔로우와 아무 상관이 없다.
    void this.refreshFollowState();
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

    this.paintFollow();
  }

  /**
   * 팔로우 보상 칸.
   *
   * **서버가 준 실패 코드를 그대로 화면에 쓰지 않는다** — `not_following` 은 사람이
   * 읽을 글이 아니다 (§-40).
   *
   * **평소에는 버튼만 둔다** (2026-08-08 사용자 지시 — "밑에 설명 없애줘"). 밑줄은
   * 무슨 일이 벌어지는 중일 때만 쓴다: 청구가 도는 중이거나, 방금 실패했거나.
   * 요소 자체를 지우지는 않았다 — 지우면 청구 실패가 아무 반응 없는 것이 된다.
   */
  private paintFollow(): void {
    const claimed = this.hasFollowReward() || this.followState === 'rewarded';

    this.followBtn.textContent = claimed ? t().followClaimed : t().followGo;
    this.followBtn.disabled = claimed || this.claiming;

    // **누르는 즉시 문구가 바뀌어야 한다.** 서버 호출이 최대 8초(`CALL_TIMEOUT_MS`)를
    // 기다리는데 그동안 화면이 그대로면 누른 것 자체가 안 먹은 것처럼 보인다 —
    // 사용자는 그 사이 또 누르고(`claiming` 이라 무시된다), 한참 뒤에 뜬 실패 문구를
    // "두 번째로 눌러서 나온 것"으로 읽는다 (2026-08-07 사용자 신고 — 실제로 그랬다).
    // 버튼이 잠기는 것만으로는 부족하다. 눌린 버튼은 원래도 눌려 보인다.
    if (this.claiming) {
      this.followNote.textContent = t().followClaiming;
      return;
    }
    // 방금 청구해서 실패했으면 그 이유를 남긴다. 성공했으면 버튼이 '받음'으로
    // 잠기는 것으로 충분하다.
    this.followNote.textContent =
      !claimed && this.claimResult !== null ? followMessage(this.claimResult) : '';
  }

  /**
   * 팔로우 상태를 서버에 묻는다. **화면을 안 건드리고 다녀온다** — 설정을 열 때마다
   * "확인 중"이 번쩍이면 언어·음량 보러 온 사람에게는 잡음일 뿐이다. 답이 오면
   * 그때 버튼 모양만 조용히 바뀐다.
   */
  private async refreshFollowState(): Promise<void> {
    // 칸 자체를 안 보여주는 기기다. 물어봐야 쓸 데가 없다.
    if (this.followHidden) return;
    // 안 떠 있으면 물을 이유가 없다. 리스너를 안 떼는 대신 여기서 거른다.
    if (this.root.hidden) return;
    // 이미 받았으면 더 볼 것이 없다. 팔로우를 끊었든 말든 '받음'으로 잠긴다.
    if (this.hasFollowReward()) return;
    // 청구가 도는 중이면 비켜 준다. 그쪽이 끝나면서 어차피 다시 그린다.
    if (this.checkingFollow || this.claiming) return;

    this.checkingFollow = true;
    const state = await this.onFetchFollowState();
    this.checkingFollow = false;
    // 기다리는 사이에 사용자가 눌렀을 수 있다. 그러면 그쪽 결과가 더 새것이다.
    if (this.claiming) return;
    this.followState = state;
    // 팔로우하고 돌아왔다면 아까의 `not_following` 문구는 낡았다. 지워야 버튼이
    // '받기'로 바뀐 것과 안내가 어긋나지 않는다.
    if (state === 'following' && this.claimResult !== null) this.claimResult = null;
    this.paintFollow();
  }

  /**
   * **누르면 곧장 청구한다.** 팔로우 여부는 서버가 `$sender.isFollower` 로 직접 읽으므로
   * 아직 안 했으면 거절이 돌아오고, 그 이유가 밑줄에 뜬다 (`followNotYet` — "게임
   * 페이지에서 팔로우한 뒤 눌러 주세요"). 게임이 팔로우 페이지를 열어 주지는 않는다
   * (2026-08-08 사용자 지시 — 앱 WebView 에서 새 창이 안 열려 무반응이었다).
   */
  private async onFollowClick(): Promise<void> {
    if (this.claiming || this.hasFollowReward()) return;

    this.claiming = true;
    this.paintFollow();
    const err = await this.onClaimFollow();
    this.claiming = false;
    if (err !== null && err.includes('not_following')) this.followState = 'not_following';
    this.claimResult = err ?? 'ok';
    if (err === null) audio.play('purchase');
    this.paintFollow();
  }

  exit(): void {
    this.clearConfirm();
    this.root.hidden = true;
  }

  frame(): void {
    // DOM이 알아서 그려진다.
  }
}
