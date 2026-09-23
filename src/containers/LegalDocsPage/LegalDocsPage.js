import React, { useEffect, useRef, useState } from 'react';
import { useSelector } from 'react-redux';

import { apiBaseUrl } from '../../util/api';
import { isScrollingDisabled } from '../../ducks/ui.duck';
import { showCreateListingLinkForUser, showPaymentDetailsForUser } from '../../util/userHelpers';
import { useConfiguration } from '../../context/configurationContext';
import { useIntl } from '../../util/reactIntl';

import { H3, IconSpinner, LayoutSideNavigation, Page, UserNav } from '../../components';
import TopbarContainer from '../TopbarContainer/TopbarContainer';
import FooterContainer from '../FooterContainer/FooterContainer';

import { LEGAL_DOC_SLOTS, slotsForPersonType, STATUS_LABELS } from '../../config/legalDocSlots';

import css from './LegalDocsPage.module.css';

// XOLOLO Track B (docs/SUBSCRIPTIONS_V1.md §2): página donde el seller
// elige su tipo de persona (física/moral) y sube los documentos
// requeridos. Vive dentro de "Mi cuenta" (LayoutSideNavigation +
// useAccountSettingsNav, mismo patrón que ContactDetailsPage/etc).
//
// Sin Redux duck propio — consume los endpoints nuevos directo con
// fetch (mismo estilo que DashboardPage/AdminPage de esta sesión).
// El server resuelve "quién soy" de la cookie de sesión — nunca se
// manda un sellerId desde el cliente.

const fetchJson = async (url, opts) => {
  const res = await fetch(url, { credentials: 'include', ...opts });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || 'fetch_failed');
    err.status = res.status;
    throw err;
  }
  return data;
};

const PersonTypePicker = ({ onChoose, saving }) => (
  <div className={css.pickerCard}>
    <p className={css.pickerHint}>
      Para saber qué documentos pedirte, dinos primero cómo vendes en Xololo.
    </p>
    <div className={css.pickerButtons}>
      <button
        type="button"
        className={css.pickerBtn}
        onClick={() => onChoose('fisica')}
        disabled={saving}
      >
        <strong>Persona física</strong>
        <span>Vendo a título personal</span>
      </button>
      <button
        type="button"
        className={css.pickerBtn}
        onClick={() => onChoose('moral')}
        disabled={saving}
      >
        <strong>Persona moral</strong>
        <span>Vendo a través de una empresa</span>
      </button>
    </div>
  </div>
);

const DocRow = ({ slot, doc, onUpload, uploading }) => {
  const inputRef = useRef(null);
  const status = doc?.status ? STATUS_LABELS[doc.status] : null;

  return (
    <li className={css.docRow}>
      <div className={css.docMain}>
        <p className={css.docLabel}>{slot.label}</p>
        {slot.hint ? <p className={css.docHint}>{slot.hint}</p> : null}
        {doc?.status === 'rejected' && doc.reviewNote ? (
          <p className={css.docRejectNote}>Motivo del rechazo: {doc.reviewNote}</p>
        ) : null}
      </div>
      <div className={css.docAction}>
        {status ? (
          <span className={`${css.statusPill} ${css[`statusPill--${status.tone}`]}`}>
            {status.text}
          </span>
        ) : (
          <span className={`${css.statusPill} ${css['statusPill--missing']}`}>Falta subir</span>
        )}
        {doc?.url ? (
          <a href={doc.url} target="_blank" rel="noreferrer" className={css.viewLink}>
            Ver archivo
          </a>
        ) : null}
        <input
          ref={inputRef}
          type="file"
          accept={slot.accept}
          className={css.hiddenInput}
          onChange={e => {
            const file = e.target.files?.[0];
            if (file) onUpload(slot.key, file);
            e.target.value = '';
          }}
        />
        <button
          type="button"
          className={css.uploadBtn}
          onClick={() => inputRef.current?.click()}
          disabled={uploading === slot.key}
        >
          {uploading === slot.key
            ? 'Subiendo…'
            : doc?.status === 'rejected' || doc?.url
            ? 'Reemplazar'
            : 'Subir'}
        </button>
      </div>
    </li>
  );
};

const LegalDocsPageComponent = () => {
  const config = useConfiguration();
  const intl = useIntl();
  const scrollingDisabled = useSelector(isScrollingDisabled);
  const currentUser = useSelector(state => state.user?.currentUser || null);

  const [state, setState] = useState({ status: 'loading', data: null, error: null });
  const [savingPersonType, setSavingPersonType] = useState(false);
  const [uploading, setUploading] = useState(null);
  const [uploadError, setUploadError] = useState(null);

  const load = () => {
    setState(s => ({ ...s, status: 'loading' }));
    fetchJson(`${apiBaseUrl()}/api/seller-legal-docs`).then(
      d => setState({ status: 'ok', data: d, error: null }),
      e => setState({ status: 'error', data: null, error: e.message })
    );
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const choosePersonType = async personType => {
    setSavingPersonType(true);
    try {
      await fetchJson(`${apiBaseUrl()}/api/seller-legal-docs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ personType }),
      });
      load();
    } catch (e) {
      setState(s => ({ ...s, error: e.message }));
    } finally {
      setSavingPersonType(false);
    }
  };

  const uploadDoc = async (slotKey, file) => {
    setUploadError(null);
    setUploading(slotKey);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const qs = new URLSearchParams({ slot: slotKey, personType: state.data.personType });
      const res = await fetch(`${apiBaseUrl()}/api/upload-legal-doc?${qs.toString()}`, {
        method: 'POST',
        credentials: 'include',
        body: fd,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'upload_failed');
      load();
    } catch (e) {
      setUploadError(`${slotKey}: ${e.message}`);
    } finally {
      setUploading(null);
    }
  };

  const showManageListingsLink = showCreateListingLinkForUser(config, currentUser);
  const { showPayoutDetails, showPaymentMethods } = showPaymentDetailsForUser(config, currentUser);
  const accountSettingsNavProps = {
    currentPage: 'LegalDocsPage',
    showPaymentMethods,
    showPayoutDetails,
  };

  const personType = state.data?.personType || null;
  const requiredSlots = personType ? slotsForPersonType(personType) : [];
  const docs = state.data?.docs || {};

  return (
    <Page title="Documentos legales" scrollingDisabled={scrollingDisabled}>
      <LayoutSideNavigation
        topbar={
          <>
            <TopbarContainer />
            <UserNav currentPage="LegalDocsPage" showManageListingsLink={showManageListingsLink} />
          </>
        }
        sideNav={null}
        useAccountSettingsNav
        accountSettingsNavProps={accountSettingsNavProps}
        footer={<FooterContainer />}
        intl={intl}
      >
        <div className={css.content}>
          <H3 as="h1">Documentos legales</H3>
          <p className={css.intro}>
            Necesitamos verificar algunos documentos antes de activar tu tienda. Xololo los
            revisa manualmente — te avisamos si algo necesita corrección.
          </p>

          {state.status === 'loading' ? (
            <div className={css.loading}>
              <IconSpinner />
            </div>
          ) : state.status === 'error' ? (
            <p className={css.errorBox}>No pudimos cargar tus documentos. {state.error}</p>
          ) : !personType ? (
            <PersonTypePicker onChoose={choosePersonType} saving={savingPersonType} />
          ) : (
            <>
              <div className={css.personTypeBar}>
                <span>
                  Registrado como <strong>{personType === 'fisica' ? 'Persona física' : 'Persona moral'}</strong>
                </span>
                <button
                  type="button"
                  className={css.changeTypeBtn}
                  onClick={() => setState(s => ({ ...s, data: { ...s.data, personType: null } }))}
                  disabled={savingPersonType}
                >
                  Cambiar
                </button>
              </div>
              {uploadError ? <p className={css.errorBox}>{uploadError}</p> : null}
              <ul className={css.docList}>
                {requiredSlots.map(slot => (
                  <DocRow
                    key={slot.key}
                    slot={slot}
                    doc={docs[slot.key]}
                    onUpload={uploadDoc}
                    uploading={uploading}
                  />
                ))}
              </ul>
            </>
          )}
        </div>
      </LayoutSideNavigation>
    </Page>
  );
};

export default LegalDocsPageComponent;
