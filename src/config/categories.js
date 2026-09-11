import React from 'react';

// XOLOLO: las 10 categorías del mockup del landing. Los `href` apuntan al
// SearchPage filtrando por la categoría correspondiente; ajustar la key
// (`pub_categoryLevel1`) si el listing schema del Console usa otra.
//
// IMPORTANTE: estas categorías son únicamente lo que se muestra en el riel
// visual del landing. Para que los sellers puedan realmente publicar bajo
// cada una, hay que agregarlas también en Sharetribe Console → Listings →
// Categories (o el schema equivalente que use la marketplace).

const Icon = ({ children, viewBox = '0 0 24 24' }) => (
  <svg
    viewBox={viewBox}
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

const categories = [
  {
    id: 'artesanias',
    label: 'Artesanías',
    href: '/s?pub_categoryLevel1=artesanias',
    icon: (
      <Icon>
        <path d="M6 8h12l-1 12H7L6 8Z" />
        <path d="M9 8V6a3 3 0 0 1 6 0v2" />
      </Icon>
    ),
  },
  {
    id: 'hogar',
    label: 'Hogar',
    href: '/s?pub_categoryLevel1=hogar',
    icon: (
      <Icon>
        <path d="M3 11l9-7 9 7" />
        <path d="M5 10v9h14v-9" />
      </Icon>
    ),
  },
  {
    id: 'moda',
    label: 'Moda',
    href: '/s?pub_categoryLevel1=moda',
    icon: (
      <Icon>
        <path d="M8 3l-2 3v14h12V6l-2-3" />
        <path d="M8 3h8" />
      </Icon>
    ),
  },
  {
    id: 'belleza',
    label: 'Belleza',
    href: '/s?pub_categoryLevel1=belleza',
    icon: (
      <Icon>
        <path d="M12 21s-7-4.6-9.3-9A5.3 5.3 0 0 1 12 6a5.3 5.3 0 0 1 9.3 6c-2.3 4.4-9.3 9-9.3 9Z" />
      </Icon>
    ),
  },
  {
    id: 'alimentos',
    label: 'Alimentos',
    href: '/s?pub_categoryLevel1=alimentos',
    icon: (
      <Icon>
        <path d="M4 10h16" />
        <path d="M6 10V6h12v4" />
        <path d="M5 10l1 10h12l1-10" />
      </Icon>
    ),
  },
  {
    id: 'tecnologia',
    label: 'Tecnología',
    href: '/s?pub_categoryLevel1=tecnologia',
    icon: (
      <Icon>
        <rect x="4" y="4" width="16" height="12" rx="1.5" />
        <path d="M9 20h6M12 16v4" />
      </Icon>
    ),
  },
  {
    id: 'mascotas',
    label: 'Mascotas',
    href: '/s?pub_categoryLevel1=mascotas',
    icon: (
      <Icon>
        <circle cx="7" cy="7" r="2" />
        <circle cx="17" cy="7" r="2" />
        <path d="M4 15c0-3 3-4 8-4s8 1 8 4-3 5-8 5-8-2-8-5Z" />
      </Icon>
    ),
  },
  {
    id: 'papeleria',
    label: 'Papelería',
    href: '/s?pub_categoryLevel1=papeleria',
    icon: (
      <Icon>
        <path d="M6 3h9l3 3v15H6z" />
        <path d="M15 3v3h3M9 12h6M9 16h6" />
      </Icon>
    ),
  },
  {
    id: 'turismo',
    label: 'Turismo',
    href: '/s?pub_categoryLevel1=turismo',
    icon: (
      <Icon>
        <path d="M2 12h20" />
        <path d="M5 12a7 5 0 0 0 14 0" />
        <path d="M9 12V7a3 3 0 0 1 6 0v5" />
      </Icon>
    ),
  },
  {
    id: 'servicios-pro',
    label: 'Servicios pro',
    href: '/s?pub_categoryLevel1=servicios-pro',
    icon: (
      <Icon>
        <path d="M9 3h6l1 4H8l1-4Z" />
        <path d="M5 8h14l-1 13H6L5 8Z" />
      </Icon>
    ),
  },
];

export default categories;
