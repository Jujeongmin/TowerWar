/**
 * 계정 한 벌을 들고, 서버와 localStorage 중 어디에 쓸지 정한다.
 *
 * ── 누가 진짜인가 ──────────────────────────────────────────────
 *
 * **서버에 붙어 있으면 서버가 진짜다.** 재화·강화·소유 유닛의 판정이 전부 거기 있고,
 * localStorage 는 그 사본으로만 남는다. 서버에 못 붙으면 localStorage 가 유일한 저장소다.
 *
 * 이렇게 가른 이유: 배포 전에도, 서버가 죽어도 게임은 끝까지 플레이돼야 한다(§-7).
 * 대신 **오프라인에서 번 코인은 서버에 안 올라간다.** 올리면 콘솔에서 코인을 고쳐 두고
 * 접속하는 것으로 서버 검증이 통째로 무의미해진다 — 그럴 바엔 안 올리는 게 낫다.
 *
 * ── 화면은 이 차이를 몰라야 한다 ───────────────────────────────
 *
 * 씬들은 `current` 를 읽고 콜백으로 사기만 한다. 온라인/오프라인 분기는 이 파일에만 있다.
 */
import type { Agent8Client, BoardEntry } from '../net/agent8';
import { entitlementsFromAssets } from '../net/vx';
import type { ProfileId } from '../profiles';
import type { UnitKind } from '../units';
import {
  applyReward,
  buyUnitKind,
  buyUpgrade,
  cleanName,
  fromRemote,
  loadAccount,
  saveAccount,
  selectUnitKind,
  type Account,
  type Reward,
  type UpgradeKind,
} from './account';

/** 한 판으로 점수가 어떻게 움직였는가. 결과 화면이 그대로 보여준다. */
export interface RatingChange {
  before: number;
  after: number;
}

export class AccountStore {
  private account: Account = loadAccount();
  private net: Agent8Client | null = null;

  /** 서버 계정을 쓰고 있는가. UI가 아니라 로그·디버그용이다. */
  get online(): boolean {
    return this.net !== null;
  }

  get current(): Account {
    return this.account;
  }

  /**
   * 서버 계정을 끌어온다. 실패하면 로컬 그대로 두고 오프라인으로 간다 —
   * 화면에는 안 드러낸다 (§-7과 같은 규칙).
   */
  async connect(net: Agent8Client): Promise<boolean> {
    try {
      if (!(await net.connect())) throw new Error('연결이 거부되었습니다');
      const local = this.account;
      let remote = fromRemote(await net.getAccount());

      // ── 이름만은 로컬 것을 올려 준다 ────────────────────────────
      //
      // `connect` 는 계정을 서버 값으로 통째로 갈아 끼운다(§-10). 그런데 접속은
      // 비동기이고 닉네임 화면은 **접속 전에** 뜬다 — 8초 타임아웃 안에 이름을 넣으면
      // `setName` 이 `this.net === null` 이라 로컬에만 저장하고, 여기서 그게 날아갔다.
      // 증상은 "매치 상단에 내 닉네임과 아이콘이 안 뜬다"로 나온다 (이름이 비면
      // `drawHud` 가 이름 줄을 통째로 안 그리고 아바타가 그 안에 있다).
      //
      // **재화가 아니라 이름이라서 올려도 된다.** 코인·강화·소유 유닛을 올리면 콘솔에서
      // 고쳐 두고 접속하는 것으로 서버 검증이 무의미해지지만(위 주석), 이름은 경제와
      // 무관하고 서버가 `cleanName` 으로 다시 정리한다. 자칭할 수 있는 것이 없다.
      if (!remote.name && local.name) {
        try {
          await net.setName(local.name);
          remote = fromRemote(await net.setProfile(local.profile));
        } catch (e) {
          // 올리기가 실패해도 접속은 살린다. 이름이 빈 채로 남으면 `main.ts` 가
          // 닉네임 화면으로 되돌린다 — 조용히 이름 없는 상태로 두지는 않는다.
          console.warn('[account] 로컬 닉네임을 서버에 못 올렸습니다:', String((e as Error)?.message ?? e));
        }
      }

      this.account = remote;
      this.net = net;
      // 서버 값을 사본으로 남긴다. 다음 실행에서 접속 전에 보여줄 값이 있어야 한다.
      saveAccount(this.account);
      return true;
    } catch (e) {
      console.warn('[account] 서버 계정을 못 읽어 로컬로 진행합니다:', String((e as Error)?.message ?? e));
      this.net = null;
      return false;
    }
  }

  /**
   * 닉네임 저장. 실패하면 던진다 — 화면이 이유를 보여줘야 한다.
   * 여기만 예외적으로 조용히 삼키지 않는 이유: 이름이 없으면 다음 화면으로 못 간다.
   */
  async setName(name: string, profile: ProfileId): Promise<void> {
    const clean = cleanName(name);
    if (clean.length === 0) throw new Error('이름을 입력하세요');
    if (this.net) {
      // 두 번 부른다. 서버가 계정 전체를 돌려주므로 두 번째 응답에 이름도 들어 있다.
      await this.net.setName(clean);
      this.setLocal(fromRemote(await this.net.setProfile(profile)));
      return;
    }
    this.setLocal({ ...this.account, name: clean, profile });
  }

  /**
   * 상위 10명. **오프라인이면 `null` 이다** — 빈 배열로 내리면 화면이 "아직 아무도 안
   * 올랐다"로 읽어 버린다. 서버가 없는 것과 표가 비어 있는 것은 다른 사정이다.
   */
  async leaderboard(): Promise<BoardEntry[] | null> {
    if (!this.net) return null;
    try {
      return await this.net.getLeaderboard();
    } catch {
      // 접속은 됐는데 이 호출만 실패한 경우. 오프라인과 같이 다룬다 —
      // 화면이 할 수 있는 일이 "지금은 못 본다"로 같다.
      return null;
    }
  }

  // ── 유료(VX) ───────────────────────────────────────────────────

  /**
   * 결제 창 주소. 오프라인이거나 이 빌드에 결제가 없으면 `null`.
   * **여는 것은 화면이 한다** — 사용자 제스처 안에서 열어야 팝업 차단에 안 걸린다.
   */
  async shopUrl(): Promise<string | null> {
    if (!this.net) return null;
    try {
      return await this.net.shopUrl();
    } catch (e) {
      console.warn('[vx] 결제 창 주소를 못 받았습니다:', String((e as Error)?.message ?? e));
      return null;
    }
  }

  /**
   * 보유 자산을 계속 지켜보다가, 아직 안 열린 유료 항목이 보이면 서버에 반영한다.
   *
   * **구독인 이유**: 결제가 다른 탭에서 끝나므로 언제 끝나는지 우리가 모른다.
   * 돌아왔을 때 이미 열려 있어야 한다.
   *
   * 자산 id 표(`ASSET_IDS`)가 비어 있으면 아무 일도 안 한다 — 배포 전에는 그 상태다.
   */
  watchAssets(onChange: () => void): () => void {
    if (!this.net) return () => {};
    return this.net.onAssets((assets) => {
      const want = entitlementsFromAssets(assets);
      const missing = want.filter((k) => !this.account.entitlements.includes(k));
      if (missing.length === 0) return;
      void (async () => {
        for (const item of missing) {
          try {
            this.setLocal(fromRemote(await this.net!.grantEntitlement(item)));
          } catch (e) {
            console.warn('[vx] 유료 항목 반영 실패:', String((e as Error)?.message ?? e));
          }
        }
        onChange();
      })();
    });
  }

  /** 강화 구매. 못 사면 조용히 아무 일도 안 일어난다 — 버튼이 이미 비활성이다. */
  async buyUpgrade(kind: UpgradeKind): Promise<void> {
    await this.mutate(
      () => this.net!.buyUpgrade(kind),
      () => buyUpgrade(this.account, kind),
    );
  }

  /** 안 가진 생김새면 사고, 가진 것이면 착용한다. */
  async pickUnit(kind: UnitKind): Promise<void> {
    if (this.net) {
      const owned = this.account.ownedUnits.includes(kind) || kind === this.account.unitKind;
      await this.mutate(
        () => (owned ? this.net!.selectUnitKind(kind) : this.net!.buyUnitKind(kind)),
        () => null,
      );
      return;
    }
    this.setLocal(buyUnitKind(this.account, kind) ?? selectUnitKind(this.account, kind));
  }

  /**
   * 판 결과. 서버 방이면 서버가 보상을 계산해 넣고, 오프라인 봇전이면 로컬에 넣는다.
   *
   * 점수 변동을 돌려준다 — 결과 화면이 "1000 → 1004" 를 띄우는 데 쓴다.
   * **점수가 안 움직였으면 `null`** 이다: 오프라인 판이거나, 이미 보상을 받은 판이거나,
   * 보고가 실패한 경우. 그때 `0` 을 돌려주면 화면이 "±0" 을 띄워 버린다 —
   * 안 움직인 것과 못 잰 것은 다르다.
   *
   * @param serverRoom 이 판이 서버가 연 방이었는가. 아니면 보고할 곳이 없다.
   */
  async grantReward(
    reward: Reward,
    winnerSlot: number,
    serverRoom: boolean,
  ): Promise<RatingChange | null> {
    if (this.net && serverRoom) {
      const before = this.account.rating;
      try {
        const next = await this.net.reportResult(winnerSlot, reward.towers);
        // null 이면 이미 받은 판이다. 그때는 계정을 안 건드린다.
        if (!next) return null;
        this.setLocal(fromRemote(next));
        return { before, after: this.account.rating };
      } catch (e) {
        console.warn('[account] 결과 보고 실패:', String((e as Error)?.message ?? e));
        return null; // 로컬로 대신 주지 않는다. 서버가 나중에 줄 수도 있어 두 번 받게 된다
      }
    }
    // 오프라인. 코인은 로컬로 주지만 점수는 안 건드린다 (`Account.rating` 주석).
    this.setLocal(applyReward(this.account, reward));
    return null;
  }

  /** 온라인이면 서버 호출, 아니면 로컬 계산. 결과는 항상 사본에 남긴다. */
  private async mutate(
    remote: () => Promise<Parameters<typeof fromRemote>[0]>,
    local: () => Account | null,
  ): Promise<void> {
    if (this.net) {
      try {
        this.setLocal(fromRemote(await remote()));
      } catch (e) {
        // 서버가 거절했다 (코인 부족·만렙 등). 로컬로 우회하지 않는다.
        console.warn('[account] 서버가 거절했습니다:', String((e as Error)?.message ?? e));
      }
      return;
    }
    const next = local();
    if (next) this.setLocal(next);
  }

  private setLocal(next: Account): void {
    this.account = next;
    saveAccount(next);
  }
}
