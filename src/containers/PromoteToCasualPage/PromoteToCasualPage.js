import React, { useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useHistory } from 'react-router-dom';

import { FormattedMessage } from '../../util/reactIntl';
import { isScrollingDisabled } from '../../ducks/ui.duck';
import { ensureCurrentUser } from '../../util/data';
import { SELLER_MODES, isCasualReseller as checkIsCasual } from '../../util/xololoSellerMode';
import { PERSON_TYPES, buildTaxProfilePayload } from '../../util/xololoTaxProfile';
import { updateProfile } from '../ManageAccountPage/ManageAccountPage.duck';

import {
  H3,
  LayoutSingleColumn,
  NamedRedirect,
  Page,
  PrimaryButton,
  FieldCheckbox,
} from '../../components';
import { Form as FinalForm } from 'react-final-form';
import TopbarContainer from '../TopbarContainer/TopbarContainer';
import FooterContainer from '../FooterContainer/FooterContainer';

import css from './PromoteToCasualPage.module.css';

// XOLOLO: página puente para que un buyer logueado se convierta en
// vendedor casual (segunda mano particular) con 1 click + aceptación
// de T&C. Se setea publicData.sellerMode='casual_reseller' + un perfil
// fiscal particular firmado. Al terminar redirige al wizard de nuevo
// listing para que publique de inmediato.
//
// Entry points:
//   - UsedGoodsBand (CTA "Activar modo casual") cuando user logueado
//     pero no es casual.
//   - Links directos desde emails o notificaciones.
//
// Nunca para visitantes no logueados: ellos van a /signup?sellerMode=
// casual_reseller donde ya hay un radio preseleccionado.

const PromoteToCasualPage = () => {
  const dispatch = useDispatch();
  const history = useHistory();
  const scrollingDisabled = useSelector(isScrollingDisabled);
  const currentUser = useSelector(state => state.user?.currentUser);
  const user = ensureCurrentUser(currentUser);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  // Si no hay user, mando a signup con param — ya es un flow conocido.
  if (currentUser && !currentUser.id) {
    return <NamedRedirect name="SignupPage" />;
  }

  // Si ya es casual, no tiene sentido quedarse aquí.
  if (user?.id && checkIsCasual(user)) {
    return <NamedRedirect name="NewListingPage" />;
  }

  const handleConvert = async values => {
    if (!values?.acceptTerms) {
      setError('Debes aceptar los términos para continuar.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const existingPublic = user?.attributes?.profile?.publicData || {};
      const existingProtected = user?.attributes?.profile?.protectedData || {};
      await dispatch(
        updateProfile({
          publicData: {
            ...existingPublic,
            sellerMode: SELLER_MODES.CASUAL_RESELLER,
          },
          protectedData: {
            ...existingProtected,
            xololoTaxProfile: buildTaxProfilePayload({
              personType: PERSON_TYPES.INDIVIDUAL,
              hasRfc: false,
            }),
          },
        })
      );
      // Al terminar vamos directo al wizard de nuevo listing.
      history.push('/l/new');
    } catch (e) {
      setSubmitting(false);
      setError('No pudimos activar tu modo vendedor casual. Intenta de nuevo.');
    }
  };

  return (
    <Page title="Activar vendedor casual" scrollingDisabled={scrollingDisabled} noIndex>
      <LayoutSingleColumn topbar={<TopbarContainer />} footer={<FooterContainer />}>
        <main className={css.main}>
          <H3 as="h1" className={css.heading}>
            Publica tus cosas usadas en 1 clic
          </H3>
          <p className={css.lead}>
            Vas a activar tu modo <strong>Vendedor casual</strong>. Es gratis, no abre tienda ni te
            cobra mensualidad. Puedes publicar tu primer anuncio ahora mismo y completar lo
            administrativo (cuenta de cobro y documentos){' '}
            <strong>cuando aparezca tu primer comprador</strong> — mientras tanto el pago queda
            retenido por Xololo.
          </p>

          <ul className={css.benefits}>
            <li>
              <strong>Sin suscripción</strong> — publicas sin pagar nada.
            </li>
            <li>
              <strong>Sin IVA ni retención ISR</strong> en tus ventas de segunda mano (Art. 9 fracc.
              IV LIVA — venta particular ocasional).
            </li>
            <li>
              <strong>Pago protegido</strong> — Xololo retiene el dinero del comprador hasta que
              confirmas la entrega.
            </li>
            <li>
              Antes de recibir tu <strong>primer pago</strong> te pediremos identificación oficial
              (frente + reverso) y comprobante de domicilio. Nada más.
            </li>
          </ul>

          <FinalForm
            onSubmit={handleConvert}
            render={({ handleSubmit, values }) => (
              <form onSubmit={handleSubmit} className={css.form}>
                <div className={css.declaration}>
                  <FieldCheckbox
                    id="acceptTerms"
                    name="acceptTerms"
                    label={
                      <>
                        Declaro bajo protesta de decir verdad que vendo mis propios bienes usados de
                        forma ocasional y que no realizo actividad empresarial. Acepto los{' '}
                        <a href="/p/terminos" target="_blank" rel="noreferrer">
                          Términos y Condiciones
                        </a>{' '}
                        y asumo la responsabilidad ante el SAT por mi clasificación fiscal.
                      </>
                    }
                  />
                </div>

                {error ? <p className={css.error}>{error}</p> : null}

                <PrimaryButton
                  type="submit"
                  inProgress={submitting}
                  disabled={!values?.acceptTerms || submitting}
                  className={css.cta}
                >
                  Activar y publicar mi primer artículo
                </PrimaryButton>
              </form>
            )}
          />

          <p className={css.footnote}>
            Si en algún momento empiezas a vender como negocio (habitualmente o con actividad
            empresarial), deberás desactivar el modo casual y dar de alta tu RFC. Esta es tu
            responsabilidad.
          </p>
        </main>
      </LayoutSingleColumn>
    </Page>
  );
};

export default PromoteToCasualPage;
