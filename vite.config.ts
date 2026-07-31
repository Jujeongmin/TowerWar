import { defineConfig } from 'vite';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';

// 에셋 베이커가 뽑은 PNG를 디스크에 쓰는 개발 전용 창구.
// 브라우저는 파일을 못 쓰고, 프레임을 다운로드로 받으면 수십 장이 Downloads 로 흩어진다.
// apply:'serve' 라 프로덕션 빌드에는 존재하지 않는다.
function bakeWriter() {
  const ROOT = resolve(__dirname);
  return {
    name: 'towerwar-bake-writer',
    apply: 'serve' as const,
    configureServer(server: any) {
      // 베이커가 `assets-src/` 를 `/@fs/<절대경로>` 로 읽어야 하는데 브라우저는
      // 자기가 어느 폴더에서 서빙되는지 모른다. 전에는 소스에 이 PC 경로가 박혀 있어서
      // **다른 PC에서 클론하면 베이커가 통째로 죽었다.** 여기서 알려 준다.
      server.middlewares.use('/__bake/root', (_req: any, res: any) => {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ root: ROOT.replace(/\\/g, '/') }));
      });
      server.middlewares.use('/__bake/write', (req: any, res: any, next: any) => {
        if (req.method !== 'POST') return next();
        let body = '';
        req.on('data', (c: any) => { body += c; });
        req.on('end', () => {
          try {
            const { path: rel, dataUrl } = JSON.parse(body);
            // 경로 탈출 차단. 베이커가 부르는 창구지만 dev 서버는 host:true 라 같은 망에 열려 있다.
            const out = resolve(ROOT, rel);
            if (out !== ROOT && !out.startsWith(ROOT + sep)) throw new Error('경로가 프로젝트 밖입니다');
            const b64 = String(dataUrl).replace(/^data:image\/png;base64,/, '');
            mkdirSync(dirname(out), { recursive: true });
            writeFileSync(out, Buffer.from(b64, 'base64'));
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ ok: true, path: rel, bytes: Buffer.from(b64, 'base64').length }));
          } catch (e: any) {
            res.statusCode = 400;
            res.end(JSON.stringify({ ok: false, error: e.message }));
          }
        });
      });
    },
  };
}

// Verse8 업로드 규약에 맞춰 클라이언트 소스 전체를 game/ 아래에 둔다.
// Vite는 CWD에서 이 설정 파일을 먼저 찾은 뒤 root를 game/으로 바꿔 잡는다.
export default defineConfig({
  root: 'game',
  publicDir: 'public',
  plugins: [bakeWriter()],
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
  server: {
    // 호스트가 PORT를 지정하면 그걸 따른다 (포트 충돌 회피)
    port: Number(process.env.PORT) || 5173,
    // 같은 네트워크의 다른 기기(폰·노트북)에서 접속할 수 있게 모든 인터페이스에 바인딩한다.
    // 기본값은 localhost만 열어서 다른 기기에서 안 보인다.
    host: true,
  },
});
