import React from 'react';
import { useConfiguration } from '../../context/configurationContext';
import loadable from '@loadable/component';

const SectionBuilder = loadable(
  () => import(/* webpackChunkName: "SectionBuilder" */ '../PageBuilder/PageBuilder'),
  {
    resolveComponent: components => components.SectionBuilder,
  }
);

// XOLOLO 2026-11-14: contacto oficial de Xololo. Lo renderizamos fuera
// del footer hosted (Sharetribe Console) para que esté en el repo y
// se pueda versionar + revisar en code review. Si cambias el número de
// WhatsApp, edita WHATSAPP_HREF + XOLOLO_WHATSAPP_LABEL aquí.
const XOLOLO_SUPPORT_EMAIL = 'soporte@xololo.mx';
// Placeholder — cambiar por el número real.
const XOLOLO_WHATSAPP_RAW = '+52 00 0000 0000';
const WHATSAPP_HREF = `https://wa.me/${XOLOLO_WHATSAPP_RAW.replace(/\D/g, '')}`;

const XololoContactBand = () => (
  <div
    style={{
      borderTop: '1px solid rgba(255,255,255,0.08)',
      background: '#0f172a',
      color: '#e2e8f0',
      padding: '14px 24px',
      fontSize: 14,
      lineHeight: 1.4,
      display: 'flex',
      flexWrap: 'wrap',
      gap: 18,
      justifyContent: 'center',
      textAlign: 'center',
    }}
  >
    <span style={{ fontWeight: 600 }}>¿Necesitas ayuda de Xololo?</span>
    <a
      href={`mailto:${XOLOLO_SUPPORT_EMAIL}`}
      style={{ color: '#e2e8f0', textDecoration: 'underline' }}
    >
      {XOLOLO_SUPPORT_EMAIL}
    </a>
    <a
      href={WHATSAPP_HREF}
      target="_blank"
      rel="noopener noreferrer"
      style={{ color: '#e2e8f0', textDecoration: 'underline' }}
    >
      WhatsApp Xololo (soporte y ventas): {XOLOLO_WHATSAPP_RAW}
    </a>
  </div>
);

const FooterComponent = () => {
  const { footer = {}, topbar } = useConfiguration();

  // If footer asset is not set, let's not render Footer at all.
  if (Object.keys(footer).length === 0) {
    return <XololoContactBand />;
  }

  // The footer asset does not specify sectionId or sectionType. However, the SectionBuilder
  // expects sectionId and sectionType in order to identify the section. We add those
  // attributes here before passing the asset to SectionBuilder.
  const footerSection = {
    ...footer,
    sectionId: 'footer',
    sectionType: 'footer',
    linkLogoToExternalSite: topbar?.logoLink,
  };

  return (
    <>
      <SectionBuilder sections={[footerSection]} />
      <XololoContactBand />
    </>
  );
};

// NOTE: if you want to add dynamic data to FooterComponent,
//       you could just connect this FooterContainer to Redux Store
//
// const mapStateToProps = state => {
//   const { currentUser } = state.user;
//   return { currentUser };
// };
// const FooterContainer = compose(connect(mapStateToProps))(FooterComponent);
// export default FooterContainer;

export default FooterComponent;
