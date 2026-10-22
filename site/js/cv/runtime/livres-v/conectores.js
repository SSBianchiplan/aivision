/**
 * cv/runtime/livres-v/conectores.js — CV-88: os motores de SERVIDOR (GVHMR, ExMR, FlowHMR)
 * pelo serviço aivision-motion (contrato contracts/openapi.yaml da especificação MotionAI:
 * /api/v1/motion/*, mesma origem, cookie de sessão do iaVision).
 *
 * Estado HONESTO de cada motor, vindo de /capabilities: disponível · não instalado · licença
 * pendente · não verificado · servidor fora do ar. Nenhum resultado é simulado: pedir um motor
 * ausente devolve 501 e o Studio mostra isso. Enviar vídeo exige CONSENTIMENTO explícito
 * (04-SEGURANCA-LGPD-OPERACAO.md): só com ele o pedido sai, e a tela passa de ON-DEVICE para
 * GPU REMOTA enquanto houver envio.
 */
const BASE = '/api/v1/motion';

export const MOTORES = {
  gvhmr: { nome: 'GVHMR', papel: 'Corpo 3D e trajetória global a partir de vídeo de uma câmera (processamento de vídeo, não tempo real).',
    repo: 'https://github.com/zju3dv/GVHMR', licenca: 'Código: licença do repositório (verifique a versão instalada). Usa modelos SMPL/SMPL-X: licença NÃO comercial do MPI (cadastro obrigatório).' },
  exmr: { nome: 'ExMR', papel: 'Refinamento das extremidades: mãos, dedos, braços e pés.',
    repo: null, licenca: 'Repositório, versão e licença NÃO verificados (a sigla não tem fonte confirmada na especificação). Fica desligado até identificar.' },
  flowhmr: { nome: 'FlowHMR', papel: 'Movimento fisicamente plausível: animação mais natural e estável.',
    repo: 'https://github.com/flowhmr/flowhmr', licenca: 'Ativos com acesso restrito (pesos e modelos de corpo sob cadastro); uso de pesquisa / não comercial.' },
};

export const ROTULO_ESTADO = {
  disponivel: 'disponível', nao_instalado: 'não instalado', licenca_pendente: 'licença pendente', nao_verificado: 'não verificado',
  offline: 'servidor fora do ar', sem_login: 'entre no iaVision', verificando: 'verificando…',
};

async function pedir(caminho, opc = {}) {
  const r = await fetch(BASE + caminho, { credentials: 'same-origin', headers: { Accept: 'application/json', ...(opc.body ? { 'Content-Type': 'application/json' } : {}) }, ...opc });
  let corpo = null;
  try { corpo = await r.json(); } catch (_) { corpo = null; }
  return { status: r.status, ok: r.ok, corpo };
}

/** { motores: { gvhmr: { estado, detalhe } … }, servidor: 'ok' | 'offline' | 'sem_login' } */
export async function capacidades() {
  try {
    const r = await pedir('/capabilities');
    if (r.status === 401) return { servidor: 'sem_login', motores: Object.fromEntries(Object.keys(MOTORES).map((k) => [k, { estado: 'sem_login' }])) };
    if (!r.ok || !r.corpo || typeof r.corpo !== 'object' || !r.corpo.engines) throw new Error('resposta inesperada');
    const motores = {};
    for (const k of Object.keys(MOTORES)) {
      const e = r.corpo.engines[k] || {};
      motores[k] = { estado: ['disponivel', 'nao_instalado', 'licenca_pendente', 'nao_verificado'].includes(e.status) ? e.status : 'nao_instalado', detalhe: e.detail || '', versao: e.version || null };
    }
    return { servidor: 'ok', motores, limites: r.corpo.limits || null, versao: r.corpo.version || null };
  } catch (_) {
    return { servidor: 'offline', motores: Object.fromEntries(Object.keys(MOTORES).map((k) => [k, { estado: 'offline' }])) };
  }
}

/**
 * Pede um job (vídeo já enviado como artefato). Sem consentimento NÃO envia nada. Devolve o
 * job (202) ou { erro, status } — 501 = motor não instalado (honesto, sem artefato falso).
 */
export async function pedirJob({ motor, sessionId, artefatoId, consentimento, saidas = ['skeleton', 'trajectory'] }) {
  if (!consentimento) return { erro: 'Sem consentimento: nada foi enviado.', status: 0 };
  const r = await pedir('/jobs', { method: 'POST', body: JSON.stringify({ session_id: sessionId, engine: motor, input_artifact_id: artefatoId || 'nenhum',
    consent_reference: consentimento, idempotency_key: `${sessionId}:${motor}:${artefatoId || ''}`, requested_output: saidas }) });
  if (r.status === 202) return { job: r.corpo };
  return { erro: (r.corpo && (r.corpo.detail || r.corpo.erro)) || `HTTP ${r.status}`, status: r.status };
}

/**
 * Envia o vídeo (multipart) — só com consentimento e só se o motor estiver disponível.
 * O servidor recusa com 501 antes de ler o corpo quando nenhum motor está instalado.
 */
export async function enviarVideo(arquivo, { consentimento, motor }) {
  if (!consentimento) return { erro: 'Sem consentimento: nada foi enviado.', status: 0 };
  const fd = new FormData();
  fd.append('video', arquivo, arquivo.name || 'video.mp4');
  const r = await fetch(`${BASE}/uploads?engine=${encodeURIComponent(motor)}`, { method: 'POST', body: fd, credentials: 'same-origin', headers: { 'X-Motion-Consent': consentimento } });
  let corpo = null;
  try { corpo = await r.json(); } catch (_) { corpo = null; }
  if (r.status === 201) return { artefato: corpo };
  return { erro: (corpo && corpo.detail) || `HTTP ${r.status}`, status: r.status };
}

export async function lerJob(id) { const r = await pedir(`/jobs/${encodeURIComponent(id)}`); return r.ok ? r.corpo : { erro: (r.corpo && r.corpo.detail) || `HTTP ${r.status}`, status: r.status }; }
export async function cancelarJob(id) { const r = await pedir(`/jobs/${encodeURIComponent(id)}/cancel`, { method: 'POST' }); return r.ok ? r.corpo : { erro: (r.corpo && r.corpo.detail) || `HTTP ${r.status}`, status: r.status }; }
