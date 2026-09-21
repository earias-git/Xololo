// XOLOLO: templates HTML de emails con dual-brand (seller + Xololo).
//
// Filosofía: los emails al SELLER llevan branding Xololo puro (es una
// notificación operativa del marketplace). Los emails al BUYER llevan
// dual-brand: logo/colores del seller arriba (el buyer está comprando
// en la tienda X), Xololo footer explicando compra protegida.
//
// Se usa desde server/api-util/notifications/channels/email.js:
//   const html = renderEmailHtml({
//     actor: 'buyer' | 'seller',
//     seller: { name, logoUrl, primaryColor, secondaryColor, slug },
//     title,
//     bodyHtml,   // ya interpolado, puede contener <p>, <a>, <ul>, etc
//     cta: { url, label },  // opcional
//   });

const XOLOLO_PRIMARY = '#232d40';
const XOLOLO_BRAND_HREF = 'https://xololo.mx';
// XOLOLO: logo servido desde public/static/xololo-logo-email.png (516x96,
// PNG con fondo transparente). Sharetribe expone /static como directorio
// estático desde el server (ver server/index.js express.static).
const XOLOLO_LOGO_URL = 'https://xololo.mx/static/xololo-logo-email.png';

// Escapa HTML para inyectar strings de forma segura.
const esc = str =>
  String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const paragraph = txt => `<p style="margin: 0 0 12px; font-size: 15px; line-height: 1.55; color: #232d40;">${esc(txt)}</p>`;

// Convierte bodyText plano en HTML seguro (rompe párrafos por \n\n).
const textToHtml = txt =>
  String(txt || '')
    .split(/\n\n+/)
    .map(p => paragraph(p))
    .join('');

// Header con logo del seller GRANDE (dual-brand para buyer)
const sellerHeader = ({ seller }) => {
  const brandColor = seller?.primaryColor || XOLOLO_PRIMARY;
  const sellerUrl = seller?.slug ? `https://${seller.slug}.xololo.mx` : XOLOLO_BRAND_HREF;
  const sellerLogoImg = seller?.logoUrl
    ? `<img src="${esc(seller.logoUrl)}" alt="${esc(seller?.name || 'Tienda')}" width="200" style="max-height: 60px; max-width: 200px; height: auto; display: block; border: 0;" />`
    : `<span style="color: ${esc(brandColor)}; font-size: 22px; font-weight: 800; letter-spacing: -0.01em;">${esc(seller?.name || 'Tienda')}</span>`;

  return `
    <div style="background: #ffffff; border-bottom: 4px solid ${esc(brandColor)}; padding: 24px 32px; text-align: left;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td style="vertical-align: middle;">
            <a href="${esc(sellerUrl)}" style="text-decoration: none;">${sellerLogoImg}</a>
          </td>
          <td style="vertical-align: middle; text-align: right;">
            <a href="${XOLOLO_BRAND_HREF}" style="text-decoration: none; display: inline-block; padding: 6px 12px; background-color: #f3f4f6; border-radius: 999px; line-height: 1;">
              <span style="color: #6b7280; font-size: 10px; margin-right: 6px; vertical-align: middle;">Powered by</span>
              <img src="${XOLOLO_LOGO_URL}" alt="Xololo" height="16" style="height: 16px; width: auto; vertical-align: middle; border: 0;" />
            </a>
          </td>
        </tr>
      </table>
    </div>
  `;
};

// Header sólo Xololo (para emails al seller). Fondo blanco con border
// bottom navy — evita el problema de logos color sobre fondo dark.
const xololoHeader = () => `
  <div style="background: #ffffff; border-bottom: 4px solid ${XOLOLO_PRIMARY}; padding: 22px 32px; text-align: left;">
    <a href="${XOLOLO_BRAND_HREF}" style="text-decoration: none; display: inline-block;">
      <img src="${XOLOLO_LOGO_URL}" alt="Xololo" height="42" style="height: 42px; width: auto; display: block; border: 0;" />
    </a>
  </div>
`;

// Footer con Xololo + mensaje de compra protegida (para todos)
const xololoFooter = () => `
  <div style="background: ${XOLOLO_PRIMARY}; color: #dfe4ee; padding: 24px 32px; text-align: center;">
    <p style="margin: 0 0 8px; font-size: 14px; color: #ffffff; font-weight: 700;">
      🛡️ Compra protegida hasta $100,000 MXN
    </p>
    <p style="margin: 0 0 16px; font-size: 12.5px; color: rgba(223, 228, 238, 0.75); line-height: 1.5;">
      Todos los envíos incluyen SOS Protección Skydropx: si no recibes<br />
      el producto o llega dañado, te devolvemos tu dinero.
    </p>
    <p style="margin: 0 0 8px;">
      <a href="${XOLOLO_BRAND_HREF}" style="text-decoration: none; display: inline-block;">
        <img src="${XOLOLO_LOGO_URL}" alt="Xololo" height="24" style="height: 24px; width: auto; display: inline-block; border: 0; opacity: 0.9;" />
      </a>
    </p>
    <p style="margin: 0; font-size: 11px; color: rgba(223, 228, 238, 0.6);">
      Marca registrada &middot; Único sitio oficial:
      <a href="${XOLOLO_BRAND_HREF}" style="color: rgba(223, 228, 238, 0.85); text-decoration: none;">xololo.mx</a>
    </p>
  </div>
`;

const buttonCta = ({ url, label }, brandColor) => {
  const bg = brandColor || XOLOLO_PRIMARY;
  return `
    <div style="text-align: center; padding: 8px 0 4px;">
      <a href="${esc(url)}" style="display: inline-block; padding: 12px 28px; background-color: ${esc(
    bg
  )}; color: #ffffff; text-decoration: none; border-radius: 999px; font-weight: 700; font-size: 15px;">
        ${esc(label)}
      </a>
    </div>
  `;
};

// Renderiza el HTML completo del email.
const renderEmailHtml = ({ actor, seller, title, bodyHtml, bodyText, cta }) => {
  const isBuyer = actor === 'buyer';
  const brandColor = isBuyer && seller?.primaryColor ? seller.primaryColor : XOLOLO_PRIMARY;
  const bodyContent = bodyHtml || textToHtml(bodyText);
  const header = isBuyer ? sellerHeader({ seller }) : xololoHeader();

  return `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light" />
    <title>${esc(title)}</title>
  </head>
  <body style="margin: 0; padding: 0; background-color: #f7f4ee; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #f7f4ee; padding: 24px 12px;">
      <tr>
        <td>
          <table role="presentation" width="600" align="center" cellpadding="0" cellspacing="0" border="0" style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 14px; overflow: hidden; box-shadow: 0 4px 16px rgba(0, 0, 0, 0.06);">
            <tr><td>${header}</td></tr>
            <tr>
              <td style="padding: 28px 32px 8px;">
                <h1 style="margin: 0 0 16px; font-size: 20px; font-weight: 800; color: #232d40; line-height: 1.3;">${esc(title)}</h1>
                ${bodyContent}
                ${cta?.url && cta?.label ? buttonCta(cta, brandColor) : ''}
              </td>
            </tr>
            <tr><td>${xololoFooter()}</td></tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
};

module.exports = { renderEmailHtml, escapeHtml: esc };
