/**
 * components/AccessGate.js — tela de acesso.
 *
 * Design do mockup gplansis-iavision-acesso.html — moldura HUD, vinheta,
 * varredura e telemetria — sobre a câmera real.
 *
 * ===================== DUAS ETAPAS, SEMPRE NESTA ORDEM =====================
 *
 *   1. DESAFIO   uma imagem com um código, gerada e conferida no servidor.
 *   2. SENHA     e-mail e senha DESTE sistema.
 *
 * O desafio vem primeiro de propósito: enquanto ele não passa, o servidor
 * nem chega a consultar a conta. Isso tira valor de credential stuffing —
 * cada tentativa custa um desafio novo, de uso único, com teto por IP.
 *
 * ===================== O LOGIN NÃO É MAIS O DO GPLANSIS =====================
 *
 * O botão «Entrar com GPlanSiS» saiu. A BASE DE PESSOAS continua a mesma —
 * o cadastro foi importado do ONDA —, mas a senha é daqui e a permissão é
 * daqui. Ter a mesma regra de permissão escrita nos dois sistemas produzia
 * respostas diferentes para a mesma pergunta, que era a origem das
 * divergências relatadas.
 *
 * ===================== QUEM JÁ ESTÁ LOGADO TAMBÉM PASSA =====================
 *
 * Sessão viva e papel válido NÃO bastam: a fase `desafio-sessao` existe para
 * quem tem cookie e permissão e mesmo assim precisa confirmar presença antes
 * de o sistema abrir. O servidor recusa qualquer rota de dados enquanto isso
 * não acontece — a trava é lá, não aqui.
 * ===========================================================================
 */

import { html, useState, useEffect, useRef } from '../vendor.js';
import { useStore, store } from '../state/store.js';
import {
  me, login, challenge, verifyChallenge,
  esqueciSenha, checarToken, redefinirSenha, sugerirSenha,
} from '../auth/api.js';

export function AccessGate({ onAuthenticated }) {
  const s = useStore(store, (st) => ({
    fps: st.fps,
    cameraOn: st.cameraOn,
    metrics: st.metrics,
  }));

  // checando | login | esqueci | enviado | redefinir | trocada | link-morto
  //          | desafio-sessao | offline
  const [fase, setFase] = useState('checando');
  const [erro, setErro] = useState(null);
  const [ocupado, setOcupado] = useState(false);

  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [resposta, setResposta] = useState('');
  const [desafio, setDesafio] = useState(null);

  const respRef = useRef(null);

  // redefinição pelo link do e-mail
  const [token] = useState(() => {
    try { return new URLSearchParams(location.search).get('t') || ''; }
    catch (_) { return ''; }
  });
  const [nova, setNova] = useState('');
  const [conf, setConf] = useState('');
  const [dono, setDono] = useState(null);
  const [aviso, setAviso] = useState(null);

  const novoDesafio = async () => {
    setDesafio(null);
    setResposta('');
    try {
      setDesafio(await challenge());
    } catch (e) {
      setErro(e.message || 'Não consegui carregar a verificação.');
    }
  };

  const checar = async () => {
    setFase('checando');
    setErro(null);

    /*
     * O link do e-mail chega como /?t=<token> e tem precedência sobre
     * qualquer sessão: quem clicou ali quer trocar a senha, mesmo que o
     * navegador ainda tenha um cookie válido de antes.
     */
    if (token) {
      try {
        const v = await checarToken(token);
        if (v.valido) {
          setDono(v);
          setFase('redefinir');
          return;
        }
      } catch (_) { /* trata como link morto */ }
      setFase('link-morto');
      return;
    }

    const r = await me();

    if (r.offline) {
      setFase('offline');
      setErro(r.message || null);
      return;
    }
    if (r.authenticated && !r.challenge_required) {
      onAuthenticated(r);
      return;
    }
    if (r.authenticated) {
      // logado, com permissão, e ainda assim precisa confirmar
      setFase('desafio-sessao');
      await novoDesafio();
      return;
    }
    setFase('login');
    await novoDesafio();
  };

  useEffect(() => { checar(); }, []);

  const entrar = async (e) => {
    e.preventDefault();
    if (ocupado) return;
    setErro(null);
    setOcupado(true);
    try {
      const r = await login(email.trim(), senha, desafio && desafio.id, resposta.trim());
      onAuthenticated({ ...r, authenticated: true });
    } catch (err) {
      setErro(err.message || 'Não foi possível entrar.');
      /*
       * Desafio novo a CADA erro, sem exceção.
       *
       * O servidor consome o desafio mesmo quando a resposta está certa e a
       * senha errada — se a tela não pedisse outro, o próximo envio falharia
       * por «código expirado» e a pessoa culparia o captcha por um erro de
       * senha.
       */
      setSenha('');
      await novoDesafio();
      if (respRef.current) respRef.current.focus();
    } finally {
      setOcupado(false);
    }
  };

  const confirmar = async (e) => {
    e.preventDefault();
    if (ocupado) return;
    setErro(null);
    setOcupado(true);
    try {
      await verifyChallenge(desafio && desafio.id, resposta.trim());
      const r = await me();
      if (r.authenticated && !r.challenge_required) onAuthenticated(r);
      else { setErro('A sessão expirou. Entre de novo.'); setFase('login'); await novoDesafio(); }
    } catch (err) {
      setErro(err.message || 'Não foi possível confirmar.');
      await novoDesafio();
      if (respRef.current) respRef.current.focus();
    } finally {
      setOcupado(false);
    }
  };

  const pedirLink = async (e) => {
    e.preventDefault();
    if (ocupado) return;
    setErro(null);
    setOcupado(true);
    try {
      const r = await esqueciSenha(email.trim(), desafio && desafio.id, resposta.trim());
      setAviso(r.mensagem);
      setFase('enviado');
    } catch (err) {
      setErro(err.message || 'Não foi possível pedir o link.');
      await novoDesafio();
    } finally {
      setOcupado(false);
    }
  };

  const gravarNova = async (e) => {
    e.preventDefault();
    if (ocupado) return;
    if (nova !== conf) {
      setErro('A confirmação não bate com a senha.');
      return;
    }
    setErro(null);
    setOcupado(true);
    try {
      await redefinirSenha(token, nova);
      setFase('trocada');
    } catch (err) {
      setErro(err.message || 'Não foi possível gravar a senha.');
    } finally {
      setOcupado(false);
    }
  };

  /*
   * Sugestão vinda do servidor, e o campo de confirmação já preenchido.
   *
   * Preencher os dois é deliberado: a senha sugerida não vai ser memorizada,
   * vai ser copiada — obrigar a redigitar 14 caracteres aleatórios só produz
   * erro de digitação num formulário que a pessoa não consegue conferir.
   */
  const sugerir = async () => {
    try {
      const r = await sugerirSenha();
      setNova(r.senha);
      setConf(r.senha);
      setErro(null);
    } catch (err) {
      setErro(err.message || 'Não consegui gerar uma senha.');
    }
  };

  const irParaLogin = async () => {
    // tira o ?t= da barra: recarregar não pode reabrir um link já usado
    try { history.replaceState(null, '', location.pathname); } catch (_) { /* ignora */ }
    setErro(null); setAviso(null); setNova(''); setConf('');
    setFase('login');
    await novoDesafio();
  };

  const detections = s.metrics && (s.metrics.objetos ?? s.metrics.faces ?? 0);

  const blocoDesafio = html`
    <div class="chal">
      <div class="chal-img">
        ${desafio
          ? html`<img src=${desafio.imagem} alt="Código de verificação" width="260" height="90" />`
          : html`<div class="chal-load" aria-hidden="true"></div>`}
        <button type="button" class="chal-novo" onClick=${novoDesafio}
                title="Gerar outro código" aria-label="Gerar outro código">↻</button>
      </div>
      <label class="chal-in">
        <span>Digite o código da imagem</span>
        <input ref=${respRef} class="txt" value=${resposta}
               onInput=${(ev) => setResposta(ev.target.value)}
               maxlength="8" autocomplete="off" autocapitalize="characters"
               autocorrect="off" spellcheck="false" required />
      </label>
    </div>
  `;

  return html`
    <div class="gate">
      <div class="gate-vignette"></div>

      <div class="gate-hud" aria-hidden="true">
        <div class="gate-corner tl"></div><div class="gate-corner tr"></div>
        <div class="gate-corner bl"></div><div class="gate-corner br"></div>
        <div class="gate-scan"></div>
        <div class="gate-telemetry">
          GPlanSiS<span>|</span><b>iaVision</b><br />
          CAM-01 · ${s.cameraOn ? 'ONLINE' : 'STANDBY'} · <b>${s.fps || '—'}</b> fps<br />
          DET <b>${detections}</b> · SESSÃO <b>BLOQUEADA</b>
        </div>
      </div>

      <div class="gate-ui">
        <div class="gate-card">
          <div class="gate-brand">GPlanSiS<span>|</span>iaVision</div>
          <p class="gate-kicker">Visão computacional em tempo real, na tela e na palma da sua mão.</p>

          ${fase === 'checando' && html`
            <p class="gate-lead">Verificando sessão…</p>
            <div class="gate-spin" aria-hidden="true"></div>
          `}

          ${fase === 'login' && html`
            <form onSubmit=${entrar} autocomplete="on">
              <p class="gate-lead">Entre com sua conta do <b>iaVision</b>.</p>

              ${erro && html`<p class="gate-err">${erro}</p>`}

              <label class="chal-in">
                <span>E-mail</span>
                <input class="txt" type="email" value=${email} name="email"
                       onInput=${(ev) => setEmail(ev.target.value)}
                       autocomplete="username" autocapitalize="off"
                       autocorrect="off" spellcheck="false" required />
              </label>
              <label class="chal-in">
                <span>Senha</span>
                <input class="txt" type="password" value=${senha} name="senha"
                       onInput=${(ev) => setSenha(ev.target.value)}
                       autocomplete="current-password" required />
              </label>

              ${blocoDesafio}

              <button class="gate-btn" type="submit" disabled=${ocupado || !desafio}>
                ${shieldIcon} ${ocupado ? 'Entrando…' : 'Entrar'}
              </button>

              <button type="button" class="gate-link" onClick=${async () => {
                setErro(null); setFase('esqueci'); await novoDesafio();
              }}>Esqueci minha senha</button>

              <p class="gate-note">
                Sua senha do iaVision é <b>separada</b> da do gplansis.com.
                Não tem a sua? Um administrador cadastra em <b>Acesso › Contas</b>.
              </p>
            </form>
          `}

          ${fase === 'esqueci' && html`
            <form onSubmit=${pedirLink}>
              <p class="gate-lead">
                Informe o e-mail da sua conta. Enviamos um link para você criar
                uma senha nova.
              </p>

              ${erro && html`<p class="gate-err">${erro}</p>`}

              <label class="chal-in">
                <span>E-mail</span>
                <input class="txt" type="email" value=${email}
                       onInput=${(ev) => setEmail(ev.target.value)}
                       autocomplete="username" autocapitalize="off"
                       autocorrect="off" spellcheck="false" required />
              </label>

              ${blocoDesafio}

              <button class="gate-btn" type="submit" disabled=${ocupado || !desafio}>
                ${ocupado ? 'Enviando…' : 'Enviar link'}
              </button>
              <button type="button" class="gate-link" onClick=${irParaLogin}>
                Voltar para o acesso
              </button>
              <p class="gate-note">
                O link vale por <b>1 hora</b> e funciona uma única vez.
              </p>
            </form>
          `}

          ${fase === 'enviado' && html`
            <p class="gate-lead">${aviso}</p>
            <button class="gate-btn" type="button" onClick=${irParaLogin}>
              Voltar para o acesso
            </button>
            <p class="gate-note">
              Não chegou? Confira o spam. Se ainda assim não vier, um
              administrador gera uma senha para você em <b>Acesso › Contas</b>.
            </p>
          `}

          ${fase === 'redefinir' && html`
            <form onSubmit=${gravarNova}>
              <p class="gate-lead">
                Criando uma senha nova para <b>${dono && (dono.nome || dono.email)}</b>.
              </p>

              ${erro && html`<p class="gate-err">${erro}</p>`}

              <label class="chal-in">
                <span>Nova senha</span>
                <input class="txt" type="text" value=${nova}
                       onInput=${(ev) => setNova(ev.target.value)}
                       autocomplete="new-password" spellcheck="false" required />
              </label>
              <label class="chal-in">
                <span>Repita a senha</span>
                <input class="txt" type="text" value=${conf}
                       onInput=${(ev) => setConf(ev.target.value)}
                       autocomplete="new-password" spellcheck="false" required />
              </label>

              <button type="button" class="gate-link" onClick=${sugerir}>
                Gerar uma senha forte para mim
              </button>

              <button class="gate-btn" type="submit" disabled=${ocupado}>
                ${shieldIcon} ${ocupado ? 'Gravando…' : 'Salvar e entrar'}
              </button>
              <p class="gate-note">
                Mínimo 10 caracteres, sem palavra óbvia. Uma frase longa vale
                mais que trocar letras por símbolos.
              </p>
            </form>
          `}

          ${fase === 'trocada' && html`
            <p class="gate-lead">
              <b>Senha criada.</b> As sessões abertas em outros aparelhos foram
              encerradas.
            </p>
            <button class="gate-btn" type="button" onClick=${irParaLogin}>
              ${shieldIcon} Entrar agora
            </button>
          `}

          ${fase === 'link-morto' && html`
            <p class="gate-lead">Este link não vale mais.</p>
            <p class="gate-note" style=${{ marginBottom: '18px' }}>
              Ele expira em 1 hora e funciona uma única vez — e um uso encerra
              todos os links pendentes da conta, inclusive os de pedidos
              anteriores.
            </p>
            <button class="gate-btn" type="button" onClick=${async () => {
              try { history.replaceState(null, '', location.pathname); } catch (_) { /* ignora */ }
              setErro(null); setFase('esqueci'); await novoDesafio();
            }}>Pedir outro link</button>
            <button type="button" class="gate-link" onClick=${irParaLogin}>
              Voltar para o acesso
            </button>
          `}

          ${fase === 'desafio-sessao' && html`
            <form onSubmit=${confirmar}>
              <p class="gate-lead">
                Sua sessão está ativa. Confirme que é você para abrir o iaVision.
              </p>

              ${erro && html`<p class="gate-err">${erro}</p>`}

              ${blocoDesafio}

              <button class="gate-btn" type="submit" disabled=${ocupado || !desafio}>
                ${shieldIcon} ${ocupado ? 'Confirmando…' : 'Confirmar e entrar'}
              </button>

              <p class="gate-note">
                Ter sessão e permissão não basta: o sistema pede esta
                confirmação a cada sessão, inclusive de quem já estava logado.
              </p>
            </form>
          `}

          ${fase === 'offline' && html`
            <p class="gate-lead">
              O <b>servidor de autenticação</b> não respondeu.
            </p>
            ${erro && html`<p class="gate-err">${erro}</p>`}
            <button class="gate-btn" type="button" onClick=${checar}>Tentar de novo</button>
            <p class="gate-note">
              A verificação de acesso acontece no servidor, de propósito — por
              isso o sistema não abre sem ele. Não existe modo local que
              contorne o login.
            </p>
          `}
        </div>
      </div>
    </div>
  `;
}

const shieldIcon = html`
  <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor"
       stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
       style=${{ verticalAlign: '-3px', marginRight: '8px' }}>
    <path d="M12 3l7 3v5c0 4.4-3 8.4-7 10-4-1.6-7-5.6-7-10V6z" />
    <path d="M9 12l2 2 4-4" />
  </svg>
`;
