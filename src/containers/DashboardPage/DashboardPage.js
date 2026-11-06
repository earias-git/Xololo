import React from 'react';
import { useSelector } from 'react-redux';
import { useLocation } from 'react-router-dom';

import { isScrollingDisabled } from '../../ducks/ui.duck';
import { getCurrentWorkspace, PERMISSIONS } from '../../util/xololoTeam';

import { H2, LayoutSideNavigation, Page, PayoutGateBanner, TabNav } from '../../components';
import TopbarContainer from '../TopbarContainer/TopbarContainer';
import FooterContainer from '../FooterContainer/FooterContainer';

import DashboardSalesView from './DashboardSalesView';
import DashboardProductsView from './DashboardProductsView';
import DashboardReportsView from './DashboardReportsView';
import DashboardPromoteView from './DashboardPromoteView';
import DashboardTeamView from './DashboardTeamView';
import PendingInvitesBanner from './PendingInvitesBanner';

import css from './DashboardPage.module.css';

// XOLOLO F3 · Dashboard analytics wrapper con navegación entre
// secciones (Ventas, Productos, ...). Cada sección es un componente
// standalone en su archivo, con su propio fetch y estado.
//
// Sub-navegación via query param ?section=... Simple y no requiere
// tocar el routing config.
//
// XOLOLO Tier Empresarial · Fix post-feedback 2026-11-05: cuando el
// user opera como colaborador (currentWorkspace activo), filtramos las
// tabs por permisos del rol — un Catálogo/Vendedor no debe ver Ventas
// ni Reportes ni Equipo porque el server rechazará sus fetches.

// Cada tab declara qué permiso necesita para que un colaborador la vea.
// `requires: null` significa "visible siempre" (incluye al admin).
// El admin (modo propio, sin workspace activo) siempre ve todas.
const SECTIONS = [
  { key: 'ventas', label: 'Ventas', requires: PERMISSIONS.FINANCE },
  { key: 'productos', label: 'Productos', requires: PERMISSIONS.LISTINGS_EDIT },
  { key: 'promote', label: 'Xololear', requires: PERMISSIONS.PROMOTE },
  { key: 'reportes', label: 'Reportes', requires: PERMISSIONS.FINANCE },
  { key: 'equipo', label: 'Equipo', requires: PERMISSIONS.TEAM },
];

const DEFAULT_SECTION = 'ventas';

const filterSectionsForWorkspace = workspace => {
  if (!workspace) return SECTIONS; // admin / modo propio → todas
  const perms = new Set(workspace.permissions || []);
  return SECTIONS.filter(s => !s.requires || perms.has(s.requires));
};

const getSectionFromLocation = (search, visibleSections, fallback) => {
  const params = new URLSearchParams(search || '');
  const s = (params.get('section') || fallback).toLowerCase();
  return visibleSections.some(x => x.key === s) ? s : fallback;
};

const DashboardPage = () => {
  const scrollingDisabled = useSelector(isScrollingDisabled);
  const location = useLocation();
  const currentUser = useSelector(state => state.user?.currentUser);
  const workspace = getCurrentWorkspace(currentUser);
  const visibleSections = filterSectionsForWorkspace(workspace);
  // Default dinámico: si el colaborador no tiene "ventas" (sin FINANCE),
  // cae a la primera tab visible (ej. Productos para Catálogo).
  const defaultSection =
    visibleSections.find(s => s.key === DEFAULT_SECTION)?.key ||
    visibleSections[0]?.key ||
    DEFAULT_SECTION;
  const activeSection = getSectionFromLocation(location.search, visibleSections, defaultSection);
  // Mensajes (Inbox) solo si tiene orders.view — un colaborador Catálogo
  // la necesita, un Finance puro también, un rol sin orders queda sin ella.
  const showInbox =
    !workspace || (workspace.permissions || []).includes(PERMISSIONS.ORDERS_VIEW);

  return (
    <Page title="Mi panel" scrollingDisabled={scrollingDisabled}>
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
              Mi panel
            </H2>
            <TabNav
              rootClassName={css.tabs}
              tabRootClassName={css.tab}
              tabs={[
                ...visibleSections.map(s => ({
                  text: s.label,
                  selected: s.key === activeSection,
                  linkProps: {
                    name: 'DashboardPage',
                    to: {
                      search: s.key === defaultSection ? '' : `?section=${s.key}`,
                    },
                  },
                })),
                ...(showInbox
                  ? [
                      {
                        text: 'Mensajes',
                        selected: false,
                        linkProps: { name: 'InboxPage', params: { tab: 'sales' } },
                      },
                    ]
                  : []),
              ]}
              ariaLabel="Navegación del panel"
            />
          </>
        }
        footer={<FooterContainer />}
      >
        <div className={css.root}>
          {/* XOLOLO: invitaciones de equipo pendientes (lead el user
              a aceptarlas sin tener que volver al email). */}
          <PendingInvitesBanner />
          {/* PayoutGateBanner sólo tiene sentido en modo propio — el
              colaborador no cobra, cobra el admin en SU propia cuenta. */}
          {!workspace ? <PayoutGateBanner variant="default" /> : null}
          {workspace ? (
            <div className={css.collaboratorNotice}>
              <strong>Operando como colaborador de {workspace.sellerDisplayName || 'esta tienda'}.</strong>
              <p>
                Todas las acciones que ejecutes (publicar/editar anuncios, ver órdenes, Xololear)
                aplican al catálogo del Negocio. Los depósitos y la facturación los recibe el
                Negocio en su propia cuenta.
              </p>
            </div>
          ) : null}
          {activeSection === 'productos' ? (
            <DashboardProductsView />
          ) : activeSection === 'promote' ? (
            <DashboardPromoteView />
          ) : activeSection === 'reportes' ? (
            <DashboardReportsView />
          ) : activeSection === 'equipo' ? (
            <DashboardTeamView />
          ) : activeSection === 'ventas' ? (
            <DashboardSalesView />
          ) : null}
        </div>
      </LayoutSideNavigation>
    </Page>
  );
};

export default DashboardPage;
