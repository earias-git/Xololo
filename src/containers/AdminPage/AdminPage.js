import React from 'react';
import { useSelector } from 'react-redux';
import { useLocation } from 'react-router-dom';

import { isScrollingDisabled } from '../../ducks/ui.duck';

import { H2, LayoutSideNavigation, Page, TabNav } from '../../components';
import TopbarContainer from '../TopbarContainer/TopbarContainer';
import FooterContainer from '../FooterContainer/FooterContainer';

import AdminHealthView from './AdminHealthView';
import AdminCatalogView from './AdminCatalogView';
import AdminUsersView from './AdminUsersView';
import AdminTrafficView from './AdminTrafficView';
import AdminDisputesView from './AdminDisputesView';
import AdminSellersView from './AdminSellersView';
import AdminLegalDocsView from './AdminLegalDocsView';

import css from './AdminPage.module.css';

// XOLOLO F3 · Fase 3 (+ ampliación admin): panel interno /admin para
// Ops de Xololo. Server-side gated por XOLOLO_ADMIN_EMAILS. El cliente
// esconde contenido si el fetch inicial devuelve 403 — no gate
// hardcoded en el bundle (evita revelar quién es admin ni permitir
// bypass del gate del server).
//
// Sub-secciones (via ?section=), cada una en su propio archivo:
//   - health    → métricas globales del marketplace (default)
//   - catalog   → #productos, #servicios, crecimiento mensual
//   - users     → buyers activos/dormidos/sin compra, candidatos a seller
//   - traffic   → vistas de listings y storefronts por fuente
//   - disputes  → tx con xololoDispute abierto
//   - sellers   → top sellers por revenue
//
// catalog/users/traffic comparten un solo endpoint (/api/admin/overview,
// cache 10min server-side) — entrar a las 3 tabs seguidas no dispara
// 3 escaneos completos del marketplace.

const SECTIONS = [
  { key: 'health', label: 'Salud del marketplace' },
  { key: 'catalog', label: 'Catálogo' },
  { key: 'users', label: 'Usuarios' },
  { key: 'traffic', label: 'Tráfico' },
  { key: 'disputes', label: 'Disputas activas' },
  { key: 'sellers', label: 'Sellers destacados' },
  { key: 'legal-docs', label: 'Documentos legales' },
];

const DEFAULT_SECTION = 'health';

const getSectionFromLocation = search => {
  const p = new URLSearchParams(search || '');
  const s = (p.get('section') || DEFAULT_SECTION).toLowerCase();
  return SECTIONS.some(x => x.key === s) ? s : DEFAULT_SECTION;
};

const VIEW_BY_SECTION = {
  health: AdminHealthView,
  catalog: AdminCatalogView,
  users: AdminUsersView,
  traffic: AdminTrafficView,
  disputes: AdminDisputesView,
  sellers: AdminSellersView,
  'legal-docs': AdminLegalDocsView,
};

const AdminPage = () => {
  const scrollingDisabled = useSelector(isScrollingDisabled);
  const location = useLocation();
  const active = getSectionFromLocation(location.search);
  const ActiveView = VIEW_BY_SECTION[active] || AdminHealthView;

  return (
    <Page title="Admin · Xololo" scrollingDisabled={scrollingDisabled}>
      <LayoutSideNavigation
        topbar={
          <TopbarContainer
            mobileRootClassName={css.mobileTopbar}
            desktopClassName={css.desktopTopbar}
          />
        }
        sideNav={
          <>
            <H2 as="h1" className={css.title}>
              Admin
            </H2>
            <TabNav
              rootClassName={css.tabs}
              tabRootClassName={css.tab}
              tabs={SECTIONS.map(s => ({
                text: s.label,
                selected: s.key === active,
                linkProps: {
                  name: 'AdminPage',
                  to: {
                    search: s.key === DEFAULT_SECTION ? '' : `?section=${s.key}`,
                  },
                },
              }))}
              ariaLabel="Navegación admin"
            />
          </>
        }
        footer={<FooterContainer />}
      >
        <div className={css.root}>
          <ActiveView />
        </div>
      </LayoutSideNavigation>
    </Page>
  );
};

export default AdminPage;
