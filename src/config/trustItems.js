// XOLOLO: items de la barra de confianza que aparece justo debajo del hero.
// Cada item se pinta con un ícono SVG chico + título + descripción corta.
// Los íconos son componentes React para poder usar currentColor y ajustar
// stroke/size sin generar copias por tamaño.

import React from 'react';

const shieldPath = (
  <path d="M12 3l7 3v5c0 5-3.4 8.4-7 10-3.6-1.6-7-5-7-10V6l7-3Z" />
);

const truckPath = (
  <>
    <path d="M3 7h11l4 4v6h-2M3 7v10h2M3 7l2-3h9l2 3" />
    <circle cx="7" cy="18" r="1.6" />
    <circle cx="17" cy="18" r="1.6" />
  </>
);

const flagPath = (
  <>
    <path d="M20.8 8.6c0 5-8.8 10.4-8.8 10.4S3.2 13.6 3.2 8.6a4.6 4.6 0 0 1 8.8-1.9 4.6 4.6 0 0 1 8.8 1.9Z" />
  </>
);

const whatsappPath = (
  <path d="M12 2C6.48 2 2 6.48 2 12c0 1.85.5 3.58 1.36 5.07L2 22l5.09-1.33A9.94 9.94 0 0 0 12 22c5.52 0 10-4.48 10-10S17.52 2 12 2Z" />
);

const Icon = ({ children }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {children}
  </svg>
);

const trustItems = [
  {
    id: 'pago-protegido',
    title: 'Pago protegido',
    description: 'Tu dinero se libera hasta que confirmas',
    icon: <Icon>{shieldPath}</Icon>,
  },
  {
    id: 'envios-mexico',
    title: 'Envíos a todo México',
    description: 'Rastreo en tiempo real',
    icon: <Icon>{truckPath}</Icon>,
  },
  {
    id: 'negocios-mx',
    title: 'Hecho por negocios mexicanos',
    description: 'MiPyMEs verificadas en tu ciudad',
    icon: <Icon>{flagPath}</Icon>,
  },
  {
    id: 'whatsapp',
    title: 'Atención por WhatsApp',
    description: 'Soporte humano, no bots',
    icon: <Icon>{whatsappPath}</Icon>,
  },
];

export default trustItems;
