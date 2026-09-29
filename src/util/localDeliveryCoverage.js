// XOLOLO Envíos v2: validación de cobertura de localDelivery contra la
// dirección del buyer (estado + municipio).
//
// Regla:
//   - Si el listing no tiene coverageStates definido (listing legacy,
//     migrado antes del sub-commit A) → tratamos como "cobertura sin
//     restricción" para no romper listings existentes. TODO: forzar
//     re-configuración una vez todos los sellers actualicen.
//   - Si coverageStates está definido, el estado del buyer debe estar
//     en la lista.
//   - Si coverageMunicipios[estado] existe y tiene al menos un
//     municipio, el municipio del buyer debe estar en la lista.
//     Si el mapa no tiene entrada para el estado (o array vacío) se
//     interpreta como "todos los municipios del estado".
//   - Si no conocemos el municipio del buyer (aún no ingresó CP,
//     lookup falló, etc.) y el listing tiene restricción de municipios,
//     el resultado es false — no podemos afirmar cobertura.

import { normalizeMxState } from './mxStates';

export const isLocalDeliveryCovered = (localDeliveryCfg, buyerAddress = {}) => {
  if (!localDeliveryCfg?.enabled) return false;
  const covStates = Array.isArray(localDeliveryCfg.coverageStates)
    ? localDeliveryCfg.coverageStates
    : [];
  // Retrocompat: sin coverageStates → sin restricción hasta que el
  // seller edite el listing.
  if (covStates.length === 0) return true;

  const rawState = buyerAddress.estado || buyerAddress.state;
  if (!rawState) return false;
  const normState = normalizeMxState(rawState) || rawState;
  if (!covStates.includes(normState)) return false;

  const covMunis = localDeliveryCfg.coverageMunicipios || {};
  const municipiosForState = Array.isArray(covMunis[normState])
    ? covMunis[normState]
    : [];
  // Sin restricción de municipios en el estado → cubierto.
  if (municipiosForState.length === 0) return true;

  const rawMuni = buyerAddress.municipio || buyerAddress.city;
  if (!rawMuni) return false;
  // El CP lookup (/api/postal-code) devuelve city == municipio con el
  // mismo naming que INEGI/SEPOMEX, así que un includes directo basta.
  return municipiosForState.includes(rawMuni);
};

// Devuelve una copia del shape de métodos con localDelivery.enabled
// re-computado por cobertura. Añade _coverageFiltered=true cuando el
// método estaba habilitado en el listing pero se deshabilitó por
// dirección — la UI puede usarlo para mostrar mensaje explicativo
// ("Este método no cubre tu dirección") en vez de simplemente ocultar.
export const applyLocalDeliveryCoverageFilter = (methods, buyerAddress) => {
  if (!methods?.localDelivery) return methods;
  const originallyEnabled = !!methods.localDelivery.enabled;
  const covered = isLocalDeliveryCovered(methods.localDelivery, buyerAddress);
  return {
    ...methods,
    localDelivery: {
      ...methods.localDelivery,
      enabled: originallyEnabled && covered,
      _coverageFiltered: originallyEnabled && !covered,
    },
  };
};
