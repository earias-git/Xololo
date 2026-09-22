import React from 'react';
import { useSelector } from 'react-redux';
import { useLocation } from 'react-router-dom';

import { isScrollingDisabled } from '../../ducks/ui.duck';

import {
  H2,
  LayoutSideNavigation,
  Page,
  TabNav,
} from '../../components';
import TopbarContainer from '../TopbarContainer/TopbarContainer';
import FooterContainer from '../FooterContainer/FooterContainer';

import DashboardSalesView from './DashboardSalesView';
import DashboardProductsView from './DashboardProductsView';
import DashboardReportsView from './DashboardReportsView';

import css from './DashboardPage.module.css';

// XOLOLO F3 · Dashboard analytics wrapper con navegación entre
// secciones (Ventas, Productos, ...). Cada sección es un componente
// standalone en su archivo, con su propio fetch y estado.
//
// Sub-navegación via query param ?section=... Simple y no requiere
// tocar el routing config. Presets: ventas, productos. Sprint 4/5
// añadirán 'trafico' y Sprint 6 'reportes'.

const SECTIONS = [
  { key: 'ventas', label: 'Ventas' },
  { key: 'productos', label: 'Productos' },
  { key: 'reportes', label: 'Reportes' },
];

const DEFAULT_SECTION = 'ventas';

const getSectionFromLocation = search => {
  const params = new URLSearchParams(search || '');
  const s = (params.get('section') || DEFAULT_SECTION).toLowerCase();
  return SECTIONS.some(x => x.key === s) ? s : DEFAULT_SECTION;
};

const DashboardPage = () => {
  const scrollingDisabled = useSelector(isScrollingDisabled);
  const location = useLocation();
  const activeSection = getSectionFromLocation(location.search);

  return (
    <Page title="Dashboard" scrollingDisabled={scrollingDisabled}>
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
              Dashboard
            </H2>
            <TabNav
              rootClassName={css.tabs}
              tabRootClassName={css.tab}
              tabs={[
                ...SECTIONS.map(s => ({
                  text: s.label,
                  selected: s.key === activeSection,
                  linkProps: {
                    name: 'DashboardPage',
                    to: {
                      search: s.key === DEFAULT_SECTION ? '' : `?section=${s.key}`,
                    },
                  },
                })),
                {
                  text: 'Inbox',
                  selected: false,
                  linkProps: { name: 'InboxPage', params: { tab: 'sales' } },
                },
              ]}
              ariaLabel="Navegación dashboard"
            />
          </>
        }
        footer={<FooterContainer />}
      >
        <div className={css.root}>
          {activeSection === 'productos' ? (
            <DashboardProductsView />
          ) : activeSection === 'reportes' ? (
            <DashboardReportsView />
          ) : (
            <DashboardSalesView />
          )}
        </div>
      </LayoutSideNavigation>
    </Page>
  );
};

export default DashboardPage;
