/**
 * 소리. **`sim/` 은 이 모듈을 몰라야 한다.**
 *
 * 렌더러와 같은 규칙이다 — `TickEvents` 를 **읽기만** 한다. 소리가 시뮬레이션에
 * 흘러들면 서버 권위 PVP에서 결과가 갈라진다. 여기서 나는 소리는 판을 한 글자도
 * 안 바꾼다.
 *
 * ── 파일이 없어도 돈다 ────────────────────────────────────────
 *
 * `game/public/assets/{sfx,bgm}/` 가 `.gitignore` 에 있다(그림과 같은 이유). 그래서
 * **없는 파일은 조용히 무시한다** — 콘솔에 경고도 안 낸다. 클론한 사람에게 열 줄짜리
 * 404 경고를 보여 줄 이유가 없다. 그림이 없을 때 원·도형으로 떨어지는 것과 같은 규칙이다.
 *
 * ── 첫 탭 전에는 소리를 못 낸다 ───────────────────────────────
 *
 * 모바일 브라우저는 사용자 제스처 없이 오디오를 못 켠다. `unlock()` 이 첫 입력에서
 * 한 번 돌고, 그 전에 온 `play()` 는 그냥 버린다 — 큐에 쌓아 두면 첫 탭에 소리가
 * 우수수 쏟아진다.
 *
 * ── 배속을 견뎌야 한다 ────────────────────────────────────────
 *
 * 2배속이면 이벤트가 2배로 쏟아진다. `clash` 는 원래도 판당 수백 번이라 그대로 두면
 * 소리가 뭉개진다. 소리마다 **최소 간격**을 두고, 동시에 우는 수를 제한한다.
 */

const SFX_BASE = '/assets/sfx';
const BGM_BASE = '/assets/bgm';

export const SFX = [
  'capture',
  'clash',
  'route-open',
  'route-cut',
  'route-blocked',
  'match-start',
  'victory',
  'defeat',
  'tap',
  'purchase',
] as const;
export type SfxName = (typeof SFX)[number];

export type BgmName = 'lobby' | 'match';

/**
 * 소리마다 두는 최소 간격(ms). **같은 소리가 이보다 촘촘히 오면 버린다.**
 *
 * `clash` 가 짧은 이유는 판당 수백 번 나기 때문이고, 그래도 0은 아니다 — 한 틱에
 * 여러 번 부딪히면 같은 순간에 겹쳐 울려 그냥 잡음이 된다.
 */
const MIN_GAP_MS: Partial<Record<SfxName, number>> = {
  clash: 70,
  capture: 90,
  'route-open': 60,
  'route-cut': 60,
  'route-blocked': 200,
};
const DEFAULT_GAP_MS = 40;

/**
 * 동시에 울 수 있는 수. 넘으면 **가장 오래된 것을 끊는다.**
 *
 * 안 끊으면 배속에서 수십 개가 겹쳐 소리가 진흙이 되고, 모바일에서 오디오 노드가
 * 계속 늘어 프레임이 떨어진다.
 */
const MAX_VOICES = 8;

const STORAGE_KEY = 'towerwar.audio';

interface Settings {
  /** 0~1. 효과음과 배경음에 함께 곱한다. */
  master: number;
  sfx: number;
  bgm: number;
}

const DEFAULTS: Settings = { master: 0.8, sfx: 1, bgm: 0.5 };

function clamp01(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;
}

function load(): Settings {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    if (!raw || typeof raw !== 'object') return { ...DEFAULTS };
    return {
      master: raw.master === undefined ? DEFAULTS.master : clamp01(raw.master),
      sfx: raw.sfx === undefined ? DEFAULTS.sfx : clamp01(raw.sfx),
      bgm: raw.bgm === undefined ? DEFAULTS.bgm : clamp01(raw.bgm),
    };
  } catch {
    return { ...DEFAULTS };
  }
}

class AudioManager {
  private settings = load();
  private unlocked = false;
  /** 이름 → 디코드된 원본. `null` 은 "받아 봤는데 없더라" — 다시 안 받는다. */
  private buffers = new Map<string, AudioBuffer | null>();
  private ctx: AudioContext | null = null;
  private sfxGain: GainNode | null = null;
  private bgmGain: GainNode | null = null;
  private voices: AudioBufferSourceNode[] = [];
  private lastAt = new Map<string, number>();
  private bgmNode: AudioBufferSourceNode | null = null;
  private bgmNow: BgmName | null = null;

  get volumes(): Settings {
    return { ...this.settings };
  }

  /**
   * 첫 사용자 제스처에서 부른다. **여러 번 불러도 안전하다** — 이미 열려 있으면
   * 그냥 돌아온다.
   *
   * `AudioContext` 를 여기서 처음 만든다. 앱 시작에 만들면 브라우저가 정지 상태로
   * 만들어 두고, 그 뒤 `resume()` 을 잊으면 영영 조용하다.
   */
  unlock(): void {
    if (this.unlocked) return;
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return; // 아주 오래된 브라우저. 소리 없이 돈다
    this.ctx = new Ctor();
    this.sfxGain = this.ctx.createGain();
    this.bgmGain = this.ctx.createGain();
    this.sfxGain.connect(this.ctx.destination);
    this.bgmGain.connect(this.ctx.destination);
    this.applyGains();
    this.unlocked = true;
    void this.ctx.resume();
  }

  /** 탭이 백그라운드로 갔다 오면 컨텍스트가 멈춰 있을 수 있다. */
  resume(): void {
    if (this.ctx?.state === 'suspended') void this.ctx.resume();
  }

  setVolumes(next: Partial<Settings>): void {
    this.settings = {
      master: next.master === undefined ? this.settings.master : clamp01(next.master),
      sfx: next.sfx === undefined ? this.settings.sfx : clamp01(next.sfx),
      bgm: next.bgm === undefined ? this.settings.bgm : clamp01(next.bgm),
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings));
    } catch {
      // 프라이빗 모드 등. 이번 세션 동안만 유지된다 — 못 쓰는 것보다 낫다.
    }
    this.applyGains();
  }

  private applyGains(): void {
    if (this.sfxGain) this.sfxGain.gain.value = this.settings.master * this.settings.sfx;
    if (this.bgmGain) this.bgmGain.gain.value = this.settings.master * this.settings.bgm;
  }

  /**
   * 효과음 하나. **없는 파일이면 아무 일도 안 일어난다.**
   *
   * 첫 호출에서 받아 두고 그다음부터는 메모리에서 쓴다. 받는 동안 온 호출은 그냥
   * 버린다 — 기다렸다 내면 이미 지난 사건의 소리가 뒤늦게 난다.
   */
  play(name: SfxName): void {
    if (!this.unlocked || !this.ctx || !this.sfxGain) return;

    const now = performance.now();
    const gap = MIN_GAP_MS[name] ?? DEFAULT_GAP_MS;
    if (now - (this.lastAt.get(name) ?? -Infinity) < gap) return;

    const buf = this.buffers.get(name);
    if (buf === undefined) {
      void this.fetchBuffer(name, `${SFX_BASE}/${name}.mp3`);
      return;
    }
    if (buf === null) return; // 없는 파일

    this.lastAt.set(name, now);

    // 넘치면 가장 오래된 것을 끊는다. 안 끊으면 배속에서 소리가 진흙이 된다.
    while (this.voices.length >= MAX_VOICES) {
      const old = this.voices.shift();
      try {
        old?.stop();
      } catch {
        // 이미 끝난 노드. `stop()` 이 던지는 브라우저가 있다
      }
    }

    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.sfxGain);
    src.onended = () => {
      const i = this.voices.indexOf(src);
      if (i >= 0) this.voices.splice(i, 1);
    };
    this.voices.push(src);
    src.start();
  }

  /**
   * 배경음을 바꾼다. 같은 곡이면 아무 일도 안 한다 — 씬을 오갈 때마다 다시 시작하면
   * 로비↔상점을 오가는 것만으로 음악이 계속 끊긴다.
   *
   * **배속을 안 따라간다.** `playbackRate` 를 올리면 음정이 같이 올라가 딴 곡이 된다.
   */
  setBgm(name: BgmName | null): void {
    if (this.bgmNow === name) return;
    this.bgmNow = name;
    this.stopBgm();
    if (!name || !this.unlocked || !this.ctx || !this.bgmGain) return;

    const buf = this.buffers.get(`bgm:${name}`);
    if (buf === undefined) {
      // 받아 두고, 받아지면 그때도 여전히 이 곡이 필요한지 다시 본다.
      void this.fetchBuffer(`bgm:${name}`, `${BGM_BASE}/${name}.mp3`).then(() => {
        if (this.bgmNow === name) {
          this.bgmNow = null; // 같은 곡으로 다시 들어가게 초기화
          this.setBgm(name);
        }
      });
      return;
    }
    if (buf === null) return;

    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.connect(this.bgmGain);
    src.start();
    this.bgmNode = src;
  }

  private stopBgm(): void {
    if (!this.bgmNode) return;
    try {
      this.bgmNode.stop();
    } catch {
      // 이미 멈춘 노드
    }
    this.bgmNode = null;
  }

  /**
   * 받아서 디코드한다. **없으면 `null` 을 넣어 두고 다시 안 받는다.**
   *
   * 콘솔에 안 찍는 이유: 음원이 없는 것이 지금은 정상 상태다(저장소에 안 올라간다).
   * 매 판마다 404 열 줄을 보여 줄 이유가 없다.
   */
  private async fetchBuffer(key: string, url: string): Promise<void> {
    if (this.buffers.has(key)) return;
    // 먼저 표시해 둔다. 안 하면 같은 파일을 동시에 여러 번 받는다.
    this.buffers.set(key, null);
    try {
      const res = await fetch(url);
      if (!res.ok) return;
      const bytes = await res.arrayBuffer();
      const buf = await this.ctx!.decodeAudioData(bytes);
      this.buffers.set(key, buf);
    } catch {
      // 없거나 못 읽는 형식. `null` 인 채로 둔다 — 다시 안 받는다.
    }
  }
}

export const audio = new AudioManager();

/**
 * 첫 입력에서 오디오를 깨운다. **`main.ts` 가 한 번만 부른다.**
 *
 * `pointerdown` 과 `keydown` 둘 다 건다 — 데스크톱에서 키로만 조작하는 경우가 있고,
 * 모바일은 `click` 보다 `pointerdown` 이 빨라 첫 탭의 소리가 안 밀린다.
 */
export function installAudioUnlock(): void {
  const once = () => {
    audio.unlock();
    audio.resume();
    window.removeEventListener('pointerdown', once);
    window.removeEventListener('keydown', once);
  };
  window.addEventListener('pointerdown', once);
  window.addEventListener('keydown', once);
  // 탭을 돌아왔을 때 멈춰 있으면 되살린다.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) audio.resume();
  });
}
