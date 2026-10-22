/**
 * cv/runtime/livres-u/cursor.js — o cursor do «Mouse por cabeça» (CV-81, X2):
 * um círculo fixo sobre a página do iaVision (pointer-events: none) e o
 * clique sintético no elemento sob ele. Só funciona DENTRO desta página — o
 * navegador não deixa mover o mouse do sistema (para isso, app nativo).
 *
 * Também mostra as instruções da calibração em letras grandes.
 */
let el = null, aviso = null, anel = null;

function garantir() {
  if (el || typeof document === 'undefined') return;
  el = document.createElement('div');
  el.setAttribute('data-mouse-cabeca', '');
  el.setAttribute('aria-hidden', 'true');
  Object.assign(el.style, {
    position: 'fixed', left: '0', top: '0', width: '28px', height: '28px', marginLeft: '-14px', marginTop: '-14px',
    borderRadius: '50%', border: '3px solid #FFD84D', background: 'rgba(255,216,77,.18)', boxShadow: '0 0 0 2px rgba(0,0,0,.5)',
    pointerEvents: 'none', zIndex: '2147483646', transition: 'transform .08s', display: 'none',
  });
  anel = document.createElement('div');
  Object.assign(anel.style, { position: 'absolute', inset: '-10px', borderRadius: '50%', border: '3px solid #4ade80', opacity: '0', transition: 'opacity .3s' });
  el.appendChild(anel);
  aviso = document.createElement('div');
  aviso.setAttribute('role', 'status');
  Object.assign(aviso.style, {
    position: 'fixed', left: '50%', top: '18%', transform: 'translateX(-50%)', padding: '18px 28px', borderRadius: '12px',
    background: 'rgba(2,48,44,.92)', color: '#f5f5f4', font: '600 28px/1.3 system-ui, sans-serif', zIndex: '2147483647',
    pointerEvents: 'none', display: 'none', textAlign: 'center', maxWidth: '80vw',
  });
  document.body.appendChild(el);
  document.body.appendChild(aviso);
}

/** Posição em 0–1 da janela; `estado`: 'normal' | 'fechado' | 'pausado'. */
export function moverCursor(fx, fy, estado = 'normal') {
  garantir();
  if (!el) return;
  el.style.display = 'block';
  el.style.left = `${fx * window.innerWidth}px`;
  el.style.top = `${fy * window.innerHeight}px`;
  el.style.borderColor = estado === 'pausado' ? '#a1a1aa' : estado === 'fechado' ? '#f472b6' : '#FFD84D';
  el.style.transform = estado === 'fechado' ? 'scale(.8)' : 'scale(1)';
}

export function esconderCursor() { if (el) el.style.display = 'none'; if (aviso) aviso.style.display = 'none'; }

export function mostrarAviso(texto) {
  garantir();
  if (!aviso) return;
  aviso.textContent = texto || '';
  aviso.style.display = texto ? 'block' : 'none';
}

/** Clique no elemento sob o cursor (o cursor não recebe eventos). Devolve o elemento ou null. */
export function clicarEm(fx, fy) {
  if (typeof document === 'undefined') return null;
  const x = fx * window.innerWidth, y = fy * window.innerHeight;
  const alvo = document.elementFromPoint(x, y);
  if (!alvo) return null;
  const opts = { bubbles: true, cancelable: true, clientX: x, clientY: y, view: window };
  try {
    alvo.dispatchEvent(new PointerEvent('pointerdown', { ...opts, pointerType: 'mouse', isPrimary: true }));
    alvo.dispatchEvent(new MouseEvent('mousedown', opts));
    alvo.dispatchEvent(new PointerEvent('pointerup', { ...opts, pointerType: 'mouse', isPrimary: true }));
    alvo.dispatchEvent(new MouseEvent('mouseup', opts));
  } catch (_) { /* navegador antigo */ }
  if (typeof alvo.click === 'function') alvo.click(); else alvo.dispatchEvent(new MouseEvent('click', opts));
  if (typeof alvo.focus === 'function' && /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(alvo.tagName)) alvo.focus();
  if (anel) { anel.style.opacity = '1'; setTimeout(() => { if (anel) anel.style.opacity = '0'; }, 300); }
  return alvo;
}
