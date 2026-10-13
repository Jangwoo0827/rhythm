import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

/** 빌드 결과(dist)의 모든 파일을 사전 캐시하는 오프라인 서비스 워커(dist/sw.js)를 생성한다. */
function offlineSw(): Plugin {
  let outDir = 'dist';
  return {
    name: 'rhythm-offline-sw',
    apply: 'build',
    configResolved(c) { outDir = c.build.outDir; },
    closeBundle() {
      const files: string[] = [];
      const walk = (dir: string) => {
        for (const name of readdirSync(dir)) {
          const p = join(dir, name);
          if (statSync(p).isDirectory()) walk(p);
          else files.push(relative(outDir, p).split('\\').join('/'));
        }
      };
      walk(outDir);
      const list = files.filter((f) => f !== 'sw.js').sort();
      const hash = createHash('sha256');
      for (const f of list) hash.update(f).update(readFileSync(join(outDir, f)));
      const version = hash.digest('hex').slice(0, 12);
      // './' 는 앱 진입 URL(index.html)
      const precache = ['./', ...list.map((f) => `./${f}`)];
      const tpl = readFileSync('scripts/sw.template.js', 'utf8')
        .replace('__VERSION__', version)
        .replace('__PRECACHE__', JSON.stringify(precache));
      if (/__[A-Z]+__/.test(tpl)) throw new Error('sw.js 자리 표시자가 치환되지 않았습니다');
      writeFileSync(join(outDir, 'sw.js'), tpl);
    },
  };
}

// base: './' → 어느 경로(GitHub Pages 의 /<저장소>/ 포함)에 올려도 동작하는 상대 경로 빌드
// host: true → 같은 와이파이의 폰에서 http://<PC IP>:5173 으로 접속 가능
export default defineConfig({
  base: './',
  plugins: [offlineSw()],
  server: { host: true, port: 5173 },
  preview: { host: true, port: 4173 },
  worker: { format: 'es' },
  // Firebase SDK 는 로그인/온라인 기능을 쓸 때만 지연 로딩되는 별도 청크라 크기 경고를 올려 둔다
  build: { chunkSizeWarningLimit: 800 },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
