import React, { useEffect, useRef, useState } from 'react';
import { useSelector } from 'react-redux';
import { useLocation, useHistory } from 'react-router-dom';

import { apiBaseUrl } from '../../util/api';
import { isScrollingDisabled } from '../../ducks/ui.duck';
import { showCreateListingLinkForUser, showPaymentDetailsForUser } from '../../util/userHelpers';
import { useConfiguration } from '../../context/configurationContext';
import { useIntl } from '../../util/reactIntl';

import {
  H3,
  IconSpinner,
  LayoutSideNavigation,
  NamedRedirect,
  Page,
  UserNav,
} from '../../components';
import { SELLER_MODES, getSellerMode } from '../../util/xololoSellerMode';
import TopbarContainer from '../TopbarContainer/TopbarContainer';
import FooterContainer from '../FooterContainer/FooterContainer';

import { BILLING_PLANS, ONBOARDING_FEE_LABEL, STATUS_LABELS } from '../../config/billingPlans';

import css from './SubscriptionPage.module.css';

// XOLOLO Track C (docs/SUBSCRIPTIONS_V1.md §3): página donde el seller
// elige plan (anual/mensual) y paga vía Stripe Checkout (hosted page,
// redirect completo — no Stripe Elements aquí). Vive dentro de "Mi
// cuenta", entre Mi tienda y Documentos legales (mismo patrón sin
// Redux duck que LegalDocsPage.js).
//
// Flujo:
//   1. GET /api/seller-subscription al montar → estado actual.
//   2. Si no hay suscripción activa: 2 tarjetas de plan, botón
//      "Suscribirme" → POST /api/create-subscription-checkout →
//      redirect a Stripe Checkout (session.url).
//   3. Stripe redirige de vuelta a esta misma página con
//      ?checkout=success&session_id=... → POST /api/seller-subscription
//      { sessionId } confirma el pago y persiste el estado.
//   4. ?checkout=canceled → sólo mostramos aviso, sin llamar nada.

const fetchJson = async (url, opts) => {
  const res = await fetch(url, { credentials: 'include', ...opts });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || 'fetch_failed');
    err.status = res.status;
    throw err;
  }
  return data;
};

const postJson = (url, body) =>
  fetchJson(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

const formatDate = iso => {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleDateString('es-MX', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  } catch (e) {
    return null;
  }
};

const PlanCard = ({ plan, onSubscribe, loading }) => (
  <div className={`${css.planCard} ${plan.highlight ? css.planCardHighlight : ''}`}>
    {plan.highlight ? <span className={css.planBadge}>Recomendado</span> : null}
    <h4 className={css.planName}>{plan.label}</h4>
    <p className={css.planPrice}>
      {plan.priceLabel} <span className={css.planPeriod}>{plan.periodLabel}</span>
    </p>
    <p className={css.planHint}>{plan.hint}</p>
    <button
      type="button"
      className={css.subscribeBtn}
      onClick={() => onSubscribe(plan.key)}
      disabled={loading}
    >
      {loading ? 'Redirigiendo…' : 'Suscribirme'}
    </button>
  </div>
);

// XOLOLO Tier Empresarial · E6.5 — card de upgrade in-place para
// sellers Starter activos. Backend: POST /api/subscription/upgrade-to-enterprise.
const ENTERPRISE_PRICING = {
  annual: { monthly: '$399 MXN/mes', total: '$4,788/año', seat: '$69/mes por extra' },
  monthly: { monthly: '$499 MXN/mes', total: null, seat: '$99/mes por extra' },
};

const COMPARISON_ROWS = [
  { label: 'Storefront con slug', starter: true, enterprise: true },
  { label: 'Verified badge', starter: true, enterprise: true },
  { label: 'Promote / Xololear', starter: true, enterprise: true },
  { label: 'Catálogo recurrente', starter: true, enterprise: true },
  { label: 'Colaboradores con permisos granulares', starter: false, enterprise: 'Hasta 2 incluidos + extras' },
  { label: 'Audit log cross-user del equipo', starter: false, enterprise: true },
  { label: 'Roles preset (Manager, Logística, Finanzas…)', starter: false, enterprise: true },
  { label: 'Panel Equipo en Dashboard', starter: false, enterprise: true },
];

const Check = () => <span style={{ color: '#059669', fontWeight: 700 }}>✓</span>;
const Dash = () => <span style={{ color: '#9ca3af' }}>—</span>;

const UpgradeToEnterpriseCard = ({ billing, onDone }) => {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const pricing = ENTERPRISE_PRICING[billing] || ENTERPRISE_PRICING.monthly;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${apiBaseUrl()}/api/subscription/upgrade-to-enterprise`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => ({}));
      setBusy(false);
      if (!res.ok) {
        const msg =
          {
            no_active_starter: 'No encontramos una suscripción Starter activa para hacer upgrade.',
            already_enterprise: 'Tu cuenta ya es Empresarial.',
            starter_item_not_found_in_stripe:
              'No pudimos encontrar tu plan actual en Stripe. Contacta a soporte.',
            stripe_billing_missing:
              'Stripe no está configurado en este entorno. Contacta a soporte.',
          }[data?.error] || `Error: ${data?.error || 'desconocido'}`;
        setError(msg);
        return;
      }
      setSuccess('✓ ¡Listo! Tu cuenta ahora es Empresarial. Ya puedes invitar colaboradores desde tu Dashboard.');
      setConfirming(false);
      setTimeout(() => onDone?.(), 1200);
    } catch (e) {
      setBusy(false);
      setError(`Error: ${e.message}`);
    }
  };

  return (
    <div className={css.upgradeCard}>
      <div className={css.upgradeHeader}>
        <div>
          <h3 className={css.upgradeTitle}>
            <span aria-hidden="true">🏢</span> Upgrade a Empresarial
          </h3>
          <p className={css.upgradeLead}>
            Suma colaboradores a tu tienda con permisos granulares. Mismo payout, mismas facturas —
            tú sigues siendo el titular.
          </p>
        </div>
        <div className={css.upgradePricing}>
          <strong className={css.upgradePrice}>{pricing.monthly}</strong>
          {pricing.total ? <small>{pricing.total}</small> : null}
          <small className={css.upgradeSeat}>+ {pricing.seat}</small>
        </div>
      </div>

      <table className={css.compareTable}>
        <thead>
          <tr>
            <th />
            <th>Starter actual</th>
            <th className={css.compareHighlight}>Empresarial</th>
          </tr>
        </thead>
        <tbody>
          {COMPARISON_ROWS.map((row, i) => (
            <tr key={i}>
              <td>{row.label}</td>
              <td className={css.compareCell}>
                {row.starter === true ? <Check /> : row.starter === false ? <Dash /> : row.starter}
              </td>
              <td className={`${css.compareCell} ${css.compareHighlight}`}>
                {row.enterprise === true ? (
                  <Check />
                ) : row.enterprise === false ? (
                  <Dash />
                ) : (
                  row.enterprise
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {error ? <p className={css.upgradeError}>{error}</p> : null}
      {success ? <p className={css.upgradeSuccess}>{success}</p> : null}

      {!success ? (
        <div className={css.upgradeActions}>
          {!confirming ? (
            <button type="button" className={css.upgradeCta} onClick={() => setConfirming(true)}>
              Upgrade a Empresarial →
            </button>
          ) : (
            <>
              <p className={css.upgradeConfirmText}>
                Se cobrará prorrateado el cambio de plan en tu próxima factura (Stripe calcula el
                ajuste automáticamente). ¿Confirmar?
              </p>
              <div className={css.upgradeConfirmButtons}>
                <button
                  type="button"
                  className={css.upgradeSecondary}
                  onClick={() => setConfirming(false)}
                  disabled={busy}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  className={css.upgradeCta}
                  onClick={submit}
                  disabled={busy}
                >
                  {busy ? 'Procesando…' : 'Sí, upgradea mi plan'}
                </button>
              </div>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
};

const SubscriptionPageComponent = () => {
  const config = useConfiguration();
  const intl = useIntl();
  const location = useLocation();
  const history = useHistory();
  const scrollingDisabled = useSelector(isScrollingDisabled);
  const currentUser = useSelector(state => state.user?.currentUser || null);

  const [state, setState] = useState({ status: 'loading', data: null, error: null });
  const [checkoutLoading, setCheckoutLoading] = useState(null);
  const [banner, setBanner] = useState(null);
  const confirmedRef = useRef(false);

  // XOLOLO: seller casual no paga suscripción. El redirect va DESPUÉS de
  // los hooks para no romper rules-of-hooks; se evalúa al final antes
  // del render principal.
  const isCasual = !!currentUser?.id && getSellerMode(currentUser) === SELLER_MODES.CASUAL_RESELLER;

  const load = () => {
    setState(s => ({ ...s, status: 'loading' }));
    fetchJson(`${apiBaseUrl()}/api/seller-subscription`).then(
      d => setState({ status: 'ok', data: d, error: null }),
      e => setState({ status: 'error', data: null, error: e.message })
    );
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const checkout = params.get('checkout');
    const sessionId = params.get('session_id');

    if (checkout === 'canceled') {
      setBanner({
        tone: 'info',
        text: 'El pago se canceló — puedes intentarlo de nuevo cuando quieras.',
      });
      history.replace({ pathname: location.pathname });
      return;
    }

    if (checkout === 'success' && sessionId && !confirmedRef.current) {
      confirmedRef.current = true;
      postJson(`${apiBaseUrl()}/api/seller-subscription`, { sessionId }).then(
        () => {
          setBanner({
            tone: 'success',
            text: '¡Suscripción activada! Ya puedes publicar en Xololo.',
          });
          history.replace({ pathname: location.pathname });
          load();
        },
        e => {
          setBanner({
            tone: 'error',
            text: `No pudimos confirmar el pago automáticamente (${e.message}). Si Stripe ya te cobró, contáctanos.`,
          });
          history.replace({ pathname: location.pathname });
        }
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.search]);

  const startCheckout = async planKey => {
    setCheckoutLoading(planKey);
    try {
      const data = await postJson(`${apiBaseUrl()}/api/create-subscription-checkout`, {
        plan: planKey,
      });
      window.location.href = data.url;
    } catch (e) {
      setBanner({ tone: 'error', text: `No se pudo iniciar el pago: ${e.message}` });
      setCheckoutLoading(null);
    }
  };

  const showManageListingsLink = showCreateListingLinkForUser(config, currentUser);
  const { showPayoutDetails, showPaymentMethods } = showPaymentDetailsForUser(config, currentUser);
  const accountSettingsNavProps = {
    currentPage: 'SubscriptionPage',
    showPaymentMethods,
    showPayoutDetails,
  };

  const sub = state.data;
  const isActive = sub?.status === 'active';
  const statusLabel = sub?.status ? STATUS_LABELS[sub.status] : null;

  if (isCasual) {
    return <NamedRedirect name="ManageAccountPage" />;
  }

  return (
    <Page title="Suscripción" scrollingDisabled={scrollingDisabled}>
      <LayoutSideNavigation
        topbar={
          <>
            <TopbarContainer />
            <UserNav
              currentPage="SubscriptionPage"
              showManageListingsLink={showManageListingsLink}
            />
          </>
        }
        sideNav={null}
        useAccountSettingsNav
        accountSettingsNavProps={accountSettingsNavProps}
        footer={<FooterContainer />}
        intl={intl}
      >
        <div className={css.content}>
          <H3 as="h1">Suscripción</H3>
          <p className={css.intro}>
            Tu suscripción es lo que mantiene tu tienda y productos visibles en xololo.mx.
          </p>

          {banner ? (
            <p className={`${css.banner} ${css[`banner--${banner.tone}`]}`}>{banner.text}</p>
          ) : null}

          {state.status === 'loading' ? (
            <div className={css.loading}>
              <IconSpinner />
            </div>
          ) : state.status === 'error' ? (
            <p className={css.errorBox}>No pudimos cargar tu suscripción. {state.error}</p>
          ) : isActive ? (
            <>
              <div className={css.activeCard}>
                <div className={css.activeHead}>
                  <span>
                    Plan {sub.plan === 'annual' ? 'anual' : 'mensual'}
                    {sub.tier === 'enterprise' ? (
                      <span className={css.tierBadge}>🏢 Empresarial</span>
                    ) : null}
                  </span>
                  {statusLabel ? (
                    <span className={`${css.statusPill} ${css[`statusPill--${statusLabel.tone}`]}`}>
                      {statusLabel.text}
                    </span>
                  ) : null}
                </div>
                {sub.currentPeriodEnd ? (
                  <p className={css.activeDetail}>
                    {sub.cancelAtPeriodEnd
                      ? `Se pausa y no se renueva el ${formatDate(sub.currentPeriodEnd)}.`
                      : `Se renueva automáticamente el ${formatDate(sub.currentPeriodEnd)}.`}
                  </p>
                ) : null}
              </div>

              {sub.tier !== 'enterprise' ? (
                <UpgradeToEnterpriseCard
                  billing={sub.plan === 'annual' ? 'annual' : 'monthly'}
                  onDone={load}
                />
              ) : null}
            </>
          ) : (
            <>
              <div className={css.planGrid}>
                {BILLING_PLANS.map(plan => (
                  <PlanCard
                    key={plan.key}
                    plan={plan}
                    onSubscribe={startCheckout}
                    loading={checkoutLoading === plan.key}
                  />
                ))}
              </div>
              {sub?.onboardingFeePaid ? (
                <p className={css.onboardingNoteOk}>
                  ✓ Ya pagaste tu cuota de onboarding anteriormente — no se te va a cobrar de nuevo,
                  sólo el plan que elijas.
                </p>
              ) : (
                <p className={css.onboardingNote}>
                  Ambos planes incluyen una cuota única de onboarding de {ONBOARDING_FEE_LABEL}{' '}
                  (hasta 3 horas de asesoría con un consultor Xololo) — se cobra junto con tu primer
                  pago, no se repite después.
                </p>
              )}
            </>
          )}
        </div>
      </LayoutSideNavigation>
    </Page>
  );
};

export default SubscriptionPageComponent;
