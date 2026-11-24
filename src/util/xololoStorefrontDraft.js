// XOLOLO Web Studio PR 2 — modelo staging/draft para el branding del
// storefront. Los buyers ven SOLO el estado publicado; el seller edita
// en un borrador que puede publicar o descartar cuando quiera.
//
// LOCKED (ver memoria `web-studio-staging-lock`):
//   - "Aprobación" = del seller, no de OPS. Él decide cuándo publicar.
//   - Sólo campos de BRANDING se stagean. Dirección, WhatsApp, slug, etc.
//     siguen save-direct al flat (pedir a un seller "publicar" para
//     cambiar su WhatsApp sería absurdo).
//   - El flat (publicData.brandPrimaryColor, .logoUrl, …) es la fuente
//     de verdad PUBLICADA. SellerBrandFrame y todo consumer del
//     storefront NUNCA lee del draft.
//   - El draft vive en publicData.storefrontDraft = { …branding }.
//     Si está ausente o es null → no hay draft (todo publicado).
//
// Preguntas que vale la pena anticipar:
//   - "¿y si logoUrl está en draft pero yo lo cambié como string flat
//     por fuera?" → el flat gana al publicar. El draft se compara contra
//     el flat actual, no contra un snapshot anterior.
//   - "¿y si el draft tiene exactamente los mismos valores que el flat?"
//     → `hasActiveDraft()` devuelve false — no tiene sentido "publicar"
//     cambios que ya están publicados.

// Lista LOCKED de campos de branding que se stagean. Agregar un campo
// nuevo aquí también requiere agregarlo al UI del form y al preview.
// storefrontTheme se agregó en Web Studio PR 3 (ver xololoStorefrontThemes).
export const BRANDING_FIELDS = [
  'brandPrimaryColor',
  'brandSecondaryColor',
  'logoUrl',
  'bannerUrl',
  'bannerUrl2',
  'bannerUrl3',
  'storefrontTheme',
];

// Normaliza: string vacío o undefined → null. Para comparar drafts vs
// flats sin que '' vs null den falsos positivos.
const norm = v => {
  if (v === undefined) return null;
  if (typeof v === 'string' && v.trim() === '') return null;
  return v;
};

// Devuelve el shape publicado (lo que ven los buyers), leyendo del flat.
export const readPublishedBranding = user => {
  const pd = user?.attributes?.profile?.publicData || {};
  const out = {};
  for (const k of BRANDING_FIELDS) out[k] = norm(pd[k]);
  return out;
};

// Devuelve el shape del draft (o null si no hay).
export const readDraftBranding = user => {
  const pd = user?.attributes?.profile?.publicData || {};
  const draft = pd.storefrontDraft;
  if (!draft || typeof draft !== 'object') return null;
  const out = {};
  let hasAny = false;
  for (const k of BRANDING_FIELDS) {
    const v = norm(draft[k]);
    out[k] = v;
    if (v !== null) hasAny = true;
  }
  return hasAny ? out : null;
};

// Shape a mostrar en el form / preview. Prioriza draft, cae a flat.
// Siempre devuelve un objeto con todas las keys de BRANDING_FIELDS
// (algunas pueden ser null).
export const readEffectiveBranding = user => {
  const draft = readDraftBranding(user);
  if (draft) return draft;
  return readPublishedBranding(user);
};

// true si el draft tiene al menos UN campo distinto del flat publicado.
// Si el draft es idéntico al publicado NO cuenta como activo (nada que
// publicar).
export const hasActiveDraft = user => {
  const draft = readDraftBranding(user);
  if (!draft) return false;
  const pub = readPublishedBranding(user);
  return BRANDING_FIELDS.some(k => draft[k] !== pub[k]);
};

// Diff legible para el UI — qué campos del draft difieren del publicado.
export const getDraftDiff = user => {
  const draft = readDraftBranding(user);
  if (!draft) return [];
  const pub = readPublishedBranding(user);
  return BRANDING_FIELDS.filter(k => draft[k] !== pub[k]);
};

// Construye el patch de publicData para GUARDAR UN BORRADOR.
//   - Branding va dentro de `storefrontDraft`
//   - Resto de campos va flat como siempre (no se stagean)
// branding/other son los valores crudos ya limpios del form.
export const buildDraftPatch = ({ branding, other }) => {
  const draftObj = {};
  for (const k of BRANDING_FIELDS) draftObj[k] = norm(branding?.[k]);
  // Los campos flat de branding quedan EN null del lado publicado? NO:
  // mantenemos el flat tal cual estaba (no lo tocamos en save-draft).
  // Por eso solo seteamos storefrontDraft + other.
  return {
    ...(other || {}),
    storefrontDraft: draftObj,
  };
};

// Construye el patch de publicData para PUBLICAR UN BORRADOR.
//   - Copia los campos del draft al flat
//   - Limpia storefrontDraft (null)
// Si no se pasa `draft` toma del user actual.
export const buildPublishPatch = ({ user, draft }) => {
  const source = draft || readDraftBranding(user) || readPublishedBranding(user);
  const patch = { storefrontDraft: null };
  for (const k of BRANDING_FIELDS) patch[k] = norm(source[k]);
  return patch;
};

// Construye el patch para DESCARTAR el borrador. Deja el flat intacto.
export const buildDiscardPatch = () => ({ storefrontDraft: null });
