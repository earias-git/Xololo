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
//
// Flujo UI (3 pasos):
//   1. Card con tabla comparativa + CTA "Upgrade a Empresarial →"
//   2. Selector de seats extras (0 por default, 2 incluidos siempre)
//   3. Preview del cargo prorrateado + confirmación final
const ENTERPRISE_PRICING = {
  annual: { monthly: '$299 MXN/mes', total: '$3,588/año', seat: '$69/mes por extra' },
  monthly: { monthly: '$499 MXN/mes', total: null, seat: '$99/mes por extra' },
};

// Label para el badge del tier activo.
const TIER_LABEL = {
  starter: 'Starter',
  enterprise: 'Empresarial',
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

const formatMoney = (amount, currency = 'MXN') => {
  const sign = amount < 0 ? '-' : '';
  const abs = Math.abs(Number(amount) || 0);
  return `${sign}$${abs.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
};

const formatPreviewDate = iso => {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('es-MX', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
};

const MAX_SEATS_EXTRA = 20;

const UpgradeToEnterpriseCard = ({ billing, onDone }) => {
  // step: 'compare' → tabla comparativa + CTA (default)
  //       'seats'   → selector de colaboradores extras
  //       'preview' → preview del cargo prorrateado
  const [step, setStep] = useState('compare');
  const [seatsExtra, setSeatsExtra] = useState(0);
  const [preview, setPreview] = useState(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const pricing = ENTERPRISE_PRICING[billing] || ENTERPRISE_PRICING.monthly;

  const translateError = (code, data) =>
    ({
      no_active_starter: 'No encontramos una suscripción Starter activa para hacer upgrade.',
      already_enterprise: 'Tu cuenta ya es Empresarial.',
      starter_item_not_found_in_stripe:
        'No pudimos encontrar tu plan actual en Stripe. Contacta a soporte.',
      stripe_billing_missing: 'Stripe no está configurado en este entorno. Contacta a soporte.',
      prices_not_configured:
        'El plan Empresarial aún no está disponible: faltan Prices en Stripe. Nuestro equipo ya fue notificado.',
      stripe_sdk_outdated:
        'Hay un problema técnico con nuestra integración de Stripe. Contacta a soporte.',
    }[code] || (data?.detail ? `Error: ${data.detail}` : `Error: ${code || 'desconocido'}`));

  const goToSeats = () => {
    setStep('seats');
    setError(null);
  };

  const goToPreview = async () => {
    setStep('preview');
    setLoadingPreview(true);
    setPreview(null);
    setError(null);
    try {
      const res = await fetch(
        `${apiBaseUrl()}/api/subscription/upgrade-preview?seatsExtra=${seatsExtra}`,
        { credentials: 'include' }
      );
      const data = await res.json().catch(() => ({}));
      setLoadingPreview(false);
      if (!res.ok) {
        setError(translateError(data?.error, data));
        return;
      }
      setPreview(data);
    } catch (e) {
      setLoadingPreview(false);
      setError(`Error: ${e.message}`);
    }
  };

  const backToSeats = () => {
    setStep('seats');
    setPreview(null);
    setError(null);
  };

  const cancelAll = () => {
    setStep('compare');
    setPreview(null);
    setError(null);
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${apiBaseUrl()}/api/subscription/upgrade-to-enterprise`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seatsExtra }),
      });
      const data = await res.json().catch(() => ({}));
      setBusy(false);
      if (!res.ok) {
        setError(translateError(data?.error, data));
        return;
      }
      const extrasMsg =
        seatsExtra > 0
          ? ` Compraste ${seatsExtra} ${seatsExtra === 1 ? 'colaborador adicional' : 'colaboradores adicionales'}.`
          : '';
      setSuccess(
        `✓ ¡Listo! Tu cuenta ahora es Empresarial.${extrasMsg} Ya puedes invitar colaboradores desde tu Dashboard.`
      );
      setStep('compare');
      setTimeout(() => onDone?.(), 1800);
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

      {success ? <p className={css.upgradeSuccess}>{success}</p> : null}

      {/* Paso 1: tabla comparativa + CTA inicial */}
      {!success && step === 'compare' ? (
        <div className={css.upgradeActions}>
          <button type="button" className={css.upgradeCta} onClick={goToSeats}>
            Upgrade a Empresarial →
          </button>
        </div>
      ) : null}

      {/* Paso 2: selector de colaboradores extras */}
      {!success && step === 'seats' ? (
        <div className={css.seatsPanel}>
          <h4 className={css.seatsTitle}>¿Cuántos colaboradores adicionales quieres?</h4>
          <p className={css.seatsIntro}>
            Empresarial incluye <strong>2 colaboradores sin costo extra</strong>. Si necesitas
            más, puedes agregarlos ahora y pagarlos prorrateados junto con el upgrade. También
            puedes comprarlos más tarde desde tu Dashboard.
          </p>

          <div className={css.seatsStepper}>
            <button
              type="button"
              className={css.seatsStepBtn}
              onClick={() => setSeatsExtra(n => Math.max(0, n - 1))}
              disabled={seatsExtra <= 0}
              aria-label="Quitar un colaborador"
            >
              −
            </button>
            <div className={css.seatsCount}>
              <strong>{seatsExtra}</strong>
              <small>
                {seatsExtra === 0
                  ? 'solo los 2 incluidos'
                  : seatsExtra === 1
                  ? 'colaborador extra'
                  : 'colaboradores extras'}
              </small>
            </div>
            <button
              type="button"
              className={css.seatsStepBtn}
              onClick={() => setSeatsExtra(n => Math.min(MAX_SEATS_EXTRA, n + 1))}
              disabled={seatsExtra >= MAX_SEATS_EXTRA}
              aria-label="Agregar un colaborador"
            >
              +
            </button>
          </div>

          <p className={css.seatsHint}>
            Total del equipo: hasta <strong>{2 + seatsExtra}</strong> colaboradores · costo
            extra: <strong>{pricing.seat}</strong>
          </p>

          <div className={css.upgradeConfirmButtons}>
            <button
              type="button"
              className={css.upgradeSecondary}
              onClick={cancelAll}
              disabled={busy}
            >
              Cancelar
            </button>
            <button type="button" className={css.upgradeCta} onClick={goToPreview}>
              Ver preview del cargo →
            </button>
          </div>
        </div>
      ) : null}

      {/* Paso 3: preview del cargo prorrateado + confirmación */}
      {!success && step === 'preview' ? (
        <div className={css.previewPanel}>
          <h4 className={css.previewTitle}>Preview del cambio</h4>

          {loadingPreview ? (
            <p className={css.muted}>Calculando el ajuste con Stripe…</p>
          ) : null}

          {error ? <p className={css.upgradeError}>{error}</p> : null}

          {preview ? (
            <>
              {preview.daysRemaining != null ? (
                <p className={css.previewContext}>
                  Te quedan <strong>{preview.daysRemaining} días</strong> del ciclo{' '}
                  {preview.starterPlan === 'annual' ? 'anual' : 'mensual'} actual.
                  {seatsExtra > 0 ? (
                    <>
                      {' '}
                      Incluye{' '}
                      <strong>
                        {seatsExtra}{' '}
                        {seatsExtra === 1 ? 'colaborador extra' : 'colaboradores extras'}
                      </strong>
                      .
                    </>
                  ) : null}
                </p>
              ) : null}

              <table className={css.previewTable}>
                <tbody>
                  {preview.today.lines.map((line, i) => (
                    <tr key={i} className={line.isCredit ? css.previewCredit : ''}>
                      <td>{line.description}</td>
                      <td className={css.previewAmount}>
                        {formatMoney(line.amount, preview.today.currency)}
                      </td>
                    </tr>
                  ))}
                  {preview.today.tax ? (
                    <tr>
                      <td>Impuestos</td>
                      <td className={css.previewAmount}>
                        {formatMoney(preview.today.tax, preview.today.currency)}
                      </td>
                    </tr>
                  ) : null}
                  <tr className={css.previewTotalRow}>
                    <td>
                      <strong>A pagar HOY</strong>
                    </td>
                    <td className={css.previewAmount}>
                      <strong>
                        {formatMoney(preview.today.total, preview.today.currency)}
                      </strong>
                    </td>
                  </tr>
                </tbody>
              </table>

              <p className={css.previewNext}>
                Próxima factura:{' '}
                <strong>
                  {formatMoney(preview.nextRenewal.amount, preview.nextRenewal.currency)}
                </strong>{' '}
                el <strong>{formatPreviewDate(preview.nextRenewal.date)}</strong>
                {seatsExtra > 0 && preview.nextRenewal.seatsAmount ? (
                  <>
                    {' '}
                    (plan {formatMoney(preview.nextRenewal.planAmount, preview.nextRenewal.currency)}{' '}
                    + {seatsExtra} {seatsExtra === 1 ? 'seat' : 'seats'}{' '}
                    {formatMoney(preview.nextRenewal.seatsAmount, preview.nextRenewal.currency)})
                  </>
                ) : null}
                .
              </p>

              <p className={css.previewLegal}>
                Al confirmar aceptas que se emita el cargo adicional de hoy en tu
                método de pago registrado. El CFDI se emitirá manualmente mientras
                terminamos de configurar el PAC — nuestro equipo te lo hace llegar.
              </p>
            </>
          ) : null}

          <div className={css.upgradeConfirmButtons}>
            <button
              type="button"
              className={css.upgradeSecondary}
              onClick={backToSeats}
              disabled={busy}
            >
              ← Cambiar colaboradores
            </button>
            <button
              type="button"
              className={css.upgradeCta}
              onClick={submit}
              disabled={busy || !preview}
            >
              {busy
                ? 'Procesando…'
                : preview
                ? `Sí, hacer upgrade por ${formatMoney(preview.today.total, preview.today.currency)}`
                : 'Cargando…'}
            </button>
          </div>
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
                    {' · '}
                    <strong>{TIER_LABEL[sub.tier] || TIER_LABEL.starter}</strong>
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
