// XOLOLO: helpers para leer municipios por estado de México.
//
// La data (src/util/mxMunicipios.json, ~41KB) se generó a partir de
// @webrek/mx-cp/dist (misma fuente SEPOMEX/INEGI que el CP lookup),
// normalizando los nombres de estado al mismo formato que MX_STATES
// para que el matching entre listing.coverageStates y buyer.recipientState
// sea exacto sin normalización adicional.
//
// Formato del JSON:
//   { "Morelos": ["Amacuzac", "Atlatlahucan", ...], ... }
//
// Para regenerar (raro — sólo si SEPOMEX/INEGI cambia municipios,
// que ocurre ~una vez al año o menos):
//   node scripts/generate-mx-municipios.js
// (o el snippet inline usado la primera vez).

import data from './mxMunicipios.json';

// Objeto plano { estado → [municipios ordenados alfabéticamente] }.
export const MX_MUNICIPIOS_BY_STATE = data;

// Lista de municipios para un estado. Devuelve [] si el estado no
// está en el mapa (o si el string no matchea exactamente el naming
// canónico — usar normalizeMxState primero si viene de un input libre).
export const municipiosByEstado = estado => data[estado] || [];

// Verifica si un municipio pertenece a un estado. Case-sensitive contra
// el naming canónico (SEPOMEX). Para inputs libres, normalizar antes.
export const isMunicipioInEstado = (municipio, estado) => {
  if (!municipio || !estado) return false;
  return (data[estado] || []).includes(municipio);
};
