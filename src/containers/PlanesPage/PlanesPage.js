// XOLOLO: página pública /planes.
// Tabla comparativa de los 3 tipos de seller con CTAs que llevan a
// signup con sellerMode y plan pre-seleccionados vía query params.
//
// Flujo:
//   - No logueado + "Empezar como Segunda Mano"  → /signup?mode=casual_reseller
//   - No logueado + "Suscribirme Starter"        → /signup?mode=store&plan=annual
//   - No logueado + "Suscribirme Empresarial"    → /signup?mode=store&plan=annual&tier=enterprise
//   - Logueado    → /account/subscription (ve su suscripción actual o
//                   elige una si no tiene).
//
// AuthenticationPage lee los query params en initialValues del
// SignupForm (sellerMode) y persiste `pendingSignupPlan` en
// sessionStorage para que SubscriptionPage lo recoja post-signup.

import React, { useState } from 'react';
import { useSelector } from 'react-redux';

import { useConfiguration } from '../../context/configurationContext';
import { useIntl } from '../../util/reactIntl';
import { isScrollingDisabled } from '../../ducks/ui.duck';

import {
  H1,
  Page,
  LayoutSingleColumn,
  NamedLink,
} from '../../components';
import TopbarContainer from '../TopbarContainer/TopbarContainer';
import FooterContainer from '../FooterContainer/FooterContainer';

import css from './PlanesPage.module.css';

// Precios por plan y ciclo. Mantener en sync con billingPlans.js del
// server (fuente canónica de los montos reales en Stripe) y con la
// tabla ENTERPRISE_PRICING en SubscriptionPage.js.
const PRICES = {
  starter: {
    annual: { amount: '$169', sub: 'MXN/mes · $2,028/año' },
    monthly: { amount: '$229', sub: 'MXN/mes' },
  },
  enterprise: {
    annual: {
      amount: '$299',
      sub: 'MXN/mes · $3,588/año · incluye 2 colaboradores',
    },
    monthly: {
      amount: '$499',
      sub: 'MXN/mes · incluye 2 colaboradores',
    },
  },
};

const SUB_ROW = {
  starter: {
    annual: {
      main: '$169/mes anual',
      detail: '$2,028/año facturado',
    },
    monthly: {
      main: '$229 MXN/mes',
      detail: 'Cancelable cuando quieras',
    },
  },
  enterprise: {
    annual: {
      main: '$299/mes anual',
      detail: '$3,588/año facturado',
    },
    monthly: {
      main: '$499 MXN/mes',
      detail: 'Cancelable cuando quieras',
    },
  },
};

const Check = () => (
  <span className={css.yesMark} aria-label="Incluido">
    ✓
  </span>
);

const Dash = () => (
  <span className={css.noMark} aria-label="No incluido">
    —
  </span>
);

/**
 * Construye el href al signup o a subscription según si el user está
 * logueado y qué plan eligió. Para starter/enterprise también persiste
 * la selección en sessionStorage para que post-signup SubscriptionPage
 * la recoja y pre-seleccione el plan en el checkout.
 */
const buildCtaLink = (planKey, cycle, isLoggedIn) => {
  // Logueado → va directo a su suscripción.
  if (isLoggedIn) {
    return { name: 'SubscriptionPage' };
  }
  // Casual: no requiere plan Stripe, solo persistir el modo. El param
  // sellerMode es el canónico — AuthenticationPage ya lo lee para
  // pre-seleccionar el radio del SignupForm.
  if (planKey === 'casual') {
    return {
      name: 'SignupPage',
      search: '?sellerMode=casual_reseller',
    };
  }
  // Starter / Empresarial: pasa sellerMode, plan y tier (si aplica).
  // Estos tres params se guardan en sessionStorage al cargar el signup
  // y se recuperan desde SubscriptionPage para pre-seleccionar el plan
  // justo después del signup.
  const params = new URLSearchParams({
    sellerMode: 'store',
    plan: cycle,
  });
  if (planKey === 'enterprise') params.set('tier', 'enterprise');
  return {
    name: 'SignupPage',
    search: `?${params.toString()}`,
  };
};

const persistPendingPlan = (planKey, cycle) => {
  if (typeof window === 'undefined' || planKey === 'casual') return;
  try {
    window.sessionStorage.setItem(
      'xololoPendingSignupPlan',
      JSON.stringify({ planKey, cycle, savedAt: Date.now() })
    );
  } catch (_e) {
    // sessionStorage puede fallar en private mode — ignoramos silenciosamente.
  }
};

const CtaLink = ({ planKey, cycle, isLoggedIn, variant, children }) => {
  const link = buildCtaLink(planKey, cycle, isLoggedIn);
  const classes = `${css.planCta} ${
    variant === 'primary' ? css.planCtaPrimary : variant === 'pop' ? css.planCtaPop : ''
  }`;
  const onClick = () => persistPendingPlan(planKey, cycle);
  return (
    <NamedLink
      name={link.name}
      to={link.search ? { search: link.search } : undefined}
      className={classes}
      onClick={onClick}
    >
      {children}
    </NamedLink>
  );
};

const PlanesPageComponent = () => {
  const config = useConfiguration();
  const intl = useIntl();
  const scrollingDisabled = useSelector(isScrollingDisabled);
  const currentUser = useSelector(state => state.user?.currentUser || null);
  const isLoggedIn = !!currentUser?.id;

  const [cycle, setCycle] = useState('annual'); // 'annual' | 'monthly'

  const starter = PRICES.starter[cycle];
  const enterprise = PRICES.enterprise[cycle];
  const starterSub = SUB_ROW.starter[cycle];
  const enterpriseSub = SUB_ROW.enterprise[cycle];

  const title = 'Planes · Xololo';
  const description =
    'Elige el plan correcto para vender en Xololo. Segunda Mano (gratis), Starter o Empresarial.';

  return (
    <Page
      title={title}
      description={description}
      scrollingDisabled={scrollingDisabled}
      schema={{
        '@context': 'http://schema.org',
        '@type': 'WebPage',
        name: title,
        description,
      }}
    >
      <LayoutSingleColumn
        topbar={<TopbarContainer />}
        footer={<FooterContainer />}
      >
        <div className={css.content}>
          <section className={css.hero}>
            <span className={css.eyebrow}>Planes Xololo</span>
            <H1 className={css.h1}>El plan correcto para cada tipo de vendedor</H1>
            <p className={css.lead}>
              Desde particulares que venden lo que ya no usan, hasta equipos empresariales con
              permisos y audit log. Mismo pago protegido, misma plataforma.
            </p>
          </section>

          {/* Toggle anual / mensual */}
          <div className={css.toggleWrap}>
            <div className={css.toggle} role="group" aria-label="Elegir ciclo de facturación">
              <button
                type="button"
                className={`${css.toggleBtn} ${cycle === 'annual' ? css.toggleBtnActive : ''}`}
                aria-pressed={cycle === 'annual'}
                onClick={() => setCycle('annual')}
              >
                Plan anual <span className={css.savePill}>Ahorra</span>
              </button>
              <button
                type="button"
                className={`${css.toggleBtn} ${cycle === 'monthly' ? css.toggleBtnActive : ''}`}
                aria-pressed={cycle === 'monthly'}
                onClick={() => setCycle('monthly')}
              >
                Plan mensual
              </button>
            </div>
          </div>

          {/* Plan cards */}
          <div className={css.plans}>
            {/* Segunda Mano */}
            <div className={css.planCard}>
              <p className={css.planName}>Segunda Mano</p>
              <p className={css.planTagline}>Para particulares que venden lo que ya no usan</p>
              <p className={css.planPrice}>
                <span className={css.planPriceFree}>Gratis</span>
                <small className={css.planSub}>
                  Sin suscripción, pagas comisión solo cuando vendes
                </small>
              </p>
              <CtaLink planKey="casual" cycle={cycle} isLoggedIn={isLoggedIn}>
                Empezar como Segunda Mano
              </CtaLink>
            </div>

            {/* Starter */}
            <div className={css.planCard}>
              <p className={css.planName}>Starter</p>
              <p className={css.planTagline}>
                Para profesionales con tienda y catálogo recurrente
              </p>
              <p className={css.planPrice}>
                {starter.amount}
                <small className={css.planSub}>{starter.sub}</small>
              </p>
              <CtaLink planKey="starter" cycle={cycle} isLoggedIn={isLoggedIn} variant="primary">
                Suscribirme Starter
              </CtaLink>
            </div>

            {/* Empresarial */}
            <div className={`${css.planCard} ${css.planCardRecommended}`}>
              <span className={css.planPill}>Equipos</span>
              <p className={css.planName}>Empresarial</p>
              <p className={css.planTagline}>
                Para equipos con colaboradores y permisos granulares
              </p>
              <p className={css.planPrice}>
                {enterprise.amount}
                <small className={css.planSub}>{enterprise.sub}</small>
              </p>
              <CtaLink planKey="enterprise" cycle={cycle} isLoggedIn={isLoggedIn} variant="pop">
                Suscribirme Empresarial
              </CtaLink>
            </div>
          </div>

          {/* Tabla comparativa */}
          <div className={css.tableWrap}>
            <table className={css.table}>
              <caption className={css.tableCaption}>Comparativa detallada</caption>
              <thead>
                <tr>
                  <th />
                  <th className={css.colHead}>
                    Segunda Mano<small>Gratis</small>
                  </th>
                  <th className={css.colHead}>
                    Starter<small>{cycle === 'annual' ? '$169/mes anual' : '$229 MXN/mes'}</small>
                  </th>
                  <th className={`${css.colHead} ${css.colHeadHighlight}`}>
                    Empresarial
                    <small>{cycle === 'annual' ? '$299/mes anual' : '$499 MXN/mes'}</small>
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr className={css.sectionRow}>
                  <td colSpan={4}>Precio y cargos</td>
                </tr>
                <tr>
                  <th className={css.rowLabel}>Suscripción</th>
                  <td className={css.val}>Sin suscripción</td>
                  <td className={css.val}>
                    {starterSub.main}
                    <span className={css.cellNote}>{starterSub.detail}</span>
                  </td>
                  <td className={`${css.val} ${css.valHighlight}`}>
                    {enterpriseSub.main}
                    <span className={css.cellNote}>{enterpriseSub.detail}</span>
                  </td>
                </tr>
                <tr>
                  <th className={css.rowLabel}>Onboarding (cargo único)</th>
                  <td className={css.val}>
                    <Dash />
                  </td>
                  <td className={css.val}>
                    $499 MXN<span className={css.cellNote}>1a invoice · 3h asesoría</span>
                  </td>
                  <td className={`${css.val} ${css.valHighlight}`}>
                    $499 MXN<span className={css.cellNote}>1a invoice · 3h asesoría</span>
                  </td>
                </tr>
                <tr>
                  <th className={css.rowLabel}>
                    Cargo administrativo por venta
                    <span className={css.cellNoteFaint}>
                      Procesamiento, verificación, pago protegido, soporte
                    </span>
                  </th>
                  <td className={css.val}>
                    $14 + IVA<span className={css.cellNote}>por venta · tarifa plana</span>
                  </td>
                  <td className={css.val}>
                    $14 + IVA<span className={css.cellNote}>por venta · tarifa plana</span>
                  </td>
                  <td className={`${css.val} ${css.valHighlight}`}>
                    $14 + IVA<span className={css.cellNote}>por venta · tarifa plana</span>
                  </td>
                </tr>
                <tr>
                  <th className={css.rowLabel}>
                    Comisión por venta
                    <span className={css.cellNoteFaint}>% sobre el monto de la venta</span>
                  </th>
                  <td className={css.val}>
                    <strong>Escalonado</strong>
                    <span className={css.cellNote}>
                      6% hasta $50,000
                      <br />
                      4% de $50,001 a $100,000
                      <br />
                      2% sobre el excedente
                      <br />+ IVA 16% sobre la comisión
                    </span>
                  </td>
                  <td className={css.val}>
                    <strong style={{ color: '#047857' }}>0%</strong>
                    <span className={css.cellNote}>Incluido en la suscripción</span>
                  </td>
                  <td className={`${css.val} ${css.valHighlight}`}>
                    <strong style={{ color: '#047857' }}>0%</strong>
                    <span className={css.cellNote}>Incluido en la suscripción</span>
                  </td>
                </tr>
                <tr>
                  <th className={css.rowLabel}>
                    Procesador Stripe
                    <span className={css.cellNoteFaint}>Comisión del procesador de pago</span>
                  </th>
                  <td className={css.val}>3.6% + IVA</td>
                  <td className={css.val}>3.6% + IVA</td>
                  <td className={`${css.val} ${css.valHighlight}`}>3.6% + IVA</td>
                </tr>

                <tr className={css.sectionRow}>
                  <td colSpan={4}>Fiscal (SAT / CFDI)</td>
                </tr>
                <tr>
                  <th className={css.rowLabel}>Facturación CFDI</th>
                  <td className={css.val}>
                    No aplica
                    <span className={css.cellNote}>Art. 9 fracc IV LIVA</span>
                  </td>
                  <td className={css.val}>Sí · RFC obligatorio</td>
                  <td className={`${css.val} ${css.valHighlight}`}>Sí · RFC obligatorio</td>
                </tr>
                <tr>
                  <th className={css.rowLabel}>Retención ISR 113-A</th>
                  <td className={css.val}>
                    <Dash />
                    <span className={css.cellNote}>Bien usado no causa</span>
                  </td>
                  <td className={css.val}>1%</td>
                  <td className={`${css.val} ${css.valHighlight}`}>1%</td>
                </tr>
                <tr>
                  <th className={css.rowLabel}>Retención IVA</th>
                  <td className={css.val}>
                    <Dash />
                    <span className={css.cellNote}>Bien usado no causa</span>
                  </td>
                  <td className={css.val}>Según régimen</td>
                  <td className={`${css.val} ${css.valHighlight}`}>Según régimen</td>
                </tr>

                <tr className={css.sectionRow}>
                  <td colSpan={4}>Tienda y visibilidad</td>
                </tr>
                <tr>
                  <th className={css.rowLabel}>Pago protegido al buyer</th>
                  <td className={css.val}>
                    <Check />
                  </td>
                  <td className={css.val}>
                    <Check />
                  </td>
                  <td className={`${css.val} ${css.valHighlight}`}>
                    <Check />
                  </td>
                </tr>
                <tr>
                  <th className={css.rowLabel}>Verified badge</th>
                  <td className={css.val}>
                    <Dash />
                  </td>
                  <td className={css.val}>
                    <Check />
                    <span className={css.cellNote}>Con docs legales</span>
                  </td>
                  <td className={`${css.val} ${css.valHighlight}`}>
                    <Check />
                    <span className={css.cellNote}>Con docs legales</span>
                  </td>
                </tr>
                <tr>
                  <th className={css.rowLabel}>Tienda en línea con nombre público</th>
                  <td className={css.val}>
                    <Dash />
                  </td>
                  <td className={css.val}>
                    <Check />
                  </td>
                  <td className={`${css.val} ${css.valHighlight}`}>
                    <Check />
                  </td>
                </tr>
                <tr>
                  <th className={css.rowLabel}>Promover / Xololear en RRSS</th>
                  <td className={css.val}>
                    <Check />
                    <span className={css.cellNote}>Sin storefront propio</span>
                  </td>
                  <td className={css.val}>
                    <Check />
                  </td>
                  <td className={`${css.val} ${css.valHighlight}`}>
                    <Check />
                  </td>
                </tr>
                <tr>
                  <th className={css.rowLabel}>Catálogo recurrente</th>
                  <td className={css.val}>
                    <Dash />
                    <span className={css.cellNote}>Venta única</span>
                  </td>
                  <td className={css.val}>
                    <Check />
                  </td>
                  <td className={`${css.val} ${css.valHighlight}`}>
                    <Check />
                  </td>
                </tr>
                <tr>
                  <th className={css.rowLabel}>Listings publicados</th>
                  <td className={css.val}>Limitado</td>
                  <td className={css.val}>Sin límite</td>
                  <td className={`${css.val} ${css.valHighlight}`}>Sin límite</td>
                </tr>

                <tr className={css.sectionRow}>
                  <td colSpan={4}>Equipo y permisos</td>
                </tr>
                <tr>
                  <th className={css.rowLabel}>Colaboradores</th>
                  <td className={css.val}>
                    <Dash />
                  </td>
                  <td className={css.val}>
                    <Dash />
                  </td>
                  <td className={`${css.val} ${css.valHighlight}`}>
                    2 incluidos
                    <span className={css.cellNote}>+ $69/$99 por extra</span>
                  </td>
                </tr>
                <tr>
                  <th className={css.rowLabel}>
                    Permisos granulares
                    <span className={css.cellNoteFaint}>
                      Manager · Logística · Finanzas · Soporte
                    </span>
                  </th>
                  <td className={css.val}>
                    <Dash />
                  </td>
                  <td className={css.val}>
                    <Dash />
                  </td>
                  <td className={`${css.val} ${css.valHighlight}`}>
                    <Check />
                  </td>
                </tr>
                <tr>
                  <th className={css.rowLabel}>Audit log cross-user</th>
                  <td className={css.val}>
                    <Dash />
                  </td>
                  <td className={css.val}>
                    <Dash />
                  </td>
                  <td className={`${css.val} ${css.valHighlight}`}>
                    <Check />
                  </td>
                </tr>
                <tr>
                  <th className={css.rowLabel}>Panel Equipo en Mi panel</th>
                  <td className={css.val}>
                    <Dash />
                  </td>
                  <td className={css.val}>
                    <Dash />
                  </td>
                  <td className={`${css.val} ${css.valHighlight}`}>
                    <Check />
                  </td>
                </tr>

                <tr className={css.sectionRow}>
                  <td colSpan={4}>Soporte</td>
                </tr>
                <tr>
                  <th className={css.rowLabel}>Soporte</th>
                  <td className={css.val}>Email</td>
                  <td className={css.val}>Email + chat</td>
                  <td className={`${css.val} ${css.valHighlight}`}>Prioritario</td>
                </tr>
              </tbody>
            </table>
          </div>

          <p className={css.legal}>
            <strong>Nota fiscal.</strong> Segunda Mano aplica al vendedor particular ocasional (Art.
            9 fracc IV LIVA): el bien usado no causa IVA y no procede retención ISR 113-A. Si
            vendes bienes nuevos o lo haces de manera habitual, el tier correcto es Starter o
            Empresarial.
          </p>

          <section className={css.faq}>
            <h2 className={css.faqTitle}>Preguntas frecuentes</h2>

            <details className={css.faqItem}>
              <summary className={css.faqSummary}>¿Puedo cambiar de plan después?</summary>
              <p className={css.faqBody}>
                Sí. Un vendedor Starter puede hacer upgrade a Empresarial en cualquier momento
                desde su página de Suscripción — solo paga la diferencia prorrateada por los días
                restantes del ciclo. El plan Segunda Mano requiere alta como seller profesional
                para subir a Starter.
              </p>
            </details>

            <details className={css.faqItem}>
              <summary className={css.faqSummary}>
                ¿Qué pasa si Segunda Mano empieza a vender mucho?
              </summary>
              <p className={css.faqBody}>
                Si tu actividad deja de ser ocasional (volumen alto, catálogo recurrente, bienes
                nuevos), nuestro equipo te pedirá regularizarte como Starter o Empresarial, por
                cumplimiento fiscal. Te damos aviso antes.
              </p>
            </details>

            <details className={css.faqItem}>
              <summary className={css.faqSummary}>
                ¿Los $499 de onboarding se cobran también si hago upgrade?
              </summary>
              <p className={css.faqBody}>
                No. El cargo de onboarding es único y se cobra solo en el primer pago de tu
                suscripción. Si ya lo pagaste como Starter y haces upgrade a Empresarial, no se
                cobra de nuevo.
              </p>
            </details>

            <details className={css.faqItem}>
              <summary className={css.faqSummary}>¿Qué es Xololear?</summary>
              <p className={css.faqBody}>
                Es la herramienta de promoción en redes sociales de Xololo: genera piezas visuales
                listas para publicar en Instagram, Facebook y WhatsApp con los datos de tu
                producto. Disponible para los tres planes (Segunda Mano puede Xololear pero sin un
                storefront propio).
              </p>
            </details>

            <details className={css.faqItem}>
              <summary className={css.faqSummary}>¿Cómo funcionan los cargos por venta?</summary>
              <p className={css.faqBody}>
                Son <strong>dos conceptos separados</strong> en todos los planes:
              </p>
              <p className={css.faqBody}>
                <strong>1. Cargo administrativo</strong> — <strong>$14 + IVA por cada venta</strong>
                , igual para los tres planes. Cubre procesamiento, verificación, pago protegido y
                soporte.
              </p>
              <p className={css.faqBody}>
                <strong>2. Comisión por venta</strong> — un % sobre el monto de la venta:
              </p>
              <ul>
                <li>
                  <strong>Starter y Empresarial: 0%</strong> (incluida en la suscripción).
                </li>
                <li>
                  <strong>Segunda Mano: escalonado marginal por venta individual</strong>: 6% sobre
                  los primeros $50,000 de esa venta, 4% entre $50,001 y $100,000, y 2% sobre lo que
                  exceda $100,000, siempre + IVA sobre la comisión.
                </li>
              </ul>
              <p className={css.faqBody}>
                En cualquier caso el procesador Stripe cobra aparte 3.6% + IVA sobre el total.
              </p>
            </details>
          </section>
        </div>
      </LayoutSingleColumn>
    </Page>
  );
};

export default PlanesPageComponent;
