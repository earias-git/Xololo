import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useSelector } from 'react-redux';

import { isScrollingDisabled } from '../../ducks/ui.duck';
import { apiBaseUrl } from '../../util/api';

import { H3, LayoutSingleColumn, NamedLink, Page, PrimaryButton } from '../../components';
import TopbarContainer from '../TopbarContainer/TopbarContainer';
import FooterContainer from '../FooterContainer/FooterContainer';

import css from './EventCheckInPage.module.css';

// XOLOLO: página del seller para marcar check-in de asistentes a su
// evento. El QR del buyer contiene esta URL con ?token=JWT.
//
// Flujo:
//   1. Seller en la puerta abre la cámara nativa del celular.
//   2. Escanea el QR del asistente → se abre esta URL en el browser.
//   3. Esta página extrae ?token= del query y POSTea /api/event-check-in.
//   4. Muestra ✅ Válido / ⚠️ Ya usado / ❌ Inválido.
//
// Fallback sin cámara: textarea para pegar el token manualmente (ej. si
// el seller lo recibe por otro canal).

const parseTokenFromSearch = search => {
  if (!search) return '';
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  return params.get('token') || '';
};

const EventCheckInPage = () => {
  const location = useLocation();
  const scrollingDisabled = useSelector(isScrollingDisabled);
  const currentUser = useSelector(state => state.user?.currentUser);
  const [state, setState] = useState({
    loading: false,
    result: null,
    error: null,
  });
  const [manualToken, setManualToken] = useState('');
  const autoRanRef = useRef(false);

  const verify = useCallback(async token => {
    const t = String(token || '').trim();
    if (!t) return;
    setState({ loading: true, result: null, error: null });
    try {
      const res = await fetch(`${apiBaseUrl()}/api/event-check-in`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: t }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setState({ loading: false, result: null, error: data?.error || `http_${res.status}` });
        return;
      }
      setState({ loading: false, result: data, error: null });
    } catch (e) {
      setState({ loading: false, result: null, error: e?.message || 'network' });
    }
  }, []);

  // Auto-verifica si viene ?token= en la URL (flow QR escaneado).
  useEffect(() => {
    if (autoRanRef.current) return;
    const tokenFromUrl = parseTokenFromSearch(location.search);
    if (tokenFromUrl && currentUser?.id) {
      autoRanRef.current = true;
      verify(tokenFromUrl);
    }
  }, [location.search, currentUser?.id, verify]);

  const notLoggedIn = currentUser != null && !currentUser.id;

  return (
    <Page title="Check-in de evento" scrollingDisabled={scrollingDisabled} noIndex>
      <LayoutSingleColumn topbar={<TopbarContainer />} footer={<FooterContainer />}>
        <main className={css.main}>
          <H3 as="h1" className={css.heading}>
            🎫 Check-in de evento
          </H3>

          {notLoggedIn ? (
            <p className={css.lead}>
              Inicia sesión como el organizador del evento para verificar boletos.{' '}
              <NamedLink name="LoginPage">Iniciar sesión</NamedLink>
            </p>
          ) : (
            <p className={css.lead}>
              Escanea el QR del asistente con la cámara de tu celular. Si llegas aquí sin token,
              puedes pegarlo manualmente abajo.
            </p>
          )}

          {state.loading ? (
            <div className={css.card}>
              <p className={css.statusLine}>Verificando…</p>
            </div>
          ) : state.result ? (
            <ResultCard result={state.result} />
          ) : state.error ? (
            <ErrorCard error={state.error} />
          ) : null}

          {!notLoggedIn ? (
            <section className={css.manualSection}>
              <h4 className={css.manualTitle}>Verificar manualmente</h4>
              <textarea
                className={css.manualInput}
                placeholder="Pega aquí el token del boleto (JWT largo)"
                value={manualToken}
                onChange={e => setManualToken(e.target.value)}
                rows={3}
              />
              <PrimaryButton
                className={css.verifyBtn}
                type="button"
                onClick={() => verify(manualToken)}
                disabled={state.loading || !manualToken.trim()}
              >
                Verificar boleto
              </PrimaryButton>
            </section>
          ) : null}
        </main>
      </LayoutSingleColumn>
    </Page>
  );
};

const ResultCard = ({ result }) => {
  const { buyerName, listingTitle, quantity, alreadyCheckedIn, checkedInAt, previousScannedBy } =
    result || {};
  const whenPretty = checkedInAt ? new Date(checkedInAt).toLocaleString('es-MX') : '';

  if (alreadyCheckedIn) {
    return (
      <div className={`${css.card} ${css.cardWarn}`}>
        <p className={css.resultIcon}>⚠️</p>
        <h2 className={css.resultTitle}>Ya hizo check-in</h2>
        <p className={css.resultBig}>{buyerName}</p>
        <p className={css.resultMeta}>
          {listingTitle} · {quantity} boleto{quantity === 1 ? '' : 's'}
        </p>
        <p className={css.resultSmall}>
          Primer check-in: <strong>{whenPretty}</strong>
          {previousScannedBy ? ` por ${previousScannedBy}` : ''}
        </p>
        <p className={css.resultHint}>
          Si consideras que es la misma persona re-escaneando por error, deja pasar. Si parece un
          intento de doble entrada, verifica identidad con INE.
        </p>
      </div>
    );
  }

  return (
    <div className={`${css.card} ${css.cardOk}`}>
      <p className={css.resultIcon}>✅</p>
      <h2 className={css.resultTitle}>Boleto válido · Deja pasar</h2>
      <p className={css.resultBig}>{buyerName}</p>
      <p className={css.resultMeta}>
        {listingTitle} · {quantity} boleto{quantity === 1 ? '' : 's'}
      </p>
      <p className={css.resultSmall}>
        Check-in registrado: <strong>{whenPretty}</strong>
      </p>
    </div>
  );
};

const ERROR_COPY = {
  invalid_token: {
    title: 'Boleto inválido',
    detail:
      'El QR no es reconocible o fue firmado con otra clave. Verifica que el QR venga de un boleto Xololo.',
  },
  not_owner: {
    title: '⛔ No eres el organizador',
    detail:
      'Este boleto pertenece a un evento de otro seller. Debes estar logueado con la cuenta del organizador para registrar check-ins.',
  },
  unauthorized: {
    title: 'Sesión requerida',
    detail:
      'Debes estar logueado como el organizador del evento. Inicia sesión y vuelve a escanear.',
  },
  tx_not_found: {
    title: 'Transacción no encontrada',
    detail: 'El boleto apunta a una compra que ya no existe. Puede haberse cancelado.',
  },
};

const ErrorCard = ({ error }) => {
  const copy = ERROR_COPY[error] || {
    title: 'Error al verificar',
    detail: `No pudimos verificar este boleto (${error}). Vuelve a intentar o pide al asistente que te muestre el email del boleto.`,
  };
  return (
    <div className={`${css.card} ${css.cardError}`}>
      <p className={css.resultIcon}>❌</p>
      <h2 className={css.resultTitle}>{copy.title}</h2>
      <p className={css.resultHint}>{copy.detail}</p>
    </div>
  );
};

export default EventCheckInPage;
