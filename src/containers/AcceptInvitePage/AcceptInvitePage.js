import React, { useEffect, useState } from 'react';
import { useLocation, useHistory } from 'react-router-dom';
import { useSelector } from 'react-redux';

import { apiBaseUrl } from '../../util/api';
import { isScrollingDisabled } from '../../ducks/ui.duck';
import { ROLE_PRESETS, PERMISSION_META } from '../../util/xololoTeam';
import {
  H2,
  LayoutSingleColumn,
  NamedRedirect,
  Page,
  PrimaryButton,
  IconSpinner,
} from '../../components';
import TopbarContainer from '../TopbarContainer/TopbarContainer';
import FooterContainer from '../FooterContainer/FooterContainer';

import css from './AcceptInvitePage.module.css';

// XOLOLO Tier Empresarial · E4 — página /accept-invite que consume el
// token del email de invitación.
//
// Flujo:
//   1. Lee ?token=... de la URL.
//   2. Decodifica el payload (sin verificar firma — eso lo hace el server
//      al aceptar) para mostrar al colaborador QUIÉN lo invitó y con QUÉ
//      permisos ANTES de aceptar.
//   3. Si el user no está logueado → NamedRedirect a /login con ?from=
//      current URL.
//   4. Si el user está logueado pero su email no coincide con el del
//      token → aviso bloqueante (debe cerrar sesión y entrar con el
//      email correcto).
//   5. Click "Aceptar" → POST /api/team/accept-invite { token }. Si ok,
//      redirige a /dashboard con un flag ?welcome=team.

const api = async (path, opts = {}) => {
  const res = await fetch(`${apiBaseUrl()}${path}`, {
    method: opts.method || 'GET',
    credentials: 'include',
    headers: opts.body ? { 'Content-Type': 'application/json' } : {},
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
};

// Decode JWT payload sin verificar firma. Si el token es malformado,
// devuelve null — el server rechazará al intentar aceptar y mostramos
// el error ahí.
const decodePayload = token => {
  try {
    const [, b64] = token.split('.');
    if (!b64) return null;
    const normalized = b64.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '==='.slice((normalized.length + 3) % 4);
    const json = typeof atob !== 'undefined' ? atob(padded) : Buffer.from(padded, 'base64').toString();
    return JSON.parse(json);
  } catch (_e) {
    return null;
  }
};

const AcceptInvitePage = () => {
  const location = useLocation();
  const history = useHistory();
  const scrollingDisabled = useSelector(isScrollingDisabled);
  const currentUser = useSelector(state => state.user?.currentUser);
  const currentUserEmail = String(currentUser?.attributes?.email || '').toLowerCase();

  const params = new URLSearchParams(location.search);
  const token = params.get('token') || '';
  const payload = token ? decodePayload(token) : null;

  const [state, setState] = useState({ busy: false, error: null, done: false });

  if (!token) {
    return (
      <Page title="Invitación inválida" scrollingDisabled={scrollingDisabled} noIndex>
        <LayoutSingleColumn
          topbar={<TopbarContainer />}
          footer={<FooterContainer />}
          mainColumnClassName={css.main}
        >
          <div className={css.card}>
            <H2 as="h1">Invitación inválida</H2>
            <p>El link que seguiste no incluye un token de invitación. Pídele al administrador que te mande el link completo.</p>
          </div>
        </LayoutSingleColumn>
      </Page>
    );
  }

  // Si no hay user logueado, mandar a login preservando el link.
  if (!currentUser?.id?.uuid) {
    const back = encodeURIComponent(`${location.pathname}${location.search}`);
    return <NamedRedirect name="LoginPage" search={`?from=${back}`} />;
  }

  const tokenEmail = String(payload?.sub || '').toLowerCase();
  const emailMismatch = tokenEmail && currentUserEmail && tokenEmail !== currentUserEmail;

  const roleLabel = payload?.roleName ? ROLE_PRESETS[payload.roleName]?.label : null;

  const accept = async () => {
    setState({ busy: true, error: null, done: false });
    const r = await api('/api/team/accept-invite', { method: 'POST', body: { token } });
    if (!r.ok) {
      const msg = {
        expired: 'Esta invitación expiró. Pídele al administrador que te mande una nueva.',
        invalid_signature: 'El link no es válido. Pídele al administrador que te mande uno nuevo.',
        invalid_shape: 'El link no es válido.',
        email_mismatch: 'El email del link no coincide con tu cuenta. Cierra sesión y entra con el email correcto.',
        invite_not_found: 'No encontramos esta invitación. Puede haberse cancelado.',
        already_accepted_or_revoked: 'Esta invitación ya se usó o fue revocada.',
        unauthenticated: 'Debes iniciar sesión primero.',
      }[r.data?.error] || `Error: ${r.data?.error || 'desconocido'}`;
      setState({ busy: false, error: msg, done: false });
      return;
    }
    setState({ busy: false, error: null, done: true });
    setTimeout(() => history.push('/dashboard?section=equipo&welcome=team'), 1500);
  };

  return (
    <Page title="Aceptar invitación" scrollingDisabled={scrollingDisabled} noIndex>
      <LayoutSingleColumn
        topbar={<TopbarContainer />}
        footer={<FooterContainer />}
        mainColumnClassName={css.main}
      >
        <div className={css.card}>
          <H2 as="h1">Te invitaron a un equipo en Xololo</H2>

          {emailMismatch ? (
            <div className={css.warning}>
              <strong>⚠️ Email no coincide.</strong> El link fue enviado a <code>{tokenEmail}</code>{' '}
              pero tu sesión actual es <code>{currentUserEmail}</code>. Cierra sesión y entra con la cuenta correcta para aceptar.
            </div>
          ) : null}

          {payload?.adminEmail ? (
            <p className={css.lead}>
              <strong>{payload.adminEmail}</strong> te invitó a administrar su tienda con el rol{' '}
              <strong>{roleLabel || payload.roleName}</strong>.
            </p>
          ) : (
            <p className={css.lead}>
              Un vendedor de Xololo te invitó a su equipo con el rol{' '}
              <strong>{roleLabel || payload?.roleName}</strong>.
            </p>
          )}

          {Array.isArray(payload?.permissions) && payload.permissions.length > 0 ? (
            <section className={css.perms}>
              <h3>Podrás hacer en esa tienda:</h3>
              <ul>
                {payload.permissions.map(p => (
                  <li key={p}>
                    <strong>{PERMISSION_META[p]?.label || p}</strong>
                    {PERMISSION_META[p]?.hint ? (
                      <span className={css.permHint}> — {PERMISSION_META[p].hint}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <p className={css.legal}>
            Al aceptar entiendes que operarás esa tienda siguiendo las instrucciones del administrador,
            que todas tus acciones quedan registradas en el audit log, y que el administrador puede
            revocar tu acceso en cualquier momento.
          </p>

          {state.error ? <p className={css.error}>{state.error}</p> : null}
          {state.done ? (
            <div className={css.success}>
              ✓ Listo. Te llevamos al Dashboard…
            </div>
          ) : (
            <div className={css.actions}>
              <PrimaryButton
                type="button"
                onClick={accept}
                inProgress={state.busy}
                disabled={state.busy || emailMismatch}
              >
                {state.busy ? (
                  <>
                    <IconSpinner /> Aceptando…
                  </>
                ) : (
                  'Aceptar invitación'
                )}
              </PrimaryButton>
            </div>
          )}
        </div>
      </LayoutSingleColumn>
    </Page>
  );
};

export default AcceptInvitePage;
