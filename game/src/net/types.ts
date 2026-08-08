/**
 * 네트워크 계층의 경계 타입.
 *
 * `sim/` 은 이 폴더를 몰라야 한다. 반대 방향(net → sim)만 허용된다 —
 * 시뮬레이션이 네트워크를 알면 서버에서 같은 코드를 돌릴 수 없다.
 *
 * 트랜스포트를 인터페이스로 끊어 둔 이유: 실제 Verse8 연결 없이도 두 클라이언트를
 * 한 프로세스에 붙여 락스텝을 검증할 수 있어야 한다 (`loopback.ts`).
 */
import type { ProfileId } from '../profiles';
import type { Command, Owner, PlayerId } from '../sim/types';
import type { TowerKind } from '../towers';
import type { UnitKind } from '../units';

/**
 * 한 번에 보내는 명령 묶음.
 *
 * `execTick` 이 이 계층의 핵심이다. 명령을 "지금" 적용하지 않고 **정해진 틱에** 적용한다.
 * 벽시계가 아니라 틱 번호로 맞추기 때문에 양쪽의 시작 시각이 어긋나도 결과가 안 갈라진다.
 *
 * **명령이 비어도 보내야 한다.** 빈 배치가 "이 틱까지 내 명령은 없다"는 약속이고,
 * 그게 없으면 상대는 그 지점에서 영원히 기다린다.
 */
export interface InputBatch {
  player: PlayerId;
  /** 이 배치의 명령들이 실행될 틱. 동시에 "이 틱까지 안전하다"는 약속이기도 하다. */
  execTick: number;
  commands: Command[];
  /** 주기적 상태 해시. 서버가 양쪽 값을 비교해 데싱크를 잡는다. */
  hash?: { tick: number; value: string };
}

/**
 * 배치를 상대에게 나르는 통로. 순서는 보장하지 않아도 된다 —
 * 락스텝이 `execTick` 으로 다시 정렬한다.
 */
export interface MatchTransport {
  send(batch: InputBatch): void;
  /** 상대(그리고 서버가 되돌려 준 내 것)의 배치를 받는다. 해제 함수를 돌려준다. */
  onBatch(handler: (batch: InputBatch) => void): () => void;
  /**
   * 서버가 방을 닫았다. `winnerSlot` 은 서버가 정한 승자(무승부·미정이면 0).
   *
   * **이게 상대가 완전히 끊겼을 때의 유일한 탈출구다.** 배치가 영영 안 오면 락스텝이
   * 멈추고, 항복조차 안 먹는다 — 항복은 명령이라 `execTick` 까지 시뮬레이션이 굴러야
   * 적용되는데 그 틱이 안 온다. 서버는 `PEER_TIMEOUT_MS` 뒤에 남은 쪽 승리로 방을
   * 닫으므로, 그 판정을 받아 판을 끝낸다.
   *
   * 선택 사항이다 — 루프백 등 서버가 없는 트랜스포트에는 닫아 줄 방이 없다.
   */
  onClosed?(handler: (winner: Owner) => void): () => void;
  /**
   * 통로가 죽은 것 같으면 다시 세워 달라. **여러 번 불릴 수 있다** — 부르는 쪽은
   * 정지가 이어지는 동안 주기적으로 부르고, 붙을 때까지 실패해도 된다.
   *
   * 선택 사항이다 — 루프백처럼 끊길 것이 없는 트랜스포트에는 할 일이 없다.
   */
  recover?(): void;
  // 결과 보고는 여기 없다. 보상이 서버 계정을 바꾸므로 계정을 든 쪽(main.ts)이
  // 한 번만 보고해야 한다 — 트랜스포트에도 두면 두 경로가 생긴다.
  close?(): void;
}

/** 서버가 정해서 내려주는 판의 조건. 클라이언트가 정하는 것은 하나도 없다. */
export interface MatchSetup {
  seed: number;
  /** 내가 P1인가 P2인가. */
  local: PlayerId;
  /**
   * 플레이어별 유닛 종류. **서버가 정한다** — 2026-07-31부터 종류가 유닛의
   * 힘(`units.ts` 의 `power`)을 정하므로 순수 외형이 아니다. 각자 자기 계정에서 읽으면
   * 두 쪽이 다른 `PlayerMods` 로 돌아 첫 틱부터 갈라진다.
   *
   * 서버는 **이름만** 내려준다. 이름 → 힘 변환은 클라이언트에만 있다 (`unitPowerOf`).
   *
   * (공속 강화 단계 `levels` 가 같은 자리에 있었는데, 2026-08-06에 강화를 없애면서
   * 뺐다. 생산속도를 타워 외형이 이어받으면 그 종류 이름이 여기 나란히 들어온다.)
   */
  kinds: Record<PlayerId, UnitKind>;
  /**
   * 플레이어별 타워 외형. **`kinds` 와 정확히 같은 이유로 서버가 정한다** —
   * 외형이 생산속도(`towers.ts` 의 `speed`)를 정하므로 순수 외형이 아니다.
   * 각자 자기 계정에서 읽으면 두 쪽이 다른 `PlayerMods` 로 돌아 첫 틱부터 갈라진다.
   *
   * 서버는 **이름만** 내려준다. 이름 → 배수 변환은 클라이언트에만 있다 (`towerSpeedOf`).
   */
  towerKinds: Record<PlayerId, TowerKind>;
  /**
   * 플레이어별 닉네임. **서버가 내려준 것만 쓴다** —
   * 클라이언트가 보내면 남의 이름을 자칭할 수 있다.
   */
  names: Record<PlayerId, string>;
  /** 플레이어별 프로필 아바타. 이름과 같은 이유로 서버가 내려준 것만 쓴다. */
  profiles: Record<PlayerId, ProfileId>;
  /**
   * 플레이어별 PVP 점수. **판이 시작될 때 서버가 찍어 둔 스냅샷이다** (`state.ratings`) —
   * 판 도중에 안 바뀌고, 판이 끝난 뒤 Elo 계산의 기준이 되는 값과 같다 (§-27).
   */
  ratings: Record<PlayerId, number>;
  /**
   * 플레이어별 배속 사용 권한(유료). **서버가 계정에서 읽어 내려준다** —
   * 각자 자기 계정을 읽으면 같은 `setTempo` 명령을 한쪽만 받아들여 갈라진다.
   */
  tempo: Record<PlayerId, boolean>;
  /**
   * 코드를 주고받아 만난 친구 방인가. **서버 룸 상태의 `private` 다.**
   *
   * 친구 방은 코인도 점수도 전적도 안 준다 (`server.js` 의 `#grantReward`) — 상대를
   * 고를 수 있어서 둘이 짜고 번갈아 져 주면 무엇이든 무한히 불릴 수 있기 때문이다.
   * 그래서 결과 화면이 보상 금액을 적으면 거짓말이 되고, [광고 보고 두 배] 버튼은
   * 광고를 끝까지 본 뒤에 서버가 거절하는 함정이 된다.
   *
   * **클라이언트가 스스로 추측하지 않는다** — 방을 코드로 만들었는지는 재접속·복구
   * 뒤에 알 수 없다. 서버가 쥔 값을 그대로 받는다.
   */
  friendRoom: boolean;
  /** 명령을 몇 틱 뒤에 실행할 것인가. 서버 룸 상태의 `inputDelayTicks`. */
  inputDelayTicks: number;
  /** 몇 틱마다 상태 해시를 보낼 것인가. 0이면 안 보낸다. */
  desyncCheckTicks: number;
}
