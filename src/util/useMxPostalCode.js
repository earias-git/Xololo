import { useEffect, useRef, useState } from 'react';

import { apiBaseUrl } from './api';

// XOLOLO: hook que consulta /api/postal-code cuando se escribe un CP
// mexicano de 5 dígitos. Debouncea 400ms para no golpear el endpoint
// por cada tecla. Devuelve status:
//  - 'idle'   : sin lookup activo (CP < 5 dígitos, o countryCode ≠ MX)
//  - 'loading': fetch en curso
//  - 'ok'     : data cargada ({ postalCode, state, city, colonies })
//  - 'error'  : CP inválido, no encontrado o backend down
//
// Extraído de ShippingDetails.js (CheckoutPage) para reusar en
// CotizarEnvioPage (feature #28). Puro: no depende de Final Form; el
// consumidor decide qué hacer con la data (autorrellenar inputs,
// mostrar dropdown de colonias, etc.).
export const useMxPostalCode = (cp, countryCode = 'MX') => {
  const [state, setState] = useState({ status: 'idle', data: null, error: null });
  const timerRef = useRef(null);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setState(prev => (prev.status === 'idle' ? prev : { status: 'idle', data: null, error: null }));

    if (countryCode && countryCode !== 'MX') return;
    if (!/^\d{5}$/.test(String(cp || '').trim())) return;

    timerRef.current = setTimeout(async () => {
      setState({ status: 'loading', data: null, error: null });
      try {
        const res = await fetch(`${apiBaseUrl()}/api/postal-code?cp=${cp}`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setState({ status: 'error', data: null, error: data.error || 'lookup_failed' });
          return;
        }
        setState({ status: 'ok', data, error: null });
      } catch (e) {
        setState({ status: 'error', data: null, error: 'network' });
      }
    }, 400);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [cp, countryCode]);

  return state;
};

export default useMxPostalCode;
