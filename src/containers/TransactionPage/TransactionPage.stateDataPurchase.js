import {
  TX_TRANSITION_ACTOR_CUSTOMER as CUSTOMER,
  TX_TRANSITION_ACTOR_PROVIDER as PROVIDER,
  CONDITIONAL_RESOLVER_WILDCARD,
  ConditionalResolver,
} from '../../transactions/transaction';

/**
 * Get state data against product process for TransactionPage's UI.
 * I.e. info about showing action buttons, current state etc.
 *
 * @param {*} txInfo detials about transaction
 * @param {*} processInfo  details about process
 */
export const getStateDataForPurchaseProcess = (txInfo, processInfo) => {
  const { transaction, transactionRole, nextTransitions } = txInfo;
  const isProviderBanned = transaction?.provider?.attributes?.banned;
  const isShippable = transaction?.attributes?.protectedData?.deliveryMethod === 'shipping';
  const _ = CONDITIONAL_RESOLVER_WILDCARD;

  const {
    processName,
    processState,
    states,
    transitions,
    isCustomer,
    actionButtonProps,
    leaveReviewProps,
  } = processInfo;

  return new ConditionalResolver([processState, transactionRole])
    .cond([states.INQUIRY, CUSTOMER], () => {
      const transitionNames = Array.isArray(nextTransitions)
        ? nextTransitions.map(t => t.attributes.name)
        : [];
      const requestAfterInquiry = transitions.REQUEST_PAYMENT_AFTER_INQUIRY;
      const hasCorrectNextTransition = transitionNames.includes(requestAfterInquiry);
      const showOrderPanel = !isProviderBanned && hasCorrectNextTransition;
      return { processName, processState, showOrderPanel };
    })
    .cond([states.INQUIRY, PROVIDER], () => {
      return { processName, processState, showDetailCardHeadings: true };
    })
    .cond([states.PURCHASED, CUSTOMER], () => {
      // XOLOLO: NO mostramos el botón "Recibí mi pedido" al buyer.
      // La entrega se confirma por 2 vías automáticas:
      //   1. Webhook Skydropx con status='delivered' (paquetería)
      //   2. Código de 6 dígitos que el buyer muestra al chofer/seller
      //      en modo pickup (endpoint /api/verify-pickup-code)
      // Cuando cualquiera dispara, el cron tacit-acceptance transiciona
      // AUTO_MARK_RECEIVED tras 48h si el buyer no respondió encuesta.
      return {
        processName,
        processState,
        showDetailCardHeadings: true,
        showExtraInfo: true,
        // showActionButtons + primaryButtonProps omitidos a propósito
      };
    })
    .cond([states.PURCHASED, PROVIDER], () => {
      const actionButtonTranslationId = isShippable
        ? `TransactionPage.${processName}.${PROVIDER}.transition-mark-delivered.actionButtonShipped`
        : `TransactionPage.${processName}.${PROVIDER}.transition-mark-delivered.actionButton`;

      return {
        processName,
        processState,
        showDetailCardHeadings: true,
        showActionButtons: true,
        primaryButtonProps: actionButtonProps(transitions.MARK_DELIVERED, PROVIDER, {
          actionButtonTranslationId,
        }),
      };
    })
    .cond([states.DELIVERED, CUSTOMER], () => {
      // XOLOLO: en estado DELIVERED, la acción del buyer es responder
      // la encuesta post-entrega (componente PostDeliverySurvey ya en
      // TransactionPage). Ese endpoint dispara MARK_RECEIVED cuando
      // outcome='good', o abre disputa cuando outcome='bad'. No hay
      // botón "Recibí" — la encuesta lo reemplaza.
      // Si el buyer no responde en 48h, cron tacit-acceptance dispara
      // AUTO_MARK_RECEIVED.
      return {
        processName,
        processState,
        showDetailCardHeadings: true,
        showDispute: true,
        // showActionButtons + primaryButtonProps omitidos a propósito
      };
    })
    .cond([states.COMPLETED, _], () => {
      return {
        processName,
        processState,
        showDetailCardHeadings: true,
        showReviewAsFirstLink: true,
        showActionButtons: true,
        primaryButtonProps: leaveReviewProps,
      };
    })
    .cond([states.REVIEWED_BY_PROVIDER, CUSTOMER], () => {
      return {
        processName,
        processState,
        showDetailCardHeadings: true,
        showReviewAsSecondLink: true,
        showActionButtons: true,
        primaryButtonProps: leaveReviewProps,
      };
    })
    .cond([states.REVIEWED_BY_CUSTOMER, PROVIDER], () => {
      return {
        processName,
        processState,
        showDetailCardHeadings: true,
        showReviewAsSecondLink: true,
        showActionButtons: true,
        primaryButtonProps: leaveReviewProps,
      };
    })
    .cond([states.REVIEWED, _], () => {
      return { processName, processState, showDetailCardHeadings: true, showReviews: true };
    })
    .default(() => {
      // Default values for other states
      return { processName, processState, showDetailCardHeadings: true };
    })
    .resolve();
};
