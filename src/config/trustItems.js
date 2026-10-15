// XOLOLO: items de la barra de confianza que aparece justo debajo del hero.
// Cada item se pinta con un ícono SVG chico + título + descripción corta.
// Los íconos son componentes React para poder usar currentColor y ajustar
// stroke/size sin generar copias por tamaño.

import React from 'react';

// Shield con palomita — verificación de identidad
const shieldCheckPath = (
  <>
    <path d="M12 3l7 3v5c0 5-3.4 8.4-7 10-3.6-1.6-7-5-7-10V6l7-3Z" />
    <path d="M9 12l2.2 2.2L15.2 10" />
  </>
);

// Candado — pago protegido
const lockPath = (
  <>
    <rect x="5" y="10" width="14" height="10" rx="2" />
    <path d="M8 10V7a4 4 0 0 1 8 0v3" />
  </>
);

// Hoja con sello — factura automática
const invoicePath = (
  <>
    <path d="M7 3h7l4 4v14H7z" />
    <path d="M14 3v4h4" />
    <path d="M10 13h5M10 17h3" />
  </>
);

// Chat burbuja — soporte humano
const chatPath = (
  <>
    <path d="M20 15a2 2 0 0 1-2 2H8l-4 4V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2Z" />
  </>
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
    id: 'vendedores-verificados',
    title: 'Vendedores verificados',
    description: 'Identidad, RFC y documentos aprobados por Xololo',
    icon: <Icon>{shieldCheckPath}</Icon>,
  },
  {
    id: 'pago-protegido',
    title: 'Pago protegido',
    description: 'Tu dinero se libera cuando confirmas que recibiste',
    icon: <Icon>{lockPath}</Icon>,
  },
  {
    id: 'factura-automatica',
    title: 'Factura automática',
    description: 'CFDI emitido al momento de la compra',
    icon: <Icon>{invoicePath}</Icon>,
  },
  {
    id: 'soporte-real',
    title: 'Soporte real',
    description: 'Chat y WhatsApp humano si algo no sale como esperabas',
    icon: <Icon>{chatPath}</Icon>,
  },
];

export default trustItems;
