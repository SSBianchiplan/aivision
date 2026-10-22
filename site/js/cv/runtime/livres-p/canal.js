/**
 * cv/runtime/livres-p/canal.js — CV-47 Fisio: a sessão do paciente e a ponte
 * entre o operador fisio.avaliar e as telas (painel Fisio e Studio Fisio).
 *
 * A SESSÃO mora aqui (não no estado do nó): trocar de teste no Studio, apagar
 * e recriar o nó ou analisar outro vídeo não joga fora as medidas do paciente.
 * `processar()` é o caminho ÚNICO de uma pose nova — o operador chama a cada
 * inferência e o teste com pose sintética (window.aivFisio.injetar) também.
 *
 * PACIENTE (LGPD): o perfil (nome ou código, idade, sexo, altura, lado
 * acometido, observações) fica SÓ neste navegador ('aiv.fisio.pacientes'),
 * por conta logada (usuarioAtual da Via); nada sai do aparelho. Use um código
 * no lugar do nome quando a imagem ou o relatório forem compartilhados.
 */
import { SessaoFisio, ARTICULACOES, TESTES } from './fisio.js';
import { usuarioAtual, ouvir } from '../../../via/base.js';

const sessao = new SessaoFisio();
const ouvintes = new Set();
let retrato = null, timer = null, ultimo = 0, studio = false, ultimoQuadro = null;

function avisar(ja = false) {
  const disparar = () => { ultimo = performance.now(); for (const f of ouvintes) { try { f(retrato); } catch (_) { /* desmontando */ } } };
  if (ja) { if (timer) { clearTimeout(timer); timer = null; } disparar(); return; }
  if (timer) return;
  timer = setTimeout(() => { timer = null; disparar(); }, Math.max(0, 250 - (performance.now() - ultimo)));
}

/** Configuração do teste a partir dos parâmetros do nó (rótulos → chaves). */
export const OPCOES_TESTE = { 'goniometria (ADM)': 'goniometria', 'TUG': 'tug', 'sentar-levantar 5×': 'sts5', 'sentar-levantar 30 s': 'sts30' };
export const OPCOES_ART = Object.fromEntries(Object.entries(ARTICULACOES).map(([k, a]) => [a.nome, k]));
export const OPCOES_LADO = { 'automático': 'auto', 'esquerdo': 'e', 'direito': 'd' };
export function cfgFisio(p) {
  return {
    teste: OPCOES_TESTE[p.teste] || 'tug', articulacao: OPCOES_ART[p.articulacao] || 'joelho_flexao', lado: OPCOES_LADO[p.lado] || 'auto',
    distanciaM: p.distanciaM || 3, fim: p.fim5 === 'sentar após a 5ª' ? 'sentado' : 'emPe', minVis: p.minVis ?? 0.4,
  };
}

let tAnal = 0, res = null, cfgAtual = null, assin = '';

/**
 * Uma pose nova. t (ms, tempo da fonte), P (33 pontos px do quadro), w×h do
 * quadro, cfg (cfgFisio). Devolve o resultado atual (análise ≤ 4×/s).
 */
export function processar({ t, P, w, h, cfg, img = null, vis = null, forcar = false }) {
  const a = `${cfg.teste}|${cfg.articulacao}|${cfg.lado}|${cfg.fim}`;
  if (a !== assin) { assin = a; if (cfg.teste !== 'goniometria') sessao.descartarTentativa(); res = null; }
  cfgAtual = cfg;
  if (P) sessao.adicionar(t, P, cfg);
  const agora = performance.now();
  if (forcar || !res || agora - tAnal > 250) {
    res = sessao.analisar(cfg); tAnal = agora;
    // teste cronometrado concluído e a pessoa sentada há 1,5 s: arquiva e rearma sozinho
    if (res.estado === 'concluído' && res.tFim != null && t - res.tFim >= 1500) {
      const tent = sessao.arquivar(res, cfg);
      if (tent) { canalFisio.ultimaTentativa = tent; res = sessao.analisar(cfg); }
    }
  }
  if (img) ultimoQuadro = img;
  retrato = { t, P, w, h, cfg, res, vis, tWall: agora };
  avisar();
  return res;
}

export const canalFisio = {
  sessao,
  publicar(r) { retrato = r; avisar(); },
  instantaneo: () => retrato,
  quadro: () => ultimoQuadro,
  assinar(fn) { ouvintes.add(fn); return () => ouvintes.delete(fn); },
  avisarJa() { avisar(true); },
  cfg: () => cfgAtual,
  definirStudio(v) { studio = Boolean(v); },
  studioAberto: () => studio,
  recente: (ms = 3000) => Boolean(retrato) && performance.now() - retrato.tWall < ms,
  ultimaTentativa: null,
  /** Nova sessão: some tudo do paciente atual (medidas, tentativas, séries). */
  zerar() { sessao.zerar(); res = null; canalFisio.ultimaTentativa = null; retrato = retrato ? { ...retrato, res: null, P: null } : null; avisar(true); },
  /** Descarta a tentativa em curso (o teste começou errado). */
  descartar() { sessao.descartarTentativa(); res = null; avisar(true); },
  /** Goniometria: registra a medida (mín/máx da série atual). */
  registrar() {
    if (!res || res.teste !== 'goniometria') return null;
    const m = sessao.registrarMedida(res, { paciente: pacienteAtivo() ? pacienteAtivo().id : null });
    res = cfgAtual ? sessao.analisar(cfgAtual) : null;
    avisar(true);
    return m;
  },
  TESTES,
};

// ===================================================================== pacientes

const chave = () => `aiv.fisio.pacientes:${usuarioAtual() || 'anon'}`;
let pac = null;
const ouvPac = new Set();
let versaoPac = 0;

function lerPac() {
  if (pac && pac.dono === chave()) return pac;
  let o = null;
  try { o = JSON.parse(localStorage.getItem(chave()) || 'null'); } catch (_) { o = null; }
  pac = { dono: chave(), lista: Array.isArray(o && o.lista) ? o.lista : [], ativo: o && o.ativo };
  return pac;
}
function gravarPac() {
  try { localStorage.setItem(chave(), JSON.stringify({ lista: pac.lista, ativo: pac.ativo })); } catch (_) { /* sem espaço */ }
  versaoPac++;
  for (const f of ouvPac) { try { f(versaoPac); } catch (_) { /* segue */ } }
}
ouvir(() => { pac = null; versaoPac++; for (const f of ouvPac) { try { f(versaoPac); } catch (_) { /* segue */ } } });

export const PACIENTE_VAZIO = { id: '', nome: '', idade: null, sexo: '', alturaCm: null, ladoAcometido: '', diagnostico: '', observacoes: '' };
export function listaPacientes() { return lerPac().lista; }
export function pacienteAtivo() { const p = lerPac(); return p.lista.find((x) => x.id === p.ativo) || null; }
export function novoPaciente(dados = {}) {
  const p = lerPac();
  const x = { ...PACIENTE_VAZIO, ...dados, id: 'pc' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), criado: new Date().toISOString() };
  if (!x.nome) x.nome = `Paciente ${p.lista.length + 1}`;
  p.lista.push(x); p.ativo = x.id; gravarPac();
  return x;
}
export function atualizarPaciente(patch) {
  const p = lerPac();
  let x = pacienteAtivo();
  if (!x) x = novoPaciente();
  Object.assign(x, patch);
  gravarPac();
  return x;
}
export function trocarPaciente(id) { const p = lerPac(); p.ativo = id; gravarPac(); }
export function removerPaciente(id) { const p = lerPac(); p.lista = p.lista.filter((x) => x.id !== id); if (p.ativo === id) p.ativo = p.lista[0] ? p.lista[0].id : null; gravarPac(); }
export function assinarPaciente(fn) { ouvPac.add(fn); return () => ouvPac.delete(fn); }
export function versaoPaciente() { return versaoPac; }
