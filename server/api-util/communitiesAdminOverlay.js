// XOLOLO 2026-11-18 — ADR-006 PR-4: overlay admin de comunidades.
//
// Permite a un operador togglear `isPublished` sin redeploy.
// In-memory: se reinicia con cada deploy / reinicio del proceso.
// Para persistir entre deploys hay que commitear el cambio al seed
// (src/config/communities.js). La UI avisa al operador.
//
// Diseño:
// - Mapa id → {isPublished, updatedAt, updatedBy}.
// - communitiesService.toPublic / getBySlugPublic consultan este
//   overlay ANTES del seed field, para que un flag de admin se refleje
//   al instante.
// - Cambios dispararan invalidateCache() del service público.

const OVERLAY = new Map(); // id → { isPublished, updatedAt, updatedBy }

const get = id => OVERLAY.get(id) || null;
const getAll = () => Array.from(OVERLAY.entries()).map(([id, data]) => ({ id, ...data }));

const setPublished = ({ id, isPublished, operatorEmail }) => {
  OVERLAY.set(id, {
    isPublished: !!isPublished,
    updatedAt: new Date().toISOString(),
    updatedBy: operatorEmail || 'unknown',
  });
};

const clear = id => OVERLAY.delete(id);
const reset = () => OVERLAY.clear();

// Aplica el overlay sobre el community del seed. No muta el input.
const apply = seedCommunity => {
  if (!seedCommunity) return seedCommunity;
  const ov = OVERLAY.get(seedCommunity.id);
  if (!ov) return seedCommunity;
  return { ...seedCommunity, isPublished: ov.isPublished };
};

module.exports = { get, getAll, setPublished, clear, reset, apply };
