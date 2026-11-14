import React from 'react';
import { useSelector } from 'react-redux';
import { Helmet } from 'react-helmet-async';

import { isScrollingDisabled } from '../../ducks/ui.duck';
import { Page, LayoutSingleColumn, NamedLink } from '../../components';
import TopbarContainer from '../TopbarContainer/TopbarContainer';
import FooterContainer from '../FooterContainer/FooterContainer';

import css from './NosotrosPage.module.css';

// XOLOLO 2026-11-14 — página pública /nosotros.
//
// Explica quiénes somos y qué perseguimos. Tres objetivos core
// (acordados con el equipo):
//   1. Mejorar la vida del seller — dignificar el oficio del pequeño
//      comerciante / productor mexicano con herramientas que antes
//      solo tenían las grandes marcas (CFDI, logística, antifraude,
//      analítica).
//   2. Mejorar el tejido social — fortalecer la economía circular
//      local: compras entre vecinos, revalorizar la segunda mano,
//      conectar artesanos con mercados nuevos.
//   3. Mejorar la economía del equipo Xololo — ser un negocio sano
//      que sostenga empleo bien pagado y pueda reinvertir en el
//      ecosistema.
//
// El copy de esta página es editable aquí (no viene de Sharetribe
// Console) para que se versione en git y pase code review. Para
// iterar los textos edita las constantes de abajo.

const MISION = {
  title: 'Nuestra misión',
  body:
    'Hacer que el pequeño comercio mexicano venda en línea con las mismas garantías, herramientas y dignidad que las grandes marcas, sin sacrificar márgenes ni perder el control de la relación con sus clientes.',
};

const VISION = {
  title: 'Nuestra visión',
  body:
    'Que en 10 años cualquier persona en México pueda emprender, formalizar y crecer su negocio desde el celular, en minutos, con la misma confianza con la que compra en Amazon pero con el impacto local que genera comprar en el mercado de su colonia.',
};

const VALORES = [
  {
    title: 'Humano primero',
    body:
      'Cuando algo se tuerce hay una persona de Xololo del otro lado del chat. Sin bots, sin tickets perdidos.',
  },
  {
    title: 'Transparencia radical',
    body:
      'Las comisiones, los tiempos de pago y las reglas del juego se publican por adelantado. Nada de letra chica ni cambios silenciosos.',
  },
  {
    title: 'Dinero seguro',
    body:
      'Escrow en todas las operaciones: el dinero se libera al vendedor cuando el comprador confirma la recepción, no antes.',
  },
  {
    title: 'Compliance mexicano',
    body:
      'CFDI, retenciones, IVA y SAT cumplidos de origen. Hecho para el marco fiscal real de México, no copiado de otro país.',
  },
  {
    title: 'Local antes que global',
    body:
      'Priorizamos pagos, paquetería, bancos y entregas con socios mexicanos. Lo que se vende aquí financia empleos aquí.',
  },
];

const OBJETIVOS = [
  {
    eyebrow: 'Objetivo 1',
    title: 'Mejorar la vida del vendedor',
    body:
      'Herramientas que antes solo tenían las grandes marcas — CFDI automático, logística integrada, analítica, antifraude y soporte humano — ahora al alcance de cualquier emprendedor, tendero o productor. Menos tiempo peleando con el sistema, más tiempo vendiendo.',
  },
  {
    eyebrow: 'Objetivo 2',
    title: 'Fortalecer el tejido social',
    body:
      'Cada compra en Xololo apoya a un vecino, revaloriza la reventa de segunda mano, conecta al artesano con compradores que antes no lo encontraban y hace que el dinero se quede circulando dentro de la economía local en vez de salir del país.',
  },
  {
    eyebrow: 'Objetivo 3',
    title: 'Hacer sano al equipo Xololo',
    body:
      'Queremos ser un negocio que sostenga empleo bien pagado, que invierta en su gente, que mejore su propio ecosistema. Un Xololo saludable financia mejores herramientas para los dos primeros objetivos — ese es el ciclo.',
  },
];

const NosotrosPage = () => {
  const scrollingDisabled = useSelector(state => isScrollingDisabled(state));
  const title = 'Nosotros · Xololo';
  const description =
    'Xololo es el marketplace mexicano hecho para que el pequeño comerciante venda en línea con las mismas garantías que las grandes marcas. Conoce nuestra misión, visión y los 3 objetivos que perseguimos.';

  return (
    <Page title={title} scrollingDisabled={scrollingDisabled} description={description}>
      <Helmet>
        <meta name="description" content={description} />
        <meta property="og:title" content={title} />
        <meta property="og:description" content={description} />
      </Helmet>
      <LayoutSingleColumn
        topbar={<TopbarContainer />}
        footer={<FooterContainer />}
        mainColumnClassName={css.main}
      >
        {/* Hero */}
        <section className={css.hero}>
          <div className={css.heroInner}>
            <span className={css.eyebrow}>Nosotros</span>
            <h1 className={css.heroTitle}>
              El marketplace mexicano hecho para quien vende en pequeño.
            </h1>
            <p className={css.heroLead}>
              Creamos Xololo porque creemos que el comercio local se fortalece cuando el pequeño
              vendedor tiene las mismas herramientas que las grandes marcas — y cuando el
              comprador sabe que su dinero está protegido.
            </p>
          </div>
        </section>

        {/* Misión + Visión */}
        <section className={css.section}>
          <div className={css.sectionInner}>
            <div className={css.twoCol}>
              <article className={css.card}>
                <h2 className={css.cardTitle}>{MISION.title}</h2>
                <p className={css.cardBody}>{MISION.body}</p>
              </article>
              <article className={css.card}>
                <h2 className={css.cardTitle}>{VISION.title}</h2>
                <p className={css.cardBody}>{VISION.body}</p>
              </article>
            </div>
          </div>
        </section>

        {/* Valores */}
        <section className={css.sectionAlt}>
          <div className={css.sectionInner}>
            <h2 className={css.sectionTitle}>Nuestros valores</h2>
            <div className={css.valoresGrid}>
              {VALORES.map(v => (
                <article key={v.title} className={css.valueItem}>
                  <h3 className={css.valueTitle}>{v.title}</h3>
                  <p className={css.valueBody}>{v.body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* 3 objetivos */}
        <section className={css.section}>
          <div className={css.sectionInner}>
            <h2 className={css.sectionTitle}>Lo que perseguimos</h2>
            <p className={css.sectionLead}>
              Tres objetivos simultáneos, no uno. Cada decisión de producto los pone en la balanza.
            </p>
            <div className={css.objetivosStack}>
              {OBJETIVOS.map(o => (
                <article key={o.title} className={css.objetivoItem}>
                  <span className={css.objetivoEyebrow}>{o.eyebrow}</span>
                  <h3 className={css.objetivoTitle}>{o.title}</h3>
                  <p className={css.objetivoBody}>{o.body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* CTA final */}
        <section className={css.cta}>
          <div className={css.ctaInner}>
            <h2 className={css.ctaTitle}>¿Quieres formar parte?</h2>
            <p className={css.ctaBody}>
              Si vendes en pequeño, abre tu tienda en Xololo. Si compras, apoya a un vecino.
            </p>
            <div className={css.ctaButtons}>
              <NamedLink name="PlanesPage" className={css.ctaPrimary}>
                Ver planes para vender
              </NamedLink>
              <NamedLink name="SearchPage" className={css.ctaSecondary}>
                Explorar anuncios
              </NamedLink>
            </div>
          </div>
        </section>
      </LayoutSingleColumn>
    </Page>
  );
};

export default NosotrosPage;
