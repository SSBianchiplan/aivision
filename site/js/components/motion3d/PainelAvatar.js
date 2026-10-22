/**
 * components/motion3d/PainelAvatar.js — o painel "Avatar" do Motion 3D Studio v2: o modelo 3D
 * carregado, o EDITOR DE MAPEAMENTO ossos × juntas (automático — VRM, Mixamo, heurística — e
 * manual), a pose de repouso detectada (T/A, corrigida pelo retarget), a conferência dos ângulos
 * contra a captura e as peças da cadeia que dão dedos (maos.gestos) e rosto (rosto.malha).
 */
import { html, useState, useMemo } from '../../vendor.js';
import { linhasMapa, faltando } from './avatar.js';

const ROT = {
  hips: 'Quadril', spine: 'Coluna', chest: 'Peito', upperChest: 'Peito alto', neck: 'Pescoço', head: 'Cabeça',
  Shoulder: 'Ombro', UpperArm: 'Braço', LowerArm: 'Antebraço', Hand: 'Mão', UpperLeg: 'Coxa', LowerLeg: 'Canela', Foot: 'Pé', Toes: 'Dedos do pé',
  Thumb: 'Polegar', Index: 'Indicador', Middle: 'Médio', Ring: 'Anelar', Little: 'Mínimo', Metacarpal: 'metacarpo', Proximal: 'proximal', Intermediate: 'medial', Distal: 'distal',
};
export function rotuloOsso(h) {
  if (ROT[h]) return ROT[h];
  const m = h.match(/^(left|right)(Thumb|Index|Middle|Ring|Little)?(.*)$/);
  if (!m) return h;
  const lado = m[1] === 'left' ? 'esq.' : 'dir.';
  return m[2] ? `${ROT[m[2]]} ${ROT[m[3]] || m[3]} ${lado}` : `${ROT[m[3]] || m[3]} ${lado}`;
}

/**
 * props: { info ({ nome, tipo, vrm, ossos: [nomes], repouso, escala, flags }), mapa, origem,
 * onMapa(novo), onAuto(), onSalvar(), onRepouso(bool), conferencia, onConferir(),
 * cadeia ({ maos, rosto }), onCadeia(chave, valor) }
 */
export function PainelAvatar({ info, mapa, origem = {}, onMapa, onAuto, onSalvar, onRepouso, repouso, conferencia, onConferir, cadeia, onCadeia }) {
  const [verDedos, setVerDedos] = useState(false);
  const [busca, setBusca] = useState('');
  const linhas = useMemo(() => linhasMapa(mapa).filter((l) => (verDedos || !/Thumb|Index|Middle|Ring|Little/.test(l.humano)) && (!busca || (l.humano + rotuloOsso(l.humano) + l.osso).toLowerCase().includes(busca.toLowerCase()))), [mapa, verDedos, busca]);
  if (!info) return html`<p class="m3d-dica">Nenhum modelo carregado. No Content Browser, abra <b>Characters</b> e escolha um exemplo (VRM ou GLB gerados em código) ou importe o seu (⤓ Import: GLB, GLTF, VRM 0.x/1.0, FBX).</p>`;
  const falta = faltando(mapa);
  const opcoes = ['', ...info.ossos];
  return html`
    <div class="m3d-av">
      <div class="m3d-kv"><span>Modelo</span><b>${info.nome} · ${info.tipo.toUpperCase()}${info.vrm ? ` (VRM ${info.vrm})` : ''}</b></div>
      <div class="m3d-kv"><span>Repouso</span><b>${info.repouso} — o retarget mede o repouso e corrige T/A sozinho</b></div>
      <div class="m3d-kv"><span>Escala</span><b>${info.escala === 1 ? 'original (m)' : `×${info.escala.toFixed(3)} (normalizada para 1,70 m)`}</b></div>
      <div class="m3d-kv"><span>Recursos</span><b>${[info.flags.dedos ? 'dedos' : null, info.flags.expressoes ? 'expressões' : null, info.flags.molas ? 'física (spring bones)' : null].filter(Boolean).join(' · ') || 'só corpo'}</b></div>
      <div class="m3d-sub">Captura de dedos e rosto (na cadeia, antes da captura)</div>
      <label class="m3d-check"><input type="checkbox" checked=${cadeia.maos} onChange=${(e) => onCadeia('maos', e.target.checked)} /> Dedos: Mãos e gestos (MediaPipe Hands, 21 pontos por mão)</label>
      <label class="m3d-check"><input type="checkbox" checked=${cadeia.rosto} onChange=${(e) => onCadeia('rosto', e.target.checked)} /> Rosto: Malha do rosto (478 pontos → piscar, boca, sorriso, olhar, cabeça)</label>
      <p class="m3d-dica">Cada modelo a mais divide a taxa de quadros (fila única do ORT). Sem eles, o avatar anima o corpo e a mão inteira pelos pontos da pose.</p>
      <div class="m3d-sub">Mapeamento ossos × juntas ${falta.length ? html`<em class="m3d-alerta">faltam: ${falta.map(rotuloOsso).join(', ')}</em>` : html`<em>completo (${Object.keys(mapa).length} ossos)</em>`}</div>
      <div class="m3d-linha">
        <button class="m3d-btn mini" onClick=${onAuto}>Automático</button>
        <button class="m3d-btn mini" onClick=${onSalvar}>Salvar mapa</button>
        <button class=${`m3d-btn mini ${repouso ? 'on' : ''}`} aria-pressed=${repouso} onClick=${() => onRepouso(!repouso)}>Ver repouso</button>
        <button class="m3d-btn mini" onClick=${onConferir}>Conferir ângulos</button>
        <label class="m3d-check mini"><input type="checkbox" checked=${verDedos} onChange=${(e) => setVerDedos(e.target.checked)} /> dedos</label>
        <input class="m3d-busca" type="search" placeholder="Buscar osso…" value=${busca} onInput=${(e) => setBusca(e.target.value)} aria-label="Buscar osso" />
      </div>
      ${conferencia && html`<div class="m3d-conf">
        <p class="m3d-dica">Direção dos ossos do avatar × captura: pior ${conferencia.maxErro == null ? '—' : conferencia.maxErro.toFixed(1) + '°'} (${conferencia.direcoes.length} ossos).</p>
        <table><thead><tr><th>Junta</th><th>Avatar</th><th>Captura</th></tr></thead><tbody>
          ${conferencia.angulos.map((a) => html`<tr key=${a.junta}><td>${a.junta}</td><td class="num">${a.avatar}°</td><td class="num">${a.captura}°</td></tr>`)}
        </tbody></table></div>`}
      <div class="m3d-mapa" role="table" aria-label="Mapeamento de ossos">
        ${linhas.map((l) => html`<div key=${l.humano} class=${`m3d-mapa-l ${l.osso ? '' : 'vazio'}`} role="row">
          <span role="cell" title=${l.humano}>${rotuloOsso(l.humano)}</span>
          <select role="cell" value=${l.osso} aria-label=${`Osso do modelo para ${rotuloOsso(l.humano)}`} onChange=${(e) => { const m = { ...mapa }; if (e.target.value) m[l.humano] = e.target.value; else delete m[l.humano]; onMapa(m); }}>
            ${opcoes.map((o) => html`<option key=${o} value=${o}>${o || '— nenhum —'}</option>`)}
          </select>
          <small role="cell">${origem[l.humano] ? { vrm: 'VRM', mixamo: 'Mixamo', exato: 'nome', heuristica: 'heurística', manual: 'manual' }[origem[l.humano]] || origem[l.humano] : ''}</small>
        </div>`)}
      </div>
    </div>`;
}

export default PainelAvatar;
