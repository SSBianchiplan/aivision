// Gera docs/modulos.md (módulos e operadores) a partir de um dump do registry.
// 1) No console do app (ou via CDP), rode:
//    copy(JSON.stringify(await (async()=>{const r=await import('/js/cv/registry.js');return {modules:r.MODULES,ops:[...r.OPERATORS.values()]}})(),(k,v)=>typeof v==='function'?undefined:v))
//    e salve como catalogo.json.
// 2) node ferramentas/gerar-modulos.mjs catalogo.json   (mantém a seção "## Modelos" do arquivo atual)
import fs from 'fs';
const [,, dumpPath, mdPath = 'docs/modulos.md'] = process.argv;
const { modules, ops } = JSON.parse(fs.readFileSync(dumpPath, 'utf8'));
const atual = fs.existsSync(mdPath) ? fs.readFileSync(mdPath, 'utf8') : '';
const iMod = atual.indexOf('\n## Modelos');
const modelos = iMod >= 0 ? atual.slice(iMod + 1) : '';
const nModelos = (modelos.match(/^\| `/gm) || []).length;
const porMod = new Map(modules.map((m) => [m.id, []]));
for (const o of ops) (porMod.get(o.group) || porMod.set(o.group, []).get(o.group)).push(o);
const esc = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
const lic = (m) => (porMod.get(m.id) || []).some((o) => o.agpl) ? 'AGPL-3.0 (com aceite)' : 'livre';
let md = `# Catálogo de módulos, operadores e modelos\n\n> Gerado a partir do código (\`site/js/cv/registry.js\`) por \`ferramentas/gerar-modulos.mjs\` — não editar à mão.\n\n`;
md += `**${modules.length} módulos · ${ops.length} operadores${nModelos ? ` · ${nModelos} modelos` : ''}.**\n\n## Módulos\n\n| ID | Módulo | Operadores | Execução | Licença |\n|---|---|---|---|---|\n`;
for (const m of modules) md += `| ${m.id} | ${esc(m.name)} | ${(porMod.get(m.id) || []).length} | ${m.runtime} | ${lic(m)} |\n`;
md += `\n## Operadores por módulo\n`;
for (const m of modules) {
  md += `\n### ${m.id} · ${m.name}\n\n${m.desc || ''}\n`;
  for (const o of porMod.get(m.id) || []) {
    md += `\n#### ${o.label} — \`${o.op}\`${o.agpl ? ' · AGPL' : ''}\n\n${o.desc || ''}\n`;
    const ps = Object.entries(o.params || {});
    if (ps.length) {
      md += `\n| Parâmetro | Tipo | Padrão | Faixa / opções |\n|---|---|---|---|\n`;
      for (const [k, p] of ps) {
        const faixa = p.options ? p.options.map((x) => (typeof x === 'object' ? x.value ?? x.label : x)).join(', ')
          : (p.min != null || p.max != null) ? `${p.min ?? ''}–${p.max ?? ''}` : '';
        const def = typeof p.default === 'object' ? JSON.stringify(p.default) : p.default;
        md += `| ${esc(p.label || k)} (\`${k}\`) | ${p.type} | ${esc(def)} | ${esc(faixa)} |\n`;
      }
    }
  }
}
if (modelos) md += `\n${modelos}`;
fs.writeFileSync(mdPath, md);
console.log(`${mdPath}: ${modules.length} módulos, ${ops.length} operadores`);
