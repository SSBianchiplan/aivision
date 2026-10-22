/**
 * components/AuthPanel.js — sessão, biometria e contas.
 *
 * Tudo aqui é ESPELHO do servidor. Este painel não decide nada: mostra o que
 * /api/me respondeu, e as ações que oferece são chamadas à API, que confere
 * escopo em PHP antes de executar.
 *
 * ============ A GESTÃO DE CONTAS PASSOU A SER AQUI ============
 *
 * Antes este painel só listava um espelho e mandava o administrador para
 * gplansis.com › Permissões. Agora papel, senha e acesso são gravados no
 * banco do iaVision.
 *
 * A troca não foi de gosto: com a regra de permissão escrita nos DOIS
 * sistemas, a mesma pergunta — «fulano pode entrar?» — tinha duas
 * implementações que podiam responder diferente. A base de PESSOAS continua
 * a mesma (o cadastro veio importado do ONDA); o que mudou é que existe um
 * lugar só onde a resposta é decidida e auditada.
 * ==============================================================
 */

import { html, useState, useEffect, useCallback } from '../vendor.js';
import { Panel } from './Panel.js';
import { store } from '../state/store.js';
import * as api from '../auth/api.js';
import { captureSamples } from '../auth/face.js';

/*
 * Os papéis do iaVision. NÃO são os do ONDA (admin_master, aluno, convidado,
 * free) — e a separação é deliberada: traduzir um no outro implicitamente
 * era metade do problema que esta reescrita veio resolver.
 *
 * A fonte da verdade é `Auth::escoposDe()` no servidor. Este objeto só
 * traduz o identificador em rótulo para a tela; se divergir, o pior que
 * acontece é um nome feio, nunca uma permissão errada.
 */
const PAPEIS = {
  admin: 'Administrador',
  operador: 'Operador',
  analista: 'Analista',
  leitor: 'Leitor',
};

export function AuthPanel({ onClose, getFrame, session, ...layout }) {
  const [tab, setTab] = useState('sessao');
  const [msg, setMsg] = useState(null);

  const isAdmin = (session.scopes || []).includes('identity:manage');

  return html`
    <${Panel} id="auth" title="Acesso" subtitle=${session.user.nome}
              onClose=${onClose} ...${layout}>

      <div class="tabs">
        <button class=${tab === 'sessao' ? 'on' : ''} onClick=${() => setTab('sessao')}>Sessão</button>
        <button class=${tab === 'rosto' ? 'on' : ''} onClick=${() => setTab('rosto')}>Rosto</button>
        <button class=${tab === 'usuarios' ? 'on' : ''} onClick=${() => setTab('usuarios')}
                disabled=${!isAdmin}>Contas</button>
      </div>

      ${msg && html`<div class=${msg.kind === 'err' ? 'mdl-err' : 'notice'}>${msg.text}</div>`}

      ${tab === 'sessao' && html`<${SessionView} session=${session} />`}
      ${tab === 'rosto' && html`<${FaceView} getFrame=${getFrame} setMsg=${setMsg} session=${session} />`}
      ${tab === 'usuarios' && isAdmin && html`<${UsersView} setMsg=${setMsg} />`}
    <//>
  `;
}

// =============================================================== sessão

function SessionView({ session }) {
  const [left, setLeft] = useState(() => session.expires_at - Math.floor(Date.now() / 1000));

  useEffect(() => {
    const t = setInterval(
      () => setLeft(session.expires_at - Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, [session.expires_at]);

  const h = Math.max(0, Math.floor(left / 3600));
  const m = Math.max(0, Math.floor((left % 3600) / 60));

  return html`
    <div class="sess">
      <div class="sess-who">
        <b>${session.user.nome}</b>
        <span class="badge ${session.user.papel}">${PAPEIS[session.user.papel] || session.user.papel}</span>
      </div>
      <div class="sess-meta">
        ${session.user.email}<br />
        expira em <b class=${left < 600 ? 'warn' : ''}>${h}h ${m}min</b> ·
        fatores: ${(session.amr || []).join(' + ')}
      </div>
    </div>

    <div class="notice" style=${{ marginTop: '12px' }}>
      Sessão emitida e conferida <b>no servidor</b>. O cookie é <code>httpOnly</code> — o JavaScript desta página não consegue lê-lo,
      então um XSS não a rouba.
    </div>

    <div class="sep"></div>
    <p class="hint tight">Escopos concedidos pelo seu papel no iaVision:</p>
    <div class="scopes mini">
      ${(session.scopes || []).map((sc) => html`<code key=${sc}>${sc}</code>`)}
    </div>

    <div class="sep"></div>
    <${TrocarSenha} />
  `;
}

// =============================================================== senha

/**
 * Troca da própria senha.
 *
 * Fica na aba Sessão, e não em Contas, porque qualquer papel pode trocar a
 * sua — inclusive quem recebeu uma senha inicial de um administrador e não
 * deveria continuar com ela.
 */
function TrocarSenha() {
  const [aberto, setAberto] = useState(false);
  const [atual, setAtual] = useState('');
  const [nova, setNova] = useState('');
  const [conf, setConf] = useState('');
  const [aviso, setAviso] = useState(null);
  const [indo, setIndo] = useState(false);

  if (!aberto) {
    return html`
      <button class="btn" onClick=${() => setAberto(true)}>Trocar minha senha</button>
    `;
  }

  const enviar = async (e) => {
    e.preventDefault();
    if (indo) return;
    if (nova !== conf) {
      setAviso({ kind: 'err', text: 'A confirmação não bate com a senha nova.' });
      return;
    }
    setIndo(true);
    setAviso(null);
    try {
      await api.trocarSenha(atual, nova);
      setAviso({ kind: 'ok', text: 'Senha trocada. As sessões nos outros aparelhos caíram.' });
      setAtual(''); setNova(''); setConf('');
    } catch (err) {
      setAviso({ kind: 'err', text: err.message });
    } finally {
      setIndo(false);
    }
  };

  return html`
    <form onSubmit=${enviar}>
      <p class="hint tight">
        A senha do iaVision é separada da do gplansis.com — trocar aqui não
        mexe lá.
      </p>
      ${aviso && html`<div class=${aviso.kind === 'err' ? 'mdl-err' : 'notice'}>${aviso.text}</div>`}
      <label class="chal-in">
        <span>Senha atual</span>
        <input class="txt" type="password" value=${atual}
               onInput=${(e) => setAtual(e.target.value)}
               autocomplete="current-password" required />
      </label>
      <label class="chal-in">
        <span>Senha nova</span>
        <input class="txt" type="password" value=${nova}
               onInput=${(e) => setNova(e.target.value)}
               autocomplete="new-password" required />
      </label>
      <label class="chal-in">
        <span>Repita a senha nova</span>
        <input class="txt" type="password" value=${conf}
               onInput=${(e) => setConf(e.target.value)}
               autocomplete="new-password" required />
      </label>
      <div class="row" style=${{ marginTop: '10px' }}>
        <button class="btn accent" type="submit" disabled=${indo}>
          ${indo ? 'Trocando…' : 'Trocar senha'}
        </button>
        <button class="btn" type="button" onClick=${() => setAberto(false)}>Cancelar</button>
      </div>
    </form>
  `;
}

// =============================================================== rosto

function FaceView({ getFrame, setMsg, session }) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null);
  const [consent, setConsent] = useState(false);
  const [retention, setRetention] = useState(180);
  const [last, setLast] = useState(null);

  const canEnroll = (session.scopes || []).includes('identity:enroll');

  const enroll = useCallback(async () => {
    if (!consent) return setMsg({ kind: 'err', text: 'O consentimento é obrigatório.' });
    setBusy(true);
    setMsg(null);
    try {
      if (!store.get().cameraOn) throw new Error('Ligue a câmera antes.');
      setProgress({ done: 0, total: 5, captured: 0 });
      const { vectors } = await captureSamples(getFrame, {
        count: 5, intervalMs: 500, onProgress: setProgress,
      });
      const r = await api.enrollFace(vectors, { consent: true, retentionDays: retention });
      setMsg({ kind: 'ok', text: `${r.samples} amostra(s) enviadas ao servidor.` });
    } catch (err) {
      setMsg({ kind: 'err', text: err.message });
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }, [consent, retention, getFrame, setMsg]);

  const verify = useCallback(async () => {
    setBusy(true);
    setMsg(null);
    try {
      if (!store.get().cameraOn) throw new Error('Ligue a câmera antes.');
      const { embedLargestFace } = await import('../cv/runtime/face.js');
      const frame = getFrame();
      if (!frame) throw new Error('Sem imagem da câmera.');
      const r = await embedLargestFace(frame, { conf: 0.8 });
      if (!r) throw new Error('Nenhuma face detectada.');
      const res = await api.identifyFace(r.vector);
      setLast(res);
    } catch (err) {
      setMsg({ kind: 'err', text: err.message });
    } finally {
      setBusy(false);
    }
  }, [getFrame, setMsg]);

  return html`
    <div class="warn-box">
      <b>⚠ Biometria não substitui a senha.</b> Rosto capturado por webcam RGB cai para uma foto. Aqui ele serve para <b>reconferir</b> quem já está logado — nunca para entrar. A porta é o
      login do GPlanSiS.
    </div>

    <p class="hint">
      A imagem <b>não</b> é guardada: sai daqui apenas o vetor de 128 dimensões,
      que fica no servidor e é comparado lá. O navegador nunca recebe de volta
      o template de ninguém.
    </p>

    ${!canEnroll && html`
      <div class="notice">Seu papel não tem o escopo <code>identity:enroll</code>.</div>`}

    ${canEnroll && html`
      <label class="ctl">
        <span class="ctl-label">Retenção<b>${retention} dias</b></span>
        <input type="range" min="7" max="365" step="7" value=${retention}
               onInput=${(e) => setRetention(parseInt(e.target.value, 10))} />
      </label>
      <p class="hint tight">No vencimento o servidor apaga o vetor sozinho.</p>

      <label class="consent">
        <input type="checkbox" checked=${consent}
               onChange=${(e) => setConsent(e.target.checked)} />
        <span>
          Autorizo a coleta do embedding facial (não a imagem) para
          reconferência de acesso. Posso eliminá-lo a qualquer momento.
        </span>
      </label>

      ${progress && html`
        <div class="cap">
          <div class="mdl-bar"><i style=${{ width: (progress.done / progress.total * 100) + '%' }}></i></div>
          <span>amostra ${progress.done}/${progress.total} · ${progress.captured} válida(s)</span>
        </div>
      `}

      <div class="row">
        <button class="btn accent" disabled=${busy || !consent} onClick=${enroll}>
          ${busy ? 'Capturando…' : 'Cadastrar rosto'}
        </button>
        <button class="btn" disabled=${busy} onClick=${verify}>Conferir</button>
      </div>

      ${last && html`
        <div class=${last.match ? 'notice' : 'mdl-err'} style=${{ marginTop: '10px' }}>
          ${last.match ? '✓ Rosto confere' : '✕ Não confere'} ·
          similaridade ${last.score} (mínimo ${last.threshold})
        </div>
      `}

      <div class="sep"></div>
      <button class="btn danger" onClick=${async () => {
        try {
          await api.purgeFace();
          setMsg({ kind: 'ok', text: 'Biometria eliminada do servidor.' });
          setLast(null);
        } catch (err) { setMsg({ kind: 'err', text: err.message }); }
      }}>Eliminar minha biometria</button>
    `}
  `;
}

// =============================================================== contas

/**
 * Gestão de contas.
 *
 * O que este painel pode fazer e o gplansis.com não faria por ele: definir a
 * senha DO iaVision, o papel DO iaVision e ligar/desligar o acesso — as três
 * coisas que agora vivem só neste banco.
 *
 * A senha gerada aparece UMA vez. O que fica gravado é o hash Argon2id, e
 * não existe caminho de volta: perdeu, gera outra. É desconfortável de
 * propósito — o contrário significaria guardar senha recuperável.
 */
function UsersView({ setMsg }) {
  const [data, setData] = useState(null);
  const [edit, setEdit] = useState(null);       // conta em edição, ou 'nova'
  const [senhaNova, setSenhaNova] = useState(null);

  const recarregar = useCallback(() => {
    api.listUsers()
      .then(setData)
      .catch((e) => setMsg({ kind: 'err', text: e.message }));
  }, [setMsg]);

  useEffect(recarregar, [recarregar]);

  if (!data) return html`<p class="hint">Carregando…</p>`;

  const gerarSenha = async (u, avisar) => {
    setMsg(null);
    try {
      const r = await api.resetSenha(u.id, avisar);
      setSenhaNova({ email: r.email, senha: r.senha, aviso: r.aviso_email });
      recarregar();
    } catch (e) {
      setMsg({ kind: 'err', text: e.message });
    }
  };

  return html`
    ${senhaNova && html`
      <div class="senha-box">
        <div class="senha-t">Senha nova de <b>${senhaNova.email}</b></div>
        <code class="senha-v">${senhaNova.senha}</code>
        <div class="row">
          <button class="btn tiny" onClick=${() => {
            navigator.clipboard.writeText(senhaNova.senha).catch(() => {});
          }}>copiar</button>
          <button class="btn tiny" onClick=${() => setSenhaNova(null)}>fechar</button>
        </div>
        ${senhaNova.aviso && html`
          <p class=${senhaNova.aviso.enviado ? 'hint tight' : 'gate-err'}>
            ${senhaNova.aviso.enviado
              ? '\u2713 Enviada por e-mail para ' + senhaNova.email + '.'
              : '\u2715 Não consegui enviar o e-mail: ' + senhaNova.aviso.mensagem
                + ' A senha acima continua valendo — entregue por outro canal.'}
          </p>
        `}
        <p class="hint tight">
          Anote agora: o servidor guarda só o hash e esta senha não aparece de
          novo. Se o e-mail não sair, entregue por um canal que você escolha e
          peça a troca no primeiro acesso.
        </p>
      </div>
    `}

    ${edit
      ? html`<${ContaForm} conta=${edit} papeis=${data.papeis}
                onPronto=${() => { setEdit(null); recarregar(); }}
                onCancelar=${() => setEdit(null)}
                setMsg=${setMsg} />`
      : html`
        <p class="hint">
          Contas do <b>iaVision</b>. A base de pessoas veio do gplansis.com,
          mas senha, papel e acesso são definidos aqui.
        </p>
        <button class="btn accent" onClick=${() => setEdit('nova')}>+ Nova conta</button>
        <div class="sep"></div>

        ${data.users.length === 0
          ? html`<p class="empty">Nenhuma conta ainda.</p>`
          : data.users.map((u) => html`
              <div key=${u.id} class="ident ${u.ativo ? '' : 'off'}">
                <div class="ident-head">
                  <b>${u.nome}</b>
                  <span class="badge ${u.papel_iav}">${PAPEIS[u.papel_iav] || u.papel_iav}</span>
                </div>
                <div class="ident-meta">
                  ${u.email}<br />
                  ${u.ativo ? 'acesso liberado' : 'SEM acesso'}
                  ${u.tem_senha ? ' · com senha' : ' · SEM SENHA definida'}
                  ${u.travado ? ' · TRAVADA por tentativas' : ''}
                  ${u.faces > 0 ? ` · ${u.faces} amostra(s) facial(is)` : ''}
                  ${u.last_login_at
                    ? html`<br />último acesso ${new Date(u.last_login_at * 1000).toLocaleString('pt-BR')}`
                    : html`<br />nunca entrou`}
                  <br /><span class="ident-n">${u.origem}</span>
                </div>
                <div class="row" style=${{ marginTop: '8px' }}>
                  <button class="btn tiny" onClick=${() => setEdit(u)}>editar</button>
                  <button class="btn tiny" onClick=${() => gerarSenha(u, true)}
                          title="Gera uma senha nova e envia por e-mail">
                    gerar e enviar
                  </button>
                  <button class="btn tiny" onClick=${() => gerarSenha(u, false)}
                          title="Gera uma senha nova e mostra só na tela">
                    gerar sem e-mail
                  </button>
                </div>
              </div>
            `)}
      `}
  `;
}

/** Formulário de conta. `conta` é 'nova' ou o objeto vindo da listagem. */
function ContaForm({ conta, papeis, onPronto, onCancelar, setMsg }) {
  const nova = conta === 'nova';
  const [email, setEmail] = useState(nova ? '' : conta.email);
  const [nome, setNome] = useState(nova ? '' : conta.nome);
  const [papel, setPapel] = useState(nova ? 'leitor' : conta.papel_iav);
  const [ativo, setAtivo] = useState(nova ? true : Boolean(conta.ativo));
  const [senha, setSenha] = useState('');
  const [avisar, setAvisar] = useState(true);
  const [indo, setIndo] = useState(false);

  /*
   * A sugestão vem do SERVIDOR, com `random_int`. Sortear aqui usaria
   * `Math.random()`, que não é criptográfico — e uma senha previsível saída
   * de um gerador é pior que uma fraca escolhida à mão, porque parece segura.
   */
  const sugerir = async () => {
    try {
      const r = await api.sugerirSenha();
      setSenha(r.senha);
    } catch (err) {
      setMsg({ kind: 'err', text: err.message });
    }
  };

  const enviar = async (e) => {
    e.preventDefault();
    if (indo) return;
    setIndo(true);
    setMsg(null);
    try {
      const r = await api.saveUser({
        id: nova ? undefined : conta.id,
        email, nome, papel, ativo,
        senha: senha || undefined,
        avisar: Boolean(senha) && avisar,
      });
      const base = nova ? 'Conta criada.' : 'Conta atualizada.';
      const mail = r.email
        ? (r.email.enviado
            ? ' Senha enviada por e-mail.'
            : ' Mas o e-mail NÃO saiu: ' + r.email.mensagem)
        : '';
      setMsg({ kind: r.email && !r.email.enviado ? 'err' : 'ok', text: base + mail });
      onPronto();
    } catch (err) {
      setMsg({ kind: 'err', text: err.message });
    } finally {
      setIndo(false);
    }
  };

  const desc = (papeis || []).find((p) => p.id === papel);

  return html`
    <form onSubmit=${enviar}>
      <p class="hint tight">${nova ? 'Nova conta do iaVision' : 'Editando ' + conta.email}</p>

      <label class="chal-in">
        <span>Nome</span>
        <input class="txt" value=${nome} onInput=${(e) => setNome(e.target.value)} required />
      </label>
      <label class="chal-in">
        <span>E-mail</span>
        <input class="txt" type="email" value=${email}
               onInput=${(e) => setEmail(e.target.value)}
               autocapitalize="off" autocorrect="off" spellcheck="false" required />
      </label>
      <label class="chal-in">
        <span>Papel</span>
        <select class="txt" value=${papel} onChange=${(e) => setPapel(e.target.value)}>
          ${(papeis || []).map((p) => html`
            <option key=${p.id} value=${p.id}>${p.rotulo}</option>`)}
        </select>
      </label>
      ${desc && html`<p class="hint tight">${desc.resumo}</p>`}

      <label class="ctl ctl-bool" style=${{ marginTop: '10px' }}>
        <input type="checkbox" checked=${ativo} onChange=${(e) => setAtivo(e.target.checked)} />
        <span>Acesso ao iaVision liberado</span>
      </label>

      <label class="chal-in">
        <span>${nova ? 'Senha inicial' : 'Nova senha (deixe vazio para manter)'}</span>
        <input class="txt" type="text" value=${senha}
               onInput=${(e) => setSenha(e.target.value)}
               autocomplete="new-password" spellcheck="false" />
      </label>
      <div class="row" style=${{ marginTop: '6px' }}>
        <button class="btn tiny" type="button" onClick=${sugerir}>gerar senha forte</button>
        ${senha && html`
          <button class="btn tiny" type="button" onClick=${() => {
            navigator.clipboard.writeText(senha).catch(() => {});
          }}>copiar</button>
        `}
      </div>

      ${senha && html`
        <label class="ctl ctl-bool" style=${{ marginTop: '10px' }}>
          <input type="checkbox" checked=${avisar}
                 onChange=${(e) => setAvisar(e.target.checked)} />
          <span>Enviar a senha por e-mail para ${email || 'o usuário'}</span>
        </label>
      `}

      <p class="hint tight">
        Mínimo 10 caracteres, sem palavra óbvia. Uma frase longa vale mais que
        trocar letras por símbolos. Deixando vazio numa conta nova, a pessoa
        fica cadastrada mas sem poder entrar até alguém gerar uma senha.
      </p>

      <div class="row" style=${{ marginTop: '10px' }}>
        <button class="btn accent" type="submit" disabled=${indo}>
          ${indo ? 'Salvando…' : 'Salvar'}
        </button>
        <button class="btn" type="button" onClick=${onCancelar}>Cancelar</button>
      </div>

      ${!nova && html`
        <p class="hint tight">
          Salvar derruba as sessões abertas desta conta — é o que faz uma
          revogação valer agora, e não daqui a oito horas.
        </p>
      `}
    </form>
  `;
}
