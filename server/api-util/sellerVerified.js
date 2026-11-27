// XOLOLO P3: cálculo y sincronización del badge "Xololo Verified".
//
// Fuente de verdad SERVER-side: los criterios miran metadata privada
// del usuario (subscription status, docs legales aprobados) — que sólo
// es visible vía Integration API. Para que el badge pueda mostrarse
// en cualquier página pública (storefront, ListingPage) sin exponer
// esa metadata, sincronizamos el resultado como un boolean en
// `profile.publicData.xololoVerified`.
//
// Criterios v1 (todos requeridos):
//   1. Suscripción activa (metadata.xololoSubscription.status === 'active')
//   2. Cobros configurados (attributes.stripeConnected === true)
//   3. Perfil completo (firstName, lastName, displayName, slug de tienda)
//   4. Documentos legales aprobados: TODOS los slots requeridos por su
//      personType tienen status='approved' en metadata.xololoLegalDocs
//
// PENDIENTE (docs/SUBSCRIPTIONS_V1.md §5): Facturama. Cuando timbre de
// facturas quede integrado, agregar el criterio 5 aquí. Por ahora se
// omite — no bloqueamos el badge por algo que aún no existe.
//
// Sync: `syncVerifiedBadge` debe llamarse tras cualquier evento que
// pueda cambiar el resultado. Ver call sites documentados en el JSDoc.

const { slotsForPersonType } = require('./legalDocSlots');
const { sendEventNotifications } = require('./notifications');

const isDocApproved = doc => doc && doc.status === 'approved';

// XOLOLO 2026-11-25 — helper para armar la URL de la tienda del seller.
// Patrón oficial: subdomain `https://<slug>.xololo.mx` (storefront
// seller-branded). Mismo que usa sellerHeader en emailTemplates y
// SellerBrandFrame en el cliente. Si no tiene slug (casual), caemos
// al home.
const buildStorefrontUrl = publicData => {
  const root = (process.env.REACT_APP_MARKETPLACE_ROOT_URL || 'https://xololo.mx').replace(
    /\/$/,
    ''
  );
  const slug = publicData?.slug;
  return slug ? `https://${slug}.xololo.mx` : root;
};

const buildVerifiedProgramUrl = () => {
  const root = (process.env.REACT_APP_MARKETPLACE_ROOT_URL || 'https://xololo.mx').replace(
    /\/$/,
    ''
  );
  return `${root}/verified`;
};

// XOLOLO 2026-11-25 — herramienta Xololear (virlizar en RRSS) vive en
// /dashboard?section=promote (label 'Xololear' en el Dashboard — ver
// DashboardPage.js). El seller llega ahí, elige red y publica directo.
const buildXololearUrl = () => {
  const root = (process.env.REACT_APP_MARKETPLACE_ROOT_URL || 'https://xololo.mx').replace(
    /\/$/,
    ''
  );
  return `${root}/dashboard?section=promote`;
};

// XOLOLO 2026-11-25 — bloque HTML del logo para el share card del
// email. Si el seller subió logoUrl, lo mostramos grande (hasta
// 180×140). Si no, mostramos un placeholder tipográfico con la
// inicial del Negocio sobre fondo navy — así el card siempre queda
// presentable aunque el seller no haya subido branding.
// XOLOLO 2026-11-27 — fetcha una imagen remota y devuelve data URI
// base64. Lo usamos para INLINEAR logo + banner del seller en el email
// — así se ven aunque Gmail / Outlook / el preview local bloqueen
// remotes. Tamaños típicos: logo ~50KB, banner ~150KB — el email
// completo queda bajo 500KB, muy dentro del límite de Resend (40MB) y
// de Gmail (102KB antes de clipping, pero las imágenes inline no
// cuentan para ese 102KB de "texto", solo el contenido HTML textual).
const fetchAsDataUri = async (url, timeoutMs = 5000) => {
  if (!url) return null;
  try {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), timeoutMs);
    const r = await fetch(url, { signal: ctrl.signal });
    clearTimeout(to);
    if (!r.ok) return null;
    const type = r.headers.get('content-type') || 'image/jpeg';
    const buf = Buffer.from(await r.arrayBuffer());
    return `data:${type};base64,${buf.toString('base64')}`;
  } catch (e) {
    // Fallback silencioso: devolvemos null y el caller usa placeholder
    // o salta la imagen. El email aún se envía.
    return null;
  }
};

// XOLOLO 2026-11-25 — bloque HTML del logo para el share card del
// email. Si el seller subió logoUrl, lo mostramos grande (hasta
// 180×140). Si no, mostramos un placeholder tipográfico con la
// inicial del Negocio sobre fondo navy — así el card siempre queda
// presentable aunque el seller no haya subido branding.
const buildLogoHtmlForCard = async (sellerPd, name) => {
  const logoUrl = sellerPd?.logoUrl;
  if (logoUrl) {
    const dataUri = await fetchAsDataUri(logoUrl);
    const src = dataUri || logoUrl; // fallback: URL remota si falla el inline
    return (
      '<img src="' +
      String(src).replace(/"/g, '&quot;') +
      '" alt="' +
      String(name || 'Negocio').replace(/"/g, '&quot;') +
      '" style="display:block;max-width:180px;max-height:140px;width:auto;height:auto;border:0;margin:0 auto;" />'
    );
  }
  const initial = (name || 'X').trim().charAt(0).toUpperCase();
  return (
    '<div style="width:120px;height:120px;border-radius:50%;background:#232d40;' +
    'display:flex;align-items:center;justify-content:center;margin:0 auto;">' +
    '<span style="font-size:52px;font-weight:800;color:#ffffff;line-height:120px;">' +
    initial +
    '</span></div>'
  );
};

// XOLOLO 2026-11-27 — banner del Negocio arriba del card (hero visual
// de 440×140 cover). Si el seller no subió banner, devolvemos '' y el
// template no pinta esa fila — el card queda igual de válido pero más
// compacto. Usamos bannerUrl (primario); los bannerUrl2/3 quedan para
// variantes si queremos un carrusel futuro.
const buildBannerHtmlForCard = async sellerPd => {
  const bannerUrl = sellerPd?.bannerUrl;
  if (!bannerUrl) return '';
  const dataUri = await fetchAsDataUri(bannerUrl);
  const src = dataUri || bannerUrl;
  return (
    '<img src="' +
    String(src).replace(/"/g, '&quot;') +
    '" alt="" style="display:block;width:100%;height:140px;object-fit:cover;border:0;" />'
  );
};

// Limpia la URL del storefront para mostrarla "amigable" dentro del
// card capturable: quita el protocolo para que se lea tipo "xololo.mx/u/juan".
const prettyUrlForCard = url => String(url || '').replace(/^https?:\/\//, '');

// XOLOLO 2026-11-25 — email de felicitación cuando el badge se concede
// por PRIMERA vez. Idempotente: marca xololoVerifiedEmailSentAt en el
// mismo updateProfile que persiste el flag, para no reenviar si el
// seller lo pierde y lo recupera (no-reenvío es LA decisión aquí —
// evita spam en gente que toggle-a su sub).
const dispatchGrantedEmail = async ({ isdk, sellerId, user }) => {
  try {
    const profile = user.attributes?.profile || {};
    const email = user.attributes?.email;
    if (!email) return;
    const name =
      profile.displayName ||
      `${profile.firstName || ''} ${profile.lastName || ''}`.trim() ||
      'Negocio';
    // XOLOLO: logoUrl + logoHtmlLarge del seller para el share card
    // del email. El HTML va pre-computado porque el interpolador de
    // templates no soporta lógica condicional.
    const sellerPd = profile.publicData || {};
    const storefrontUrl = buildStorefrontUrl(sellerPd);
    await sendEventNotifications('seller.verified_granted', {
      seller: {
        name,
        email,
        logoUrl: sellerPd.logoUrl || null,
        // XOLOLO 2026-11-27 — async para inlinear logo + banner como
        // data URI. Ambas pueden tardar ~1s c/u por red; vale la pena
        // porque garantiza que el seller vea su branding real en el
        // email sin dependencia del proxy del cliente de email.
        logoHtmlLarge: await buildLogoHtmlForCard(sellerPd, name),
        bannerHtml: await buildBannerHtmlForCard(sellerPd),
        primaryColor: sellerPd.brandPrimaryColor || null,
      },
      storefront: {
        url: storefrontUrl,
        urlPretty: prettyUrlForCard(storefrontUrl),
      },
      verified: { url: buildVerifiedProgramUrl() },
      xololear: { url: buildXololearUrl() },
      // XOLOLO 2026-11-27 — omite la línea de "Envíos por paquetería
      // asegurados" del footer (ya no aplica a este tipo de notificación
      // que es de verificación, no de compra). El canal email interpreta
      // este flag en emailTemplates.xololoFooter.
      useXololoBranding: true,
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error(`[sellerVerified] email granted falló para ${sellerId}:`, e?.message || e);
  }
};

/**
 * Computa el badge para un user entity ya cargado con metadata privada
 * (Integration API — `sdk.users.show`).
 * @param {Object} user — user entity con .attributes.profile.metadata poblado
 * @returns {boolean}
 */
const computeVerifiedFromUser = user => {
  const attrs = user?.attributes || {};
  const profile = attrs.profile || {};
  const publicData = profile.publicData || {};
  const metadata = profile.metadata || {};

  // XOLOLO: seller casual (segunda mano particular) no paga suscripción
  // ni tiene storefront con slug — se le pide un criterio recortado.
  const sellerMode = publicData.sellerMode || 'store';
  const isCasual = sellerMode === 'casual_reseller';

  // (1) Subscription activa — sólo para seller 'store'.
  if (!isCasual) {
    const sub = metadata.xololoSubscription || {};
    if (sub.status !== 'active') return false;
  }

  // (2) Payouts configurados — para todos.
  if (attrs.stripeConnected !== true) return false;

  // (3) Perfil completo. Nombre + displayName siempre; slug sólo para 'store'.
  if (!profile.firstName || !profile.lastName || !profile.displayName) return false;
  if (!isCasual && !publicData.slug) return false;

  // (4) Documentos legales aprobados. El set requerido ya se filtra por
  // sellerMode (Constancia Fiscal y CURP se excluyen para casual).
  const legal = metadata.xololoLegalDocs || {};
  const personType = legal.personType;
  if (!personType) return false;
  const requiredSlots = slotsForPersonType(personType, sellerMode);
  if (requiredSlots.length === 0) return false;
  const docs = legal.docs || {};
  const allApproved = requiredSlots.every(slot => isDocApproved(docs[slot.key]));
  if (!allApproved) return false;

  return true;
};

/**
 * Lee el user, computa el badge y — sólo si cambió — escribe
 * `profile.publicData.xololoVerified` y `profile.publicData.xololoVerifiedAt`.
 * Silencioso ante errores (no relanza): el caller no debe romper su
 * flujo principal porque el sync del badge falló.
 *
 * Call sites:
 *   - stripeBilling.syncSubscriptionMetadata (cuando cambia el status)
 *   - upload-legal-doc (al aprobarse/rechazarse un doc)
 *   - admin-legal-docs.review (idem)
 *   - Cualquier futuro handler que toque payouts, perfil o slug
 *
 * @param {Object} params
 * @param {Object} params.isdk — Integration SDK
 * @param {string} params.sellerId
 */
const syncVerifiedBadge = async ({ isdk, sellerId }) => {
  try {
    const resp = await isdk.users.show({ id: sellerId });
    const user = resp.data.data;
    const publicData = user.attributes?.profile?.publicData || {};
    const nextVerified = computeVerifiedFromUser(user);
    const prevVerified = publicData.xololoVerified === true;

    if (nextVerified === prevVerified) return { changed: false, verified: nextVerified };

    // XOLOLO 2026-11-25 — idempotencia del email "verified_granted":
    // enviamos sólo si pasa a true Y aún no se envió nunca (null/missing).
    // Si el seller pierde y recupera el sello después, NO re-enviamos —
    // es intencional: el email celebra el primer hito, no cada ciclo.
    const shouldSendGrantedEmail =
      nextVerified === true && !publicData.xololoVerifiedEmailSentAt;

    await isdk.users.updateProfile({
      id: sellerId,
      publicData: {
        xololoVerified: nextVerified,
        xololoVerifiedAt: nextVerified ? new Date().toISOString() : null,
        // Marca de envío — fija para siempre tras el primer envío.
        ...(shouldSendGrantedEmail
          ? { xololoVerifiedEmailSentAt: new Date().toISOString() }
          : {}),
      },
    });

    if (shouldSendGrantedEmail) {
      // No await — no queremos bloquear el caller si el email cae lento.
      // Pero igual lo llamamos con await para que los errores se logueen
      // en el canal estándar de notifications. El try/catch de arriba ya
      // lo aísla del flujo principal.
      await dispatchGrantedEmail({ isdk, sellerId, user });
    }

    return { changed: true, verified: nextVerified, emailSent: shouldSendGrantedEmail };
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error(`[sellerVerified] sync falló para ${sellerId}:`, e?.message || e);
    return { changed: false, verified: null, error: e?.message || 'unknown' };
  }
};

module.exports = {
  computeVerifiedFromUser,
  syncVerifiedBadge,
};
