/**
 * components/motion3d/api.js — API PEQUENA E ESTÁVEL do Motion 3D Studio (CV-88) para outras
 * partes do iaVision (a Via, outros módulos). Não depende do Studio estar aberto para ler e
 * criar tomadas; para aplicar uma tomada ao avatar e ler o estado ao vivo, o Studio precisa
 * estar aberto (ele se registra aqui ao montar e sai ao desmontar).
 *
 *   import { motion3dAPI } from './components/motion3d/api.js';
 *
 *   motion3dAPI.versao                                 → 1
 *   motion3dAPI.aberto()                               → boolean (Studio montado)
 *   await motion3dAPI.criarTomada(trilha, opc?)        → { id, nome, quadros, fps }
 *        trilha: Array de quadros, cada quadro 33 × [x, y, z] (ou null) em METROS, convenção do
 *        MoCap do GPlanSiS|ROBO: y para cima, +x = esquerda da pessoa, +z = frente; índices do
 *        BlazePose/MediaPipe Pose (0 nariz, 11/12 ombros, 23/24 quadris…).
 *        opc: { nome, fps (30), origem ('sintetico' | 'monocular' | …), fonteId, salvar (true),
 *               abrir (true: com o Studio aberto, carrega e toca) }
 *   await motion3dAPI.listarTomadas()                  → [{ id, nome, quadros, fps, origem, criado }]
 *   await motion3dAPI.lerTomada(id)                    → { id, nome, fps, trilha, ... } | null
 *   await motion3dAPI.aplicarTomada(id, opc?)          → { ok, nome, quadros } (Studio aberto:
 *        carrega a tomada, que anima o avatar/modelo escolhido; opc: { tocar: true })
 *   motion3dAPI.estado()                               → { aberto, vista, ao_vivo, tomada,
 *        avatar: { nome, tipo } | null, gravando, tomadas: n } (null se fechado)
 * Erros sobem como Error com mensagem em português. Tudo fica neste navegador (IndexedDB).
 */
import * as armazem from '../../cv/runtime/livres-v/armazem.js';
import { novoId } from '../../cv/runtime/livres-v/tomada.js';

let impl = null;
/** O Studio chama ao montar; devolve a função de saída. */
export function registrarStudio(i) { impl = i; return () => { if (impl === i) impl = null; }; }

function validarTrilha(trilha) {
  if (!Array.isArray(trilha) || trilha.length < 2) throw new Error('A trilha precisa de pelo menos 2 quadros.');
  return trilha.map((q, i) => {
    if (!Array.isArray(q) || q.length !== 33) throw new Error(`Quadro ${i}: precisa de 33 pontos.`);
    return q.map((p) => (Array.isArray(p) && p.length === 3 && p.every(Number.isFinite) ? [+p[0], +p[1], +p[2]] : null));
  });
}

export const motion3dAPI = {
  versao: 1,
  aberto: () => Boolean(impl),
  async criarTomada(trilha, opc = {}) {
    const tr = validarTrilha(trilha);
    const fps = Math.max(1, Math.min(240, Math.round(opc.fps || 30)));
    const base = { id: novoId('tk'), fps, trilha: tr, origem: opc.origem || 'sintetico', fonteId: opc.fonteId || 'api', cameras: [] };
    if (impl) return impl.criarTomada(base, opc);
    const t = { ...base, nome: String(opc.nome || `A_API_${Date.now().toString(36)}`).slice(0, 60), pasta: 'Mocap', criado: new Date().toISOString(), corte: { ini: 0, fim: tr.length - 1 } };
    if (opc.salvar !== false) await armazem.salvar(t);
    return { id: t.id, nome: t.nome, quadros: tr.length, fps };
  },
  async listarTomadas() {
    if (impl) return impl.listarTomadas();
    return (await armazem.listar()).map(({ id, nome, quadros, fps, origem, criado }) => ({ id, nome, quadros, fps, origem, criado }));
  },
  async lerTomada(id) { if (impl) return impl.lerTomada(id); return armazem.ler(id); },
  async aplicarTomada(id, opc = {}) {
    if (!impl) throw new Error('Abra o Motion 3D Studio para aplicar uma tomada ao avatar.');
    return impl.aplicarTomada(id, opc);
  },
  estado() { return impl ? impl.estado() : null; },
};

export default motion3dAPI;
