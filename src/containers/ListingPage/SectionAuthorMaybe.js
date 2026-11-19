import React from 'react';
import { FormattedMessage } from '../../util/reactIntl';
import {
  isInquiryProcessAlias,
  isNegotiationProcessAlias,
  OFFER,
} from '../../transactions/transaction';

import { Heading, Modal, CommunityBadges } from '../../components';
import UserCard from './UserCard/UserCard';
import InquiryForm from './InquiryForm/InquiryForm';

import css from './ListingPage.module.css';

const CONTACT_USER_LINK = 'inquiryModalContactUserLink';

const SectionAuthorMaybe = props => {
  const {
    title,
    listing,
    authorDisplayName,
    onContactUser,
    isInquiryModalOpen,
    onCloseInquiryModal,
    sendInquiryError,
    sendInquiryInProgress,
    onSubmitInquiry,
    currentUser,
    onManageDisableScrolling,
    // XOLOLO · E9: en modo colaborador (workspace activo) el user no
    // puede iniciar una inquiry — opera como el Negocio, no como
    // comprador. Ocultamos el botón "Contactar al proveedor".
    isBuyingBlocked = false,
  } = props;

  if (!listing.author) {
    return null;
  }

  const transactionProcessAlias = listing?.attributes?.publicData?.transactionProcessAlias || '';
  const unitType = listing?.attributes?.publicData?.unitType || '';
  const isInquiryProcess = isInquiryProcessAlias(transactionProcessAlias);
  const isNegotiationProcess = isNegotiationProcessAlias(transactionProcessAlias);
  const showContact =
    !isBuyingBlocked &&
    !(isInquiryProcess || (isNegotiationProcess && unitType === OFFER));

  return (
    <section id="author" className={css.sectionAuthor}>
      <Heading as="h2" rootClassName={css.sectionHeadingWithExtraMargin}>
        <FormattedMessage id="ListingPage.aboutProviderTitle" />
      </Heading>
      <UserCard
        user={listing.author}
        currentUser={currentUser}
        onContactUser={onContactUser}
        showContact={showContact}
        contactLinkId={CONTACT_USER_LINK}
      />
      {/* XOLOLO 2026-11-18 — ADR-006 PR-8: chips de comunidades del
          author. Click lleva a /comunidad|region|programa/:slug. Si
          el author no pertenece a ninguna comunidad publicada, no
          renderiza nada. */}
      <CommunityBadges profile={listing.author?.attributes?.profile} />
      <Modal
        id="ListingPage.inquiry"
        contentClassName={css.inquiryModalContent}
        isOpen={isInquiryModalOpen}
        onClose={onCloseInquiryModal}
        usePortal
        onManageDisableScrolling={onManageDisableScrolling}
        focusElementId={CONTACT_USER_LINK}
      >
        <InquiryForm
          className={css.inquiryForm}
          submitButtonWrapperClassName={css.inquirySubmitButtonWrapper}
          listingTitle={title}
          authorDisplayName={authorDisplayName}
          sendInquiryError={sendInquiryError}
          onSubmit={onSubmitInquiry}
          inProgress={sendInquiryInProgress}
        />
      </Modal>
    </section>
  );
};

export default SectionAuthorMaybe;
