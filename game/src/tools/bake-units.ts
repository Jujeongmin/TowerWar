// 3D 캐릭터(GLB)에서 2D 유닛 스프라이트를 굽는다.
//
// 게임 코드가 아니다. 어디서도 import 하지 않으므로 빌드에 안 실린다
// (sim/maps-check.ts, net/lockstep-check.ts 와 같은 자리).
// 브라우저 콘솔에서 캐시 버스팅 동적 import 로 부른다:
//
//   const B = await import('/src/tools/bake-units.ts?v=' + Date.now());
//   await B.bake();                       // 기본값으로 굽기
//   await B.preview({ frames: 6 });       // 디스크에 안 쓰고 화면에만
//
// 규칙 두 가지는 §7 에서 온 것이라 지킬 것:
//  1. 전 프레임 합집합 상자로 자른다 — 프레임마다 자르면 달릴 때 발이 튄다
//  2. 유닛은 진행 방향으로 회전시키지 않는다. 렌더러가 좌우 반전만 하므로
//     여기서는 항상 화면 오른쪽을 보게 굽는다

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';

/**
 * 프로젝트 루트. **dev 서버에 물어본다** (`/__bake/root`).
 *
 * 전에는 `'C:/Users/anjsh/OneDrive/Desktop/TowerWar'` 가 소스에 박혀 있었다 —
 * **다른 PC에서 클론하면 베이커가 통째로 죽는다.** 저장소를 GitHub에 올린 뒤로
 * 실제로 걸리는 문제라 서버가 알려 주게 바꿨다.
 */
let cachedRoot: string | null = null;
async function projectRoot(): Promise<string> {
  if (cachedRoot) return cachedRoot;
  const res = await fetch('/__bake/root');
  if (!res.ok) throw new Error('dev 서버에서 프로젝트 루트를 못 읽었습니다 (npm run dev 중인가?)');
  cachedRoot = (await res.json()).root as string;
  return cachedRoot;
}

/**
 * 경로를 dev 서버가 읽을 수 있는 URL 로 바꾼다.
 * **프로젝트 루트 기준 상대 경로**를 쓰는 것이 기본이고, 절대 경로도 그대로 받는다.
 */
async function fsUrl(p: string): Promise<string> {
  const s = p.replace(/\\/g, '/');
  const isAbs = /^[a-zA-Z]:\//.test(s) || s.startsWith('/');
  const abs = isAbs ? s : `${await projectRoot()}/${s}`;
  return '/@fs/' + abs.replace(/^\/+/, '');
}

export interface BakeOptions {
  /** 캐릭터 GLB. 스킨과 텍스처가 들어 있어야 한다 */
  model: string;
  /** 걷기/달리기 클립을 담은 별도 파일 (FBX 또는 GLB). 없으면 model 안의 클립을 쓴다 */
  animation: string | null;
  /** 쓸 클립 이름. 없으면 첫 번째 클립 */
  clip: string | null;
  /** 뽑을 프레임 수. 기존 유닛은 4~6장이다 */
  frames: number;
  /** 스프라이트 높이(px). warrior 가 91 이라 맞춰 둔다 */
  height: number;
  /** 캐릭터가 화면 오른쪽을 보도록 돌리는 각도(도). `directions` 를 주면 안 쓴다. */
  yawDeg: number;
  /**
   * 한 번에 구울 방향들. **각도는 전부 `facing()` 으로 재서 정했다** — 눈으로 고르면 틀린다.
   *
   *   yaw 0   → 정면(카메라 쪽)  = 화면 **아래로** 걷는 그림
   *   yaw 90  → 오른쪽           = 옆모습. 왼쪽 이동은 렌더러가 좌우 반전한다
   *   yaw 180 → 후면             = 화면 **위로** 걷는 그림
   *
   * `prefix` 가 파일 이름이 된다 (`run0.png` · `up0.png` · `down0.png`).
   * **`run` 을 바꾸지 말 것** — 상점 썸네일이 `run0.png` 를 직접 부른다.
   */
  directions: { prefix: string; yawDeg: number }[];
  /** 카메라 높낮이. 0 = 정측면, 값이 크면 위에서 내려다본다 */
  pitchDeg: number;
  /**
   * 진영색을 입힐 머티리얼 이름. 옷만 물들여야 피부·머리색이 안 상한다.
   * `'auto'` 면 면적이 가장 큰 것을 고른다 — 처음 보는 캐릭터에 쓴다.
   */
  factionMaterials: string[] | 'auto';
  /**
   * 종류(변형)색을 입힐 머티리얼. **진영색 머티리얼과 겹치면 안 된다** —
   * 겹치는 이름은 진영색이 이긴다.
   *
   * 유닛은 화면에서 26px 이고 스프라이트 색이 "누구 편인가"의 **유일한 신호**다
   * (렌더러가 유닛에 배지도 테두리도 안 그린다). 그래서 재킷은 진영 전용으로 두고
   * 변형은 하의·머리에만 넣는다. 신발(`sneakers_white_MAT`)은 일부러 뺐다 —
   * 흰색 하나가 발치에 남아야 다리와 발이 안 뭉친다.
   */
  accentMaterials: string[];
  /** 변형색. `null` 이면 원본 텍스처 그대로 간다 (기본 종류). */
  accentColor: string | null;
  /**
   * 진영색을 넣는 방식.
   *  'flat'     — 텍스처를 떼고 단색으로. 명암은 조명이 만든다
   *  'multiply' — 텍스처 위에 색을 곱한다
   *
   * 기본이 'flat' 인 이유: 봄버재킷 원본이 올리브색이라 곱하면 파랑이 초록으로 나온다.
   * 화면에서 20px 로 그려지는 유닛이라 어느 편인지가 무늬보다 훨씬 중요하다.
   */
  tintMode: 'flat' | 'multiply';
  /** 진영별 색. renderer.ts 의 OWNER_COLOR 와 같은 값 */
  factions: { key: string; color: string }[];
  /** 저장 경로 틀. {faction}/{kind}/run{i}.png */
  outDir: string;
  kind: string;
  /** 오버샘플 배수. 크게 렌더해 줄이면 계단이 덜 보인다 */
  supersample: number;
  /** 디스크에 쓸지. false 면 결과만 돌려준다 */
  write: boolean;
}

const DEFAULTS: BakeOptions = {
  // 프로젝트 루트 기준 상대 경로다. `assets-src/` 는 저장소에 없으니(§-25)
  // 다른 PC에서는 이 파일을 먼저 갖다 놓아야 한다.
  model: 'assets-src/beergang/GangHouse/BeerGang/glb/final_Lyquid_mvp_uv_rig_ani_mat_05.glb',
  animation: 'assets-src/beergang/GangHouse/BeerGang/anim/Walking.fbx',
  clip: null,
  frames: 6,
  height: 91,
  // 90 이 화면 오른쪽을 본다. **`facing()` 으로 뼈 좌표를 재서 정한 값이다.**
  // 처음에 정면 렌더를 눈으로 보고 270으로 정했다가 유닛이 뒤로 걸었다 —
  // 3D 렌더는 좌우 대칭에 가까워서 눈으로는 안 갈린다. 바꿀 때 반드시 `facing()` 을 돌릴 것.
  yawDeg: 90,
  directions: [
    { prefix: 'run', yawDeg: 90 },
    { prefix: 'up', yawDeg: 180 },
    { prefix: 'down', yawDeg: 0 },
  ],
  pitchDeg: 12,
  factionMaterials: ['bomberJacket_MAT'],
  accentMaterials: ['pants_MAT', 'hair_Wu_MAT'],
  accentColor: null,
  tintMode: 'flat',
  factions: [
    { key: 'p1', color: '#3fbdf1' },
    { key: 'p2', color: '#f2555f' },
  ],
  outDir: 'game/public/assets/unit',
  kind: 'beergang',
  supersample: 3,
  write: true,
};

interface Loaded {
  root: THREE.Object3D;
  clips: THREE.AnimationClip[];
}

/**
 * 캐릭터를 읽는다. **GLB 와 FBX 를 둘 다 받는다.**
 *
 * Mixamo 에서 캐릭터를 "with skin" 으로 받으면 FBX 로 나오고 걷기가 그 안에 들어 있다 —
 * 그때는 별도 `animation` 파일이 필요 없다.
 */
async function loadModel(url: string): Promise<Loaded> {
  if (/\.fbx(\?|$)/i.test(url)) {
    const o = await new FBXLoader().loadAsync(url);
    return { root: o, clips: o.animations };
  }
  const g = await new GLTFLoader().loadAsync(url);
  return { root: g.scene, clips: g.animations };
}

/**
 * 진영색을 입힐 머티리얼을 고른다.
 *
 * `'auto'` 는 **표면적이 가장 넓은 머티리얼**을 고른다. 대개 상의나 몸통이라
 * 26px 로 줄여도 색이 읽힌다.
 *
 * **삼각형 개수로 세면 안 된다.** BeerGang 으로 해 보니 운동화(`sneakers_white_MAT`)가
 * 뽑혔다 — 작지만 촘촘하게 나뉘어 있어서다. 실제 넓이를 재야 옷이 뽑힌다.
 *
 * 이건 어디까지나 처음 보는 모델용 기본값이다. `inspect()` 로 이름을 확인하고
 * `factionMaterials: ['이름']` 로 못 박는 것이 항상 더 정확하다.
 */
function pickFactionMaterials(root: THREE.Object3D, want: string[] | 'auto'): Set<string> {
  if (want !== 'auto') return new Set(want);

  const area = new Map<string, number>();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();

  root.updateMatrixWorld(true);
  root.traverse((obj: any) => {
    if (!obj.isMesh || !obj.geometry) return;
    const g = obj.geometry as THREE.BufferGeometry;
    const pos = g.attributes.position;
    if (!pos) return;
    const idx = g.index;
    const n = idx ? idx.count : pos.count;

    let sum = 0;
    for (let i = 0; i < n; i += 3) {
      const i0 = idx ? idx.getX(i) : i;
      const i1 = idx ? idx.getX(i + 1) : i + 1;
      const i2 = idx ? idx.getX(i + 2) : i + 2;
      a.fromBufferAttribute(pos, i0).applyMatrix4(obj.matrixWorld);
      b.fromBufferAttribute(pos, i1).applyMatrix4(obj.matrixWorld);
      c.fromBufferAttribute(pos, i2).applyMatrix4(obj.matrixWorld);
      sum += ab.subVectors(b, a).cross(ac.subVectors(c, a)).length() / 2;
    }

    const mats: THREE.Material[] = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const m of mats) {
      if (!m?.name) continue;
      area.set(m.name, (area.get(m.name) ?? 0) + sum / mats.length);
    }
  });

  const top = [...area.entries()].sort((x, y) => y[1] - x[1])[0];
  return new Set(top ? [top[0]] : []);
}

async function loadClips(url: string): Promise<THREE.AnimationClip[]> {
  if (/\.fbx$/i.test(url)) {
    const o = await new FBXLoader().loadAsync(url);
    return o.animations;
  }
  const g = await new GLTFLoader().loadAsync(url);
  return g.animations;
}

/**
 * Mixamo 클립을 이 리그에 맞춘다.
 *
 * 리그가 mixamorig: 이름을 그대로 쓰므로 리타게팅이 필요 없다. 다만 두 가지를 손본다:
 *  - FBX 쪽 트랙 이름이 `mixamorig:Hips.position` 형태라 three 가 찾는
 *    `mixamorig:Hips.position` 과 대개 같지만, 이름에 붙은 접두사가 다를 수 있다
 *  - **위치 트랙을 통째로 버린다.** 두 가지 이유가 겹친다:
 *    (1) Mixamo FBX 는 단위가 cm 라 값이 100배다. 그대로 넣으면 캐릭터가 화면 밖으로 날아간다
 *    (2) 다른 본의 위치 트랙은 뼈 길이를 Mixamo 표준 체형으로 늘려 몸을 찌그러뜨린다
 *    회전만 가져오면 이 리그의 체형 그대로 같은 동작을 한다. 어차피 제자리 사이클이라
 *    이동 성분은 필요 없다 — 유닛의 이동은 시뮬레이션이 만든다
 */
function retargetToRig(clip: THREE.AnimationClip, root: THREE.Object3D): THREE.AnimationClip {
  const names = new Set<string>();
  root.traverse(o => { if (o.name) names.add(o.name); });

  const tracks: THREE.KeyframeTrack[] = [];
  for (const t of clip.tracks) {
    const dot = t.name.lastIndexOf('.');
    let bone = t.name.slice(0, dot);
    const prop = t.name.slice(dot + 1);

    if (!names.has(bone)) {
      // `Armature|mixamorig:Hips` 처럼 접두사가 붙은 경우 뒤쪽만 떼어 다시 찾는다
      const tail = bone.split('|').pop() ?? bone;
      if (names.has(tail)) bone = tail;
      else if (names.has('mixamorig:' + tail)) bone = 'mixamorig:' + tail;
      else continue;
    }
    if (prop === 'position') continue;

    const c = t.clone();
    c.name = `${bone}.${prop}`;
    tracks.push(c);
  }
  return new THREE.AnimationClip(clip.name, clip.duration, tracks);
}

/** 알파가 있는 픽셀들의 최소 사각형. 없으면 null */
function alphaBounds(data: Uint8ClampedArray, w: number, h: number) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > 8) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x0, y0, x1, y1 };
}

interface BakeResult {
  faction: string;
  /** 파일 이름 앞머리 = 화면 이동 방향 (`run` 옆 · `up` 위 · `down` 아래). */
  dir: string;
  frames: string[];        // dataURL
  paths: string[];
  width: number;
  height: number;
}

export async function bake(opts: Partial<BakeOptions> = {}) {
  const o: BakeOptions = { ...DEFAULTS, ...opts };
  const log: string[] = [];

  const { root, clips: own } = await loadModel(await fsUrl(o.model));
  let clips = own;
  if (o.animation) {
    const ext = await loadClips(await fsUrl(o.animation));
    clips = ext.map(c => retargetToRig(c, root));
    log.push(`외부 클립 ${ext.length}개: ${ext.map(c => c.name).join(', ')}`);
  }
  if (!clips.length) throw new Error('애니메이션 클립이 없습니다');

  const clip = o.clip ? clips.find(c => c.name === o.clip) : clips[0];
  if (!clip) throw new Error(`클립 '${o.clip}' 없음. 있는 것: ${clips.map(c => c.name).join(', ')}`);
  log.push(`클립 "${clip.name}" ${clip.duration.toFixed(3)}초, 트랙 ${clip.tracks.length}`);

  // 진영색을 입힐 머티리얼을 찾아 둔다. 원본 색은 건드리지 않고 복제해서 쓴다
  // 원본 맵을 따로 들고 있어야 진영을 바꿔 가며 두 방식을 다 쓸 수 있다
  const wanted = pickFactionMaterials(root, o.factionMaterials);
  // 변형색이 없는 종류(기본)는 아무것도 안 고른다 — 원본 텍스처가 그대로 나가야 한다
  const accentWanted = new Set(o.accentColor ? o.accentMaterials : []);
  const tintable: { mat: THREE.MeshStandardMaterial; map: THREE.Texture | null }[] = [];
  const accents: { mat: THREE.MeshStandardMaterial; map: THREE.Texture | null }[] = [];
  const matNames: string[] = [];
  root.traverse((obj: any) => {
    if (!obj.isMesh) return;
    obj.frustumCulled = false;
    const mats: THREE.Material[] = Array.isArray(obj.material) ? obj.material : [obj.material];
    mats.forEach((m, i) => {
      matNames.push(m.name);
      // 같은 이름이 양쪽에 들어 있으면 진영색이 이긴다. 편 구분이 변형보다 우선이다
      const isFaction = wanted.has(m.name);
      if (!isFaction && !accentWanted.has(m.name)) return;
      const c = (m as THREE.MeshStandardMaterial).clone();
      if (Array.isArray(obj.material)) obj.material[i] = c; else obj.material = c;
      (isFaction ? tintable : accents).push({ mat: c, map: c.map });
    });
  });
  log.push(`머티리얼: ${[...new Set(matNames)].join(', ')}`);
  log.push(`진영색 대상 ${tintable.length}개 [${[...wanted].join(', ')}]`);
  if (tintable.length === 0) {
    throw new Error(
      `진영색을 입힐 머티리얼을 못 찾았습니다. inspect() 로 이름을 확인하고 ` +
        `factionMaterials 로 지정하세요. 있는 것: ${[...new Set(matNames)].join(', ')}`,
    );
  }

  // 변형색은 진영과 무관하므로 한 번만 칠하고 끝낸다.
  // **못 찾으면 던진다.** 조용히 넘어가면 기본 종류와 똑같은 그림이 다른 이름으로
  // 구워지고, 상점에서 돈을 낸 뒤에야 같은 것임을 알게 된다.
  if (o.accentColor) {
    if (accents.length === 0) {
      throw new Error(
        `변형색을 입힐 머티리얼을 못 찾았습니다 [${o.accentMaterials.join(', ')}]. ` +
          `있는 것: ${[...new Set(matNames)].join(', ')}`,
      );
    }
    const ac = new THREE.Color(o.accentColor);
    for (const { mat } of accents) {
      mat.map = null;
      mat.color = ac.clone();
      mat.needsUpdate = true;
    }
    log.push(`변형색 ${o.accentColor} 대상 ${accents.length}개 [${[...accentWanted].join(', ')}]`);
  }

  const mixer = new THREE.AnimationMixer(root);
  const action = mixer.clipAction(clip);
  action.play();

  // ---- 씬 ----
  const scene = new THREE.Scene();
  const pivot = new THREE.Group();
  pivot.add(root);
  pivot.rotation.y = THREE.MathUtils.degToRad(o.yawDeg);
  scene.add(pivot);

  scene.add(new THREE.AmbientLight(0xffffff, 1.9));
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(2, 4, 3);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xbfd4ff, 0.9);
  fill.position.set(-3, 1, -2);
  scene.add(fill);

  // 한 번 갱신해 실제 크기를 잰다 (T 포즈가 아니라 클립 첫 프레임 기준)
  mixer.setTime(0);
  pivot.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(pivot);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  log.push(`모델 크기 ${size.x.toFixed(2)} × ${size.y.toFixed(2)} × ${size.z.toFixed(2)}`);

  // 여유 20% — 팔다리가 프레임마다 상자 밖으로 나간다.
  // **z 도 넣는다.** 방향을 여러 개 구우면서 회전하면 지금 x였던 것이 z가 되므로,
  // x·y만 보면 정면·후면에서 팔이 잘린다.
  const span = Math.max(size.x, size.y, size.z) * 1.2;
  const SS = o.supersample;
  const W = Math.round(o.height * SS * 1.6);
  const H = Math.round(o.height * SS * 1.6);

  const cam = new THREE.OrthographicCamera(-span / 2, span / 2, span / 2, -span / 2, 0.01, span * 10);
  const pitch = THREE.MathUtils.degToRad(o.pitchDeg);
  const dist = span * 3;
  cam.position.set(center.x, center.y + Math.sin(pitch) * dist, center.z + Math.cos(pitch) * dist);
  cam.lookAt(center);
  // 정사영이라 가로세로 비를 캔버스에 맞춘다
  cam.left = -span / 2; cam.right = span / 2;
  cam.top = span / 2; cam.bottom = -span / 2;
  cam.updateProjectionMatrix();

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(W, H, false);
  renderer.setClearAlpha(0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const grab = document.createElement('canvas');
  grab.width = W; grab.height = H;
  const gctx = grab.getContext('2d', { willReadFrequently: true })!;

  const results: BakeResult[] = [];

  // 방향을 바깥 루프로 둔다. 모델·클립·머티리얼을 한 번만 준비해 세 방향에 재사용한다 —
  // GLB가 21MB라 방향마다 다시 읽으면 굽는 시간이 세 배가 된다.
  for (const d of o.directions) {
    pivot.rotation.y = THREE.MathUtils.degToRad(d.yawDeg);

  for (const f of o.factions) {
    const col = new THREE.Color(f.color);
    for (const { mat, map } of tintable) {
      if (o.tintMode === 'flat') {
        mat.map = null;
        mat.color = col.clone();
      } else {
        mat.map = map;
        // 텍스처가 곱해지므로 색을 그대로 넣으면 어두워진다. 밝기를 보정한다
        mat.color = col.clone().multiplyScalar(1.35);
      }
      mat.needsUpdate = true;
    }

    // 1) 전 프레임을 원본 해상도로 그려 두고 알파 합집합 상자를 구한다
    const raw: ImageData[] = [];
    let union: { x0: number; y0: number; x1: number; y1: number } | null = null;
    for (let i = 0; i < o.frames; i++) {
      mixer.setTime((clip.duration * i) / o.frames);
      renderer.render(scene, cam);
      gctx.clearRect(0, 0, W, H);
      gctx.drawImage(renderer.domElement, 0, 0);
      const img = gctx.getImageData(0, 0, W, H);
      raw.push(img);
      const b = alphaBounds(img.data, W, H);
      if (!b) continue;
      union = union
        ? { x0: Math.min(union.x0, b.x0), y0: Math.min(union.y0, b.y0), x1: Math.max(union.x1, b.x1), y1: Math.max(union.y1, b.y1) }
        : b;
    }
    if (!union) throw new Error('빈 프레임만 나왔습니다 — 카메라나 회전을 확인하세요');

    const cw = union.x1 - union.x0 + 1;
    const ch = union.y1 - union.y0 + 1;
    const outH = o.height;
    const outW = Math.max(1, Math.round((cw / ch) * outH));

    // 2) 합집합 상자로 잘라 목표 크기로 줄인다
    const src = document.createElement('canvas');
    src.width = cw; src.height = ch;
    const sctx = src.getContext('2d')!;
    const dst = document.createElement('canvas');
    dst.width = outW; dst.height = outH;
    const dctx = dst.getContext('2d')!;
    dctx.imageSmoothingQuality = 'high';

    const frames: string[] = [];
    const paths: string[] = [];
    for (let i = 0; i < o.frames; i++) {
      const full = document.createElement('canvas');
      full.width = W; full.height = H;
      full.getContext('2d')!.putImageData(raw[i], 0, 0);
      sctx.clearRect(0, 0, cw, ch);
      sctx.drawImage(full, union.x0, union.y0, cw, ch, 0, 0, cw, ch);
      dctx.clearRect(0, 0, outW, outH);
      dctx.drawImage(src, 0, 0, outW, outH);
      const url = dst.toDataURL('image/png');
      frames.push(url);
      paths.push(`${o.outDir}/${f.key}/${o.kind}/${d.prefix}${i}.png`);
    }

    results.push({ faction: f.key, dir: d.prefix, frames, paths, width: outW, height: outH });
    log.push(`${d.prefix} ${f.key}: 추출 ${cw}×${ch} → 출력 ${outW}×${outH}, ${o.frames}장`);
  }
  }

  let written = 0;
  if (o.write) {
    for (const r of results) {
      for (let i = 0; i < r.frames.length; i++) {
        const res = await fetch('/__bake/write', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ path: r.paths[i], dataUrl: r.frames[i] }),
        });
        const j = await res.json();
        if (!j.ok) throw new Error(`쓰기 실패 ${r.paths[i]}: ${j.error}`);
        written++;
      }
    }
    log.push(`${written}장 저장`);
  }

  renderer.dispose();

  return {
    log,
    clips: clips.map(c => ({ name: c.name, duration: +c.duration.toFixed(3) })),
    // 방향마다 실루엣 폭이 다르다 (옆모습이 제일 넓다). 높이는 전부 같다.
    sizes: results.map(r => ({ dir: r.dir, faction: r.faction, w: r.width, h: r.height })),
    written,
    paths: results.flatMap(r => r.paths),
    frames: results.map(r => ({ faction: r.faction, dir: r.dir, frames: r.frames })),
  };
}

/** 디스크에 안 쓰고 화면에 붙여 눈으로 보는 용도. 확인 후 removeStrip() 으로 지운다. */
export async function preview(opts: Partial<BakeOptions> = {}) {
  const r = await bake({ ...opts, write: false });
  removeStrip();
  const box = document.createElement('div');
  box.id = 'bake-strip';
  box.style.cssText =
    'position:fixed;inset:auto 0 0 0;z-index:99999;background:#1b2430;padding:8px;' +
    'display:flex;flex-direction:column;gap:6px;font:12px monospace;color:#cfe';
  for (const f of r.frames) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:6px;align-items:flex-end';
    const tag = document.createElement('span');
    tag.textContent = `${f.dir} ${f.faction}`;
    row.appendChild(tag);
    for (const src of f.frames) {
      const img = new Image();
      img.src = src;
      img.style.cssText = 'image-rendering:pixelated;outline:1px solid #35506b;height:91px';
      row.appendChild(img);
    }
    box.appendChild(row);
  }
  document.body.appendChild(box);
  return r;
}

export function removeStrip() {
  document.getElementById('bake-strip')?.remove();
}

/** 모델 안에 뭐가 있는지만 본다 (굽지 않는다). */
export async function inspect(model = DEFAULTS.model) {
  const { root, clips } = await loadModel(await fsUrl(model));
  const mats = new Set<string>();
  const meshes: string[] = [];
  root.traverse((o: any) => {
    if (!o.isMesh) return;
    meshes.push(o.name);
    (Array.isArray(o.material) ? o.material : [o.material]).forEach((m: any) => mats.add(m.name));
  });
  return {
    clips: clips.map(c => ({ name: c.name, duration: +c.duration.toFixed(3), tracks: c.tracks.length })),
    materials: [...mats],
    meshes,
    /** `factionMaterials: 'auto'` 로 구우면 여기에 진영색이 칠해진다. */
    autoFactionMaterial: [...pickFactionMaterials(root, 'auto')],
  };
}

/**
 * 캐릭터가 화면 어느 쪽을 보는지 **뼈 좌표로** 잰다.
 *
 * 눈으로 보고 정하면 틀린다 — §-16에서 실제로 270으로 정했다가 유닛이 뒤로 걸었다.
 * 3D 렌더는 좌우 대칭에 가까워서 정면/후면은 더 안 갈린다. **반드시 이걸 돌릴 것.**
 *
 * 발끝(`ToeBase`)은 발목(`Foot`)보다 항상 앞에 있다. 그 벡터를 회전 적용 후 월드에서 잰다.
 * 카메라가 +Z 에서 원점을 보므로:
 *
 *   월드 +x = 화면 오른쪽      월드 -x = 화면 왼쪽
 *   월드 +z = 카메라 쪽 = 정면  월드 -z = 카메라 반대 = 후면
 *
 * 세로형이 된 뒤로 화면에서 **+z 는 아래로 걷는 것, -z 는 위로 걷는 것**이다.
 */
export async function facing(
  yawDeg = DEFAULTS.yawDeg,
  model = DEFAULTS.model,
  // 굽는 것과 **같은 클립**으로 재야 의미가 있다. 모델 안의 idle 로 재면 보폭이 없어
  // 발끝-발목 벡터가 흐려진다 (실측: Walking 1.0088 vs 모델 기본 클립 1.3749).
  animation: string | null = DEFAULTS.animation,
) {
  const { root, clips: own } = await loadModel(await fsUrl(model));
  const clips = animation ? (await loadClips(await fsUrl(animation))).map(c => retargetToRig(c, root)) : own;

  const pivot = new THREE.Group();
  pivot.add(root);
  pivot.rotation.y = THREE.MathUtils.degToRad(yawDeg);

  const mixer = new THREE.AnimationMixer(root);
  mixer.clipAction(clips[0]).play();

  const find = (re: RegExp) => {
    let hit: THREE.Object3D | null = null;
    root.traverse(o => { if (!hit && re.test(o.name)) hit = o; });
    return hit as THREE.Object3D | null;
  };
  const ankle = find(/LeftFoot$/i);
  const toe = find(/LeftToe(Base)?$/i);
  if (!ankle || !toe) throw new Error('발 뼈를 못 찾았습니다');

  let sumX = 0;
  let sumZ = 0;
  const samples: { x: number; z: number }[] = [];
  for (let i = 0; i < 8; i++) {
    mixer.setTime((clips[0].duration * i) / 8);
    pivot.updateMatrixWorld(true);
    const a = ankle.getWorldPosition(new THREE.Vector3());
    const t = toe.getWorldPosition(new THREE.Vector3());
    const dx = t.x - a.x;
    const dz = t.z - a.z;
    samples.push({ x: +dx.toFixed(4), z: +dz.toFixed(4) });
    sumX += dx;
    sumZ += dz;
  }
  // 큰 성분이 이 각도의 정체다. 옆모습은 x가, 정면/후면은 z가 지배한다.
  const facing =
    Math.abs(sumX) >= Math.abs(sumZ)
      ? sumX > 0
        ? 'right'
        : 'left'
      : sumZ > 0
        ? 'front'
        : 'back';
  return {
    yawDeg,
    forwardX: +sumX.toFixed(4),
    forwardZ: +sumZ.toFixed(4),
    perFrame: samples,
    facing,
    /** 화면에서 어느 쪽으로 걷는 그림인가. 렌더러가 고르는 키와 같은 이름이다. */
    screenDir: facing === 'front' ? 'down' : facing === 'back' ? 'up' : facing,
  };
}

/** 외부 애니메이션 파일이 이 리그에 붙는지 검사만 한다. */
export async function checkAnimation(animation: string, model = DEFAULTS.model) {
  const { root } = await loadModel(await fsUrl(model));
  const rigNames = new Set<string>();
  root.traverse(o => { if (o.name) rigNames.add(o.name); });
  const clips = await loadClips(await fsUrl(animation));
  return clips.map(c => {
    const r = retargetToRig(c, root);
    const missing = new Set<string>();
    for (const t of c.tracks) {
      const bone = t.name.slice(0, t.name.lastIndexOf('.'));
      const tail = bone.split('|').pop() ?? bone;
      if (!rigNames.has(bone) && !rigNames.has(tail) && !rigNames.has('mixamorig:' + tail)) missing.add(bone);
    }
    return {
      name: c.name,
      duration: +c.duration.toFixed(3),
      tracksIn: c.tracks.length,
      tracksMatched: r.tracks.length,
      missing: [...missing].slice(0, 20),
    };
  });
}
