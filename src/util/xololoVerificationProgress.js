// XOLOLO PR 2 (Verified): computa el progreso de verificación de un
// seller a partir de los slots aplicables y el mapa de docs subidos.
//
// Entrada:
//   - `slots`: array de slot defs filtrados por personType + sellerMode
//     (ver src/config/legalDocSlots.js#slotsForPersonType).
//   - `docs`: map `{ [slotKey]: { status: 'pending'|'approved'|'rejected', ... } }`
//     tal como lo devuelve GET /api/seller-legal-docs.
//
// Salida: shape estable para UI — nunca lanza; faltantes cuentan como
// 0 aprobados / 0 subidos.
//
// Esta función NO decide si el badge se otorga (ese es trabajo
// server-side en sellerVerified.js#computeVerifiedFromUser que además
// exige suscripción activa, payouts, perfil completo). Aquí sólo
// decimos cuánto del "subir documentos" del seller está hecho, para
// mostrar progreso en la UI.

export const getVerificationProgress = ({ slots, docs }) => {
  const total = Array.isArray(slots) ? slots.length : 0;
  const map = docs || {};
  let approved = 0;
  let inReview = 0;
  let rejected = 0;
  let uploaded = 0;

  (slots || []).forEach(slot => {
    const d = map[slot.key];
    if (!d) return;
    uploaded += 1;
    if (d.status === 'approved') approved += 1;
    else if (d.status === 'rejected') rejected += 1;
    else inReview += 1;
  });

  return {
    total,
    approved,
    inReview,
    rejected,
    uploaded,
    allApproved: total > 0 && approved === total,
    hasRejected: rejected > 0,
    pct: total > 0 ? Math.round((approved / total) * 100) : 0,
  };
};

// Texto humano del estado — pensado para una línea corta arriba del
// hero. Prioridad: rechazo (acción requerida) → todo aprobado
// (celebración) → en revisión → incompleto → vacío.
export const verificationStatusLabel = progress => {
  if (!progress || progress.total === 0) return 'Elige tu tipo de persona para empezar.';
  if (progress.hasRejected) return 'Tenemos que pedirte volver a subir un documento.';
  if (progress.allApproved) return 'Tu Negocio cumple el filtro de documentos de Xololo Verified.';
  if (progress.inReview > 0 && progress.approved === 0)
    return 'Recibimos tus documentos. Estamos revisándolos.';
  if (progress.approved > 0 && progress.inReview > 0)
    return `${progress.approved} aprobado(s), ${progress.inReview} en revisión.`;
  return `Llevas ${progress.approved} de ${progress.total} documentos aprobados.`;
};
