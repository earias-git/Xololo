import React from 'react';

// XOLOLO Junta 2026-10-26 §13 + draft legal 2026-10-27:
// Addendum provisional al TOS que establece el marco legal del
// consentimiento del Buyer para operar sin Protección SOS.
//
// Este bloque se renderiza DEBAJO del contenido del asset hospedado
// (Sharetribe Console) mientras el jurídico de Xololo (Ernesto Luna)
// revisa el draft completo. Cuando apruebe el texto final, el contenido
// se mueve al asset hospedado y este componente se elimina.
//
// Fuentes: LFPC Art. 85-86, criterios PROFECO 2026 sobre cláusulas
// abusivas en e-commerce. Ver el draft legal en el Google Doc del
// equipo (compartido con Ernesto 2026-10-27).

const SosConsentAddendum = () => (
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
        margin: '32px 0',
      }}
    />
    <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>
      Protección SOS — Seguro de envío opcional
    </h2>
    <p style={{ fontSize: 12, color: 'var(--colorGrey500, #666)', marginTop: 0 }}>
      Addendum vigente a partir de octubre 2026 · En revisión por el área jurídica
    </p>

    <h3 style={{ fontSize: 17, fontWeight: 700, marginTop: 24 }}>
      1. Qué es la Protección SOS
    </h3>
    <p>
      Xololo ofrece, mediante el servicio de seguro contratado con Skydropx, una
      cobertura opcional que ampara al Buyer frente a daño, robo o extravío del
      paquete ocurridos durante el tránsito con la paquetería contratada. La
      Protección SOS es un servicio adicional y opcional que el Buyer puede
      activar o rechazar en el momento del checkout.
    </p>

    <h3 style={{ fontSize: 17, fontWeight: 700, marginTop: 24 }}>
      2. Costo y precio
    </h3>
    <p>
      El costo de la Protección SOS se calcula conforme a la tarifa vigente de
      Skydropx como un porcentaje del valor declarado del pedido. Xololo aplica
      una utilidad de servicio sobre dicho costo que se refleja en el precio
      final mostrado al Buyer en el checkout, sin cargos ocultos.
    </p>

    <h3 style={{ fontSize: 17, fontWeight: 700, marginTop: 24 }}>
      3. Qué queda cubierto cuando el Buyer SÍ contrata la Protección SOS
    </h3>
    <ul style={{ paddingLeft: 24, marginBottom: 8 }}>
      <li>Daño al paquete durante el tránsito atribuible a la paquetería.</li>
      <li>Robo del paquete durante el tránsito.</li>
      <li>Extravío del paquete por parte de la paquetería.</li>
    </ul>
    <p style={{ fontSize: 13, color: 'var(--colorGrey500, #666)' }}>
      La ejecución del reclamo ante la paquetería la coordina Xololo, con el
      objetivo de obtener la indemnización y procesar el reembolso al Buyer
      conforme a las políticas vigentes de Xololo y de Skydropx.
    </p>

    <h3 style={{ fontSize: 17, fontWeight: 700, marginTop: 24 }}>
      4. Qué queda cubierto SIEMPRE, con o sin Protección SOS
    </h3>
    <p>
      Independientemente de que el Buyer contrate o no la Protección SOS, Xololo
      mantiene vigentes los siguientes derechos del Buyer, consistentes con los
      derechos irrenunciables previstos en la Ley Federal de Protección al
      Consumidor:
    </p>
    <ul style={{ paddingLeft: 24, marginBottom: 8 }}>
      <li>
        Reembolso cuando el Vendedor no efectúe el envío del producto o
        servicio adquirido.
      </li>
      <li>
        Reembolso cuando el producto o servicio entregado no corresponda a lo
        descrito, cotizado o pactado en el listing.
      </li>
      <li>
        Reembolso cuando el producto presente defectos de origen atribuibles al
        Vendedor y no al proceso de envío.
      </li>
      <li>
        Derecho a cancelar la compra en los supuestos previstos por la ley y
        por los Términos y Condiciones generales de Xololo.
      </li>
    </ul>

    <h3 style={{ fontSize: 17, fontWeight: 700, marginTop: 24 }}>
      5. Consecuencias de NO contratar la Protección SOS
    </h3>
    <p>
      Cuando el Buyer decide no contratar la Protección SOS para un pedido
      determinado, dicha decisión aplica únicamente a ese pedido y únicamente
      para los supuestos de daño, robo o extravío del paquete durante el
      tránsito. En esos supuestos:
    </p>
    <ul style={{ paddingLeft: 24, marginBottom: 8 }}>
      <li>
        Xololo no procesará ni ejecutará reclamo ante la paquetería a nombre
        del Buyer.
      </li>
      <li>
        El Buyer podrá presentar reclamación directa ante la paquetería
        contratada, conforme a los términos y plazos de dicha paquetería.
      </li>
      <li>
        Xololo facilitará al Buyer la evidencia operativa del envío (número de
        guía, nombre del carrier, fecha de recolección y entrega, pruebas
        fotográficas que se hayan documentado) para apoyar su reclamo directo.
      </li>
    </ul>
    <p>
      Esta renuncia aplica exclusivamente a reclamos por daño, robo o extravío
      del paquete en tránsito. Los derechos del Buyer descritos en el punto 4
      permanecen vigentes y Xololo los honrará en los supuestos aplicables.
    </p>

    <h3 style={{ fontSize: 17, fontWeight: 700, marginTop: 24 }}>
      6. Forma del consentimiento
    </h3>
    <p>
      Para rechazar la Protección SOS, el Buyer deberá marcar un recuadro
      específico en el checkout que recoge, en términos claros y en el mismo
      flujo de la compra, los efectos descritos en el punto 5. El Buyer puede
      cambiar su decisión antes de confirmar el pago. Xololo conserva en la
      transacción el registro del consentimiento, con fecha y hora, como
      evidencia para efectos de atención a disputas y requerimientos de
      autoridad.
    </p>

    <h3 style={{ fontSize: 17, fontWeight: 700, marginTop: 24 }}>
      7. Umbral del pedido
    </h3>
    <p>
      La opción de contratar la Protección SOS se ofrece a pedidos cuyo valor
      declarado sea igual o mayor a MXN $500. Pedidos de valor menor se envían
      sin cobertura SOS como criterio operativo del servicio, sin que ello
      modifique los derechos irrenunciables del Buyer descritos en el punto 4.
    </p>

    <h3 style={{ fontSize: 17, fontWeight: 700, marginTop: 24 }}>
      8. Vigencia y modificaciones
    </h3>
    <p>
      El presente addendum entra en vigor en octubre de 2026 y forma parte
      integrante de los Términos y Condiciones de Xololo. Xololo podrá
      actualizar su contenido comunicando previamente al usuario los cambios
      que afecten sus derechos. Cualquier modificación sustantiva al alcance de
      la Protección SOS o a los supuestos de reclamo se notificará con la
      antelación razonable y permitirá al Buyer no aceptar los nuevos
      términos conforme a la ley aplicable.
    </p>

    <p
      style={{
        fontSize: 12,
        color: 'var(--colorGrey500, #666)',
        marginTop: 32,
      }}
    >
      Documento publicado el 27 de octubre de 2026. Para consultas o aclaraciones
      sobre la Protección SOS, escribe a soporte@xololo.mx.
    </p>
  </section>
);

export default SosConsentAddendum;
