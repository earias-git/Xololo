/**
 * XOLOLO Mobile Viewport Guard
 *
 * Problema: Stripe.js (y otras SDKs como Intercom, FB Pixel) inyecta
 * iframes invisibles al <body> con `style="width: 1px !important;
 * min-width: 100% !important"`. En móvil, `min-width: 100%` se calcula
 * contra el ICB; una vez que CUALQUIER elemento del document infla el
 * scrollWidth > viewport, el iframe adopta ese ancho mayor y lo
 * mantiene — loop que estira el layout tras el render inicial.
 *
 * Síntoma reportado por el usuario: "se despliega correcto un milisegundo
 * pero después se amplía y vuelve a verse mal". Confirmado como iframe
 * de __privateStripeMetricsController con width: 690px (vs viewport 375).
 *
 * Solución: MutationObserver que, cuando aparece un iframe invisible de
 * terceros conocidos, le fuerza inline `width:1px; min-width:0; left:-9999px`
 * — gana sobre el `!important` inline de Stripe porque es el último estilo
 * aplicado al elemento (y setProperty con 'important' iguala la prioridad).
 *
 * Solo corre en cliente y solo en móvil (width < 768). Desktop no sufre
 * el problema y no queremos arriesgar romper Stripe Elements / 3DS iframes
 * que sí necesitan ser visibles.
 */

const INVISIBLE_IFRAME_NAME_PATTERNS = [
  /^__privateStripeMetricsController/,
  /^__privateStripeController/,
  /^intercom-/,
  // Facebook Pixel, Google Tag Manager noscript iframes
];

const INVISIBLE_IFRAME_SRC_PATTERNS = [
  /js\.stripe\.com\/v3\/m-outer-/,
  /js\.stripe\.com\/v3\/controller-/,
];

const matchesInvisible = iframe => {
  const name = iframe.name || '';
  const src = iframe.src || '';
  return (
    INVISIBLE_IFRAME_NAME_PATTERNS.some(re => re.test(name)) ||
    INVISIBLE_IFRAME_SRC_PATTERNS.some(re => re.test(src))
  );
};

const neutralize = iframe => {
  // Mover fuera del flujo y achicar a 1x1. setProperty con 'important'
  // iguala la prioridad del !important inline de Stripe, pero como corre
  // DESPUÉS, gana en cascada.
  const s = iframe.style;
  s.setProperty('position', 'fixed', 'important');
  s.setProperty('left', '-9999px', 'important');
  s.setProperty('top', '-9999px', 'important');
  s.setProperty('width', '1px', 'important');
  s.setProperty('height', '1px', 'important');
  s.setProperty('min-width', '0', 'important');
  s.setProperty('max-width', '1px', 'important');
  s.setProperty('visibility', 'hidden', 'important');
  s.setProperty('pointer-events', 'none', 'important');
};

export const installMobileIframeGuard = () => {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  // Solo activar en móvil — en desktop no hay problema y no queremos
  // arriesgar romper Stripe Elements (que sí usa iframes visibles).
  const isMobile = window.matchMedia && window.matchMedia('(max-width: 767px)').matches;
  if (!isMobile) return;

  const scanAndFix = () => {
    const iframes = document.querySelectorAll('iframe');
    iframes.forEach(f => {
      if (matchesInvisible(f)) neutralize(f);
    });
  };

  // Pasada inicial por cualquier iframe que ya exista
  scanAndFix();

  // Observar nuevos iframes añadidos al DOM
  const observer = new MutationObserver(mutations => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node.nodeType !== 1) continue;
        if (node.tagName === 'IFRAME') {
          if (matchesInvisible(node)) neutralize(node);
        } else if (node.querySelectorAll) {
          const inner = node.querySelectorAll('iframe');
          inner.forEach(f => {
            if (matchesInvisible(f)) neutralize(f);
          });
        }
      }
      // También re-escaneamos si Stripe mutó el style de un iframe ya
      // existente para revertir nuestro fix.
      if (m.type === 'attributes' && m.target.tagName === 'IFRAME') {
        if (matchesInvisible(m.target)) neutralize(m.target);
      }
    }
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['style'],
  });
};
