import React from 'react';
import { useSelector } from 'react-redux';
import { Helmet } from 'react-helmet-async';

import { isScrollingDisabled } from '../../ducks/ui.duck';
import { Page, LayoutSingleColumn, NamedLink } from '../../components';
import TopbarContainer from '../TopbarContainer/TopbarContainer';
import FooterContainer from '../FooterContainer/FooterContainer';

import css from './VerifiedPage.module.css';

// XOLOLO: página pública /verified. Explica el programa Xololo Verified
// (qué es, cómo se obtiene, beneficios) y linkea a (a) signup para
// cumplir los requisitos y (b) directorio público /tiendas-verified.
//
// Los requisitos aquí deben mantenerse en sync con los criterios reales
// de server/api-util/sellerVerified.js:computeVerifiedFromUser.
//
// Post-reunión Mario (2026-11-06): los CTAs del landing banner y del
// footer apuntaban a /p/verified (ruta CMS de Sharetribe inexistente)
// → 404. Esta página es la real.

const VERIFIED_CRITERIA = [
  {
    key: 'subscription',
    title: 'Suscripción activa',
    body:
      'El Negocio mantiene su plan Starter o Empresarial al corriente. No aplica a cuentas de segunda mano particular (modo ocasional).',
  },
  {
    key: 'payouts',
    title: 'Cobros configurados',
    body:
      'La cuenta de cobros con Stripe está conectada y activa, así los depósitos de las ventas llegan directo al Negocio sin intermediarios.',
  },
  {
    key: 'profile',
    title: 'Perfil completo',
    body:
      'Nombre, apellido, nombre del Negocio y nombre público de la tienda en línea están completos. Un cliente puede identificar con claridad con quién compra.',
  },
  {
    key: 'legal',
    title: 'Documentos legales aprobados',
    body:
      'Identificación oficial, comprobante de domicilio, constancia de situación fiscal y CURP (según aplique) revisados y aprobados por el equipo Xololo.',
  },
];

const VERIFIED_BENEFITS = [
  {
    title: 'Sello Verified visible en tu tienda en línea y anuncios',
    body:
      'Un badge verde en el storefront y en cada anuncio que indica a tus clientes que pasaste nuestro filtro de identidad y documentos.',
  },
  {
    title: 'Directorio público de tiendas Verified',
    body:
      'Tu tienda aparece en /tiendas-verified con tu logo, descripción y acceso directo — SEO reforzado y descubrimiento orgánico.',
  },
  {
    title: 'Pago protegido activo',
    body:
      'El dinero de cada venta se libera solo cuando el cliente confirma que recibió. Tu cliente compra con la misma confianza que en un marketplace grande.',
  },
  {
    title: 'Mayor conversión',
    body:
      'Los Negocios con sello Verified reportan tasas de confianza más altas al momento del checkout — el badge resuelve la fricción de "¿quién es este vendedor?".',
  },
];

const VerifiedPage = () => {
  const scrollingDisabled = useSelector(isScrollingDisabled);

  return (
    <Page
      title="Xololo Verified — programa de verificación de Negocios"
      scrollingDisabled={scrollingDisabled}
      description="Qué es el sello Xololo Verified, cómo se obtiene y qué beneficios da a tu Negocio."
    >
      <Helmet>
        <meta
          name="description"
          content="Xololo Verified es el programa que certifica identidad, documentos y cobros de los Negocios en Xololo. Compra y vende con quien ya pasó el filtro."
        />
      </Helmet>
      <LayoutSingleColumn
        topbar={<TopbarContainer />}
        footer={<FooterContainer />}
        mainColumnClassName={css.main}
      >
        {/* Hero */}
        <section className={css.hero}>
          <div className={css.heroInner}>
            <span className={css.eyebrow}>Xololo Verified™</span>
            <h1 className={css.title}>
              Compra y vende con quien ya pasó el filtro de confianza.
            </h1>
            <p className={css.subtitle}>
              Cada Negocio con sello Verified tiene su identidad, documentos y cuenta de cobros
              validados por el equipo Xololo. Tu dinero queda protegido hasta que confirmas que
              recibiste lo que pediste.
            </p>
            <div className={css.heroCtas}>
              <NamedLink name="SignupPage" className={css.primaryCta}>
                Quiero ser Verified
              </NamedLink>
              <NamedLink name="TiendasVerifiedPage" className={css.secondaryCta}>
                Ver tiendas Verified →
              </NamedLink>
            </div>
          </div>
        </section>

        {/* Requisitos */}
        <section className={css.section}>
          <h2 className={css.sectionTitle}>Requisitos para obtener el sello</h2>
          <p className={css.sectionLead}>
            Son 4 criterios. Un Negocio obtiene el sello automáticamente en cuanto cumple los 4
            — no hay cola ni aprobación manual adicional. Si dejas de cumplir alguno, el sello
            se retira hasta que lo restituyas.
          </p>
          <ol className={css.criteriaList}>
            {VERIFIED_CRITERIA.map((c, i) => (
              <li key={c.key} className={css.criterion}>
                <span className={css.criterionNumber}>{i + 1}</span>
                <div>
                  <h3 className={css.criterionTitle}>{c.title}</h3>
                  <p className={css.criterionBody}>{c.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        {/* Beneficios */}
        <section className={css.section}>
          <h2 className={css.sectionTitle}>Qué te da el sello</h2>
          <div className={css.benefitsGrid}>
            {VERIFIED_BENEFITS.map(b => (
              <div key={b.title} className={css.benefit}>
                <span className={css.benefitIcon} aria-hidden="true">
                  ✓
                </span>
                <h3 className={css.benefitTitle}>{b.title}</h3>
                <p className={css.benefitBody}>{b.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Confianza para el cliente */}
        <section className={css.sectionAlt}>
          <h2 className={css.sectionTitle}>Si eres cliente, esto te garantiza:</h2>
          <ul className={css.guaranteeList}>
            <li>
              <strong>Identidad real detrás de la tienda</strong> — nada de vendedores anónimos
              con cuenta de dos semanas.
            </li>
            <li>
              <strong>Pago protegido activo</strong> — el dinero queda retenido hasta que
              confirmes recepción del producto o servicio.
            </li>
            <li>
              <strong>Documentos fiscales en regla</strong> — el Negocio puede emitirte CFDI
              válido si lo requieres.
            </li>
            <li>
              <strong>Soporte directo con Xololo</strong> — si algo sale mal, el equipo
              interviene.
            </li>
          </ul>
        </section>

        {/* CTA final */}
        <section className={css.ctaBlock}>
          <h2 className={css.ctaTitle}>Listo para ser Verified</h2>
          <p className={css.ctaLead}>
            Abre tu tienda profesional en Xololo desde $169/mes — sin comisión por venta. Al
            completar suscripción, cobros y documentos, el sello se activa automáticamente.
          </p>
          <div className={css.ctaButtons}>
            <NamedLink name="PlanesPage" className={css.primaryCta}>
              Ver planes
            </NamedLink>
            <NamedLink name="SignupPage" className={css.secondaryCta}>
              Crear mi tienda
            </NamedLink>
          </div>
        </section>
      </LayoutSingleColumn>
    </Page>
  );
};

export default VerifiedPage;
