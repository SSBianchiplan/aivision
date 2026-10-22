// Regera o bundle ESM do MoCap do GPlanSiS|ROBO vendorizado no iaVision.
// uso: node gerar-bundle.mjs <raiz do robo (…/gplansis-robo/projeto/frontend)> <pasta de saída (…/vendor/gplansis-robo-mocap)>
// Não altera o robo: lê os fontes, usa o esbuild dele e escreve só na pasta de saída.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const [ROBO, SAIDA] = process.argv.slice(2);
if (!ROBO || !SAIDA) { console.error('uso: node gerar-bundle.mjs <robo/projeto/frontend> <saida>'); process.exit(2); }
const aqui = path.dirname(new URL(import.meta.url).pathname);
const tmp = path.join(aqui, '.entrada.ts');
fs.writeFileSync(tmp, fs.readFileSync(path.join(aqui, 'entrada.ts'), 'utf8').replaceAll('"ROBO/', `"${ROBO}/`));
const out = path.join(SAIDA, 'mocap-robo.mjs');
fs.mkdirSync(SAIDA, { recursive: true });
execFileSync(path.join(ROBO, 'node_modules/.bin/esbuild'), [tmp, '--bundle', '--format=esm', '--target=es2020', '--platform=neutral',
  '--external:three', '--legal-comments=inline', '--log-level=warning', `--outfile=${out}`], { stdio: 'inherit' });
fs.unlinkSync(tmp);
let js = fs.readFileSync(out, 'utf8');
const n = (js.match(/from "three"/g) || []).length;
js = js.replaceAll('from "three"', 'from "../three-0.170.0/three.module.min.js"');
const fontes = ['src/core/mocap/geometria.ts', 'src/core/mocap/posproc.ts', 'src/core/mocap/exportar.ts', 'src/core/mocap/sintetico.ts',
  'src/core/filtros.ts', 'src/core/rv03/marcha.ts', 'src/core/esqueleto.ts', 'src/core/simulador.ts', 'src/core/spec.ts', '../shared/robot_spec.json'];
const h = crypto.createHash('sha256');
for (const f of fontes) h.update(fs.readFileSync(path.join(ROBO, f)));
const cab = `/*\n * mocap-robo.mjs — núcleo de MoCap do GPlanSiS|ROBO (robo.gplansis.com), código de Stéfano Bianchi / GPlanSiS,\n` +
  ` * empacotado sem alteração de lógica para o GPlanSiS|iaVision (Motion 3D Studio, CV-88).\n` +
  ` * Fontes: ${fontes.join(', ')}\n * sha256 dos fontes: ${h.digest('hex')}\n` +
  ` * Gerado em ${new Date().toISOString()} por gerar-bundle.mjs (esbuild do próprio robo). NÃO EDITE: regere.\n */\n`;
fs.writeFileSync(out, cab + js);
console.log(`ok: ${out} (${(js.length / 1024).toFixed(0)} KB, ${n} import(s) de three reescritos)`);
