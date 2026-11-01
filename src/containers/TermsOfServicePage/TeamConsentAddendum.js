import React from 'react';

// XOLOLO Tier Empresarial · E8 — addendum provisional al TOS que
// establece el marco legal del tier Empresarial (equipos).
//
// Vive en el TOS mientras jurídico (Ernesto) revisa el draft completo.
// Cuando apruebe el texto final, se mueve al asset hospedado y este
// componente se elimina.
//
// Cubre:
//   - Responsabilidad del admin por acciones del equipo.
//   - Titularidad única de Stripe Connect + CFDI al admin.
//   - Audit log como registro probatorio.
//   - Cobros de seats extra prorrateados.
//   - Políticas de pausa, remoción y revocación.

const TeamConsentAddendum = () => (
  <section
    style={{
      maxWidth: 900,
      margin: '48px auto 32px',
      padding: '0 24px',
      color: 'var(--colorGrey700, #333)',
      fontSize: 15,
      lineHeight: 1.6,
    }}
  >
    <hr
      style={{
        border: 0,
        borderTop: '1px solid var(--colorGrey100, #eee)',
        margin: '0 0 24px',
      }}
    />
    <h2 style={{ fontSize: 22, margin: '0 0 12px', color: 'var(--colorGrey900, #111)' }}>
      Addendum — Tier Empresarial y colaboradores
    </h2>
    <p style={{ fontSize: 12, color: 'var(--colorGrey500, #888)', marginTop: 0 }}>
      Vigente desde la activación del tier Empresarial. Este addendum es parte
      integral de los Términos y Condiciones de Xololo.
    </p>

    <h3 style={{ fontSize: 17, marginTop: 24 }}>1. Titularidad y responsabilidad</h3>
    <p>
      El seller que contrata la suscripción Empresarial (el{' '}
      <strong>Administrador</strong>) es el único titular de la cuenta de la
      tienda, de la cuenta Stripe Connect asociada y de las obligaciones
      fiscales ante el SAT. Los Comprobantes Fiscales Digitales por Internet
      (CFDI) se emiten exclusivamente a nombre del Administrador.
    </p>
    <p>
      El Administrador es responsable del contenido publicado y de las
      transacciones ejecutadas por los colaboradores que agregue a su tienda,
      sin perjuicio del régimen de responsabilidad propio de cada colaborador
      por hechos culposos o dolosos.
    </p>

    <h3 style={{ fontSize: 17, marginTop: 24 }}>2. Permisos y acceso</h3>
    <p>
      El Administrador asigna a cada colaborador un rol con permisos atómicos
      específicos. Los permisos pueden modificarse en cualquier momento. El
      permiso de gestión de equipo (<code>team</code>) está reservado
      exclusivamente al Administrador y no puede delegarse. Los pagos y
      payouts de Stripe Connect se depositan únicamente en la cuenta
      registrada por el Administrador.
    </p>

    <h3 style={{ fontSize: 17, marginTop: 24 }}>3. Audit log</h3>
    <p>
      Todas las acciones ejecutadas por colaboradores sobre la tienda quedan
      registradas en un audit log inmutable que el Administrador y Xololo Ops
      pueden consultar. Este registro es evidencia probatoria para efectos de
      disputas internas, reclamaciones de buyers y procedimientos ante
      autoridades, y se conserva durante los plazos fiscales aplicables (5
      años, LISR Art. 30).
    </p>

    <h3 style={{ fontSize: 17, marginTop: 24 }}>4. Cobro de asientos</h3>
    <p>
      La suscripción Empresarial incluye 2 colaboradores en el precio base.
      Cada colaborador adicional se cobra bajo el esquema recurrente del
      asiento (seat): $99 MXN/mes en modalidad mensual o $69 MXN/mes en
      modalidad anual, prorrateado al periodo en curso al momento de la
      invitación. El cobro se mantiene mientras el colaborador exista en
      cualquier estado (<em>invited</em>, <em>active</em> o <em>paused</em>);
      al removerlo (<em>removed</em>), el asiento se libera para una próxima
      invitación sin generar cargo adicional en el periodo. El Administrador
      no obtiene reembolso del seat usado durante el periodo en curso.
    </p>

    <h3 style={{ fontSize: 17, marginTop: 24 }}>
      5. Pausa, remoción y revocación de acceso
    </h3>
    <p>
      El Administrador puede pausar o remover a cualquier colaborador en
      cualquier momento, sin requerir motivo. La remoción es efectiva de
      inmediato: el colaborador pierde el acceso a la tienda sin derecho a
      aviso previo ni indemnización por parte de Xololo. Xololo Ops puede
      suspender tanto a sellers Administradores como a colaboradores
      individuales conforme a las políticas de uso aceptable y a los
      Términos y Condiciones generales.
    </p>

    <h3 style={{ fontSize: 17, marginTop: 24 }}>6. Downgrade a Starter</h3>
    <p>
      El downgrade de la suscripción Empresarial al tier Starter solo es
      posible cuando no existen colaboradores activos (invited, active o
      paused) en la tienda. El cambio surte efecto al término del periodo
      facturable en curso.
    </p>

    <h3 style={{ fontSize: 17, marginTop: 24 }}>7. Transferencia de titularidad</h3>
    <p>
      La titularidad del Administrador es intransferible en la versión v1 de
      este tier. La transferencia de la cuenta a otra persona física o moral
      requerirá un procedimiento de re-onboarding integral que incluye nueva
      cuenta Stripe Connect, nueva validación fiscal y aceptación de términos
      por parte del cesionario.
    </p>

    <h3 style={{ fontSize: 17, marginTop: 24 }}>8. Datos personales</h3>
    <p>
      Al invitar a un colaborador, el Administrador declara que cuenta con el
      consentimiento del titular de los datos personales (correo electrónico)
      para enviarle una invitación por este medio. Xololo trata los datos de
      los colaboradores conforme a su{' '}
      <a href="/privacidad" style={{ color: 'var(--marketplaceColor, #0066cc)' }}>
        Aviso de Privacidad
      </a>
      , en atención a lo dispuesto por la Ley Federal de Protección de Datos
      Personales en Posesión de los Particulares.
    </p>

    <h3 style={{ fontSize: 17, marginTop: 24 }}>9. Modificaciones</h3>
    <p>
      Xololo podrá modificar los montos, los permisos atómicos o los roles
      preset, siempre que lo notifique con al menos 15 días hábiles de
      anticipación por correo electrónico al Administrador. Si no está de
      acuerdo, el Administrador podrá cancelar la suscripción sin penalidad
      antes de que las modificaciones entren en vigor.
    </p>
  </section>
);

export default TeamConsentAddendum;
