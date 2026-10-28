// XOLOLO Junta 2026-10-26 §13: catálogo local de productos no aptos
// para paquetería estándar. Mantenible mientras Skydropx no exponga
// una API/catálogo descargable.
//
// IMPORTANTE: este NO es un filtro legal. Si el producto es ilegal
// (armas, drogas, falsificaciones) lo bloquea listingLegalityAi y
// el listing no se publica en absoluto. Este filtro es "¿se puede
// enviar por paquetería estándar?" — un producto legal como una
// orquídea viva o una botella de perfume aerosol no pasa.
//
// Severidades:
//   - prohibited: la paquetería NO puede ir. UI bloquea esa opción,
//     sugiere flete o pickup local.
//   - restricted: puede ir CON condiciones (empaque especial, valor
//     declarado específico, verificación de edad). UI muestra warning
//     con los pasos requeridos.
//   - ok: default, no match.
//
// Las keywords se buscan en: título + descripción + aiAnalysis.tags.
// Match case-insensitive, normalizado sin acentos. Un solo match basta.
//
// Fuentes: help.skydropx.com/articulos-cda/articulos-prohibidos +
// restricciones comunes FedEx/DHL/Estafeta MX + experiencia operativa.

const CATEGORIES = [
  // --- PROHIBIDOS (no se envía por paquetería estándar) ---
  {
    key: 'perishable_fresh_food',
    severity: 'prohibited',
    label: 'Alimentos perecederos frescos',
    keywords: [
      'mariscos',
      'camaron frescos',
      'pescado fresco',
      'carne cruda',
      'carne fresca',
      'pollo crudo',
      'lacteos frescos',
      'queso fresco',
      'yogur',
      'leche fresca',
      'helado',
      'nieve artesanal',
      'pasteleria fresca',
      'postre refrigerado',
      'ceviche',
      'sushi',
      'fruta cortada',
      'ensalada',
      'comida preparada',
    ],
    advice:
      'Los alimentos perecederos frescos requieren cadena de frío y entrega local. Sugiere pickup o entrega a domicilio por tu cuenta.',
  },
  {
    key: 'live_plants_delicate',
    severity: 'prohibited',
    label: 'Plantas vivas delicadas',
    keywords: [
      'orquidea',
      'orquideas',
      'bonsai',
      'cactus en maceta',
      'suculenta en maceta',
      'planta viva',
      'plantas vivas',
      'arbol vivo',
      'palmera viva',
      'anturio viva',
      'anturios vivos',
      'helecho vivo',
    ],
    advice:
      'Las plantas vivas no sobreviven el manejo de paquetería estándar (temperatura, humedad, golpes). Usa flete especializado o pickup local.',
  },
  {
    key: 'live_animals',
    severity: 'prohibited',
    label: 'Animales vivos',
    keywords: [
      'pollito',
      'gallinas vivas',
      'pajaro vivo',
      'pez vivo',
      'peces vivos',
      'tortuga',
      'conejo vivo',
      'perro cachorro',
      'gato cachorro',
      'hamster',
      'iguana',
      'reptil vivo',
      'insecto vivo',
    ],
    advice:
      'Los animales vivos no pueden enviarse por paquetería (riesgo biológico + bienestar). Entrega local únicamente.',
  },
  {
    key: 'flammable_liquids',
    severity: 'prohibited',
    label: 'Líquidos inflamables',
    keywords: [
      'gasolina',
      'thinner',
      'diesel',
      'aguarras',
      'alcohol de 96',
      'solvente',
      'quitaesmalte industrial',
      'pegamento de contacto',
      'cemento de pvc',
      'laca para madera',
      'barniz',
    ],
    advice:
      'Los líquidos inflamables son material peligroso (DOT clase 3). Paquetería estándar los rechaza. Requiere flete especializado o entrega local.',
  },
  {
    key: 'aerosols_pressurized',
    severity: 'prohibited',
    label: 'Aerosoles y gas presurizado',
    keywords: [
      'spray',
      'aerosol',
      'desodorante en spray',
      'perfume en spray',
      'pintura en spray',
      'gas lp',
      'tanque de oxigeno',
      'tanque de buceo',
      'extintor',
      'propano',
      'butano',
      'encendedor recargable',
    ],
    advice:
      'Aerosoles y gases presurizados no viajan por avión y la mayoría de carriers los rechazan. Usa flete terrestre especializado o entrega local.',
  },
  {
    key: 'batteries_loose_lithium',
    severity: 'prohibited',
    label: 'Baterías de litio sueltas',
    keywords: [
      'bateria de litio',
      'baterias de litio',
      'pila recargable 18650',
      'power bank sin dispositivo',
      'bateria externa suelta',
      'bateria de dron',
      'bateria de scooter',
      'bateria de bicicleta electrica',
    ],
    advice:
      'Baterías de litio sueltas (sin dispositivo) tienen restricciones estrictas de la IATA. Carrier rechaza o cobra extra. Usa flete terrestre o entrega local.',
  },
  {
    key: 'firearms_ammo',
    severity: 'prohibited',
    label: 'Armas y municiones',
    keywords: [
      'arma de fuego',
      'pistola',
      'rifle',
      'escopeta',
      'municion',
      'cartuchos',
      'cargador de arma',
      'polvora',
    ],
    advice:
      'Las armas y municiones requieren permiso SEDENA y traslado especializado. Prohibidos en Xololo (ver filtro legal).',
  },
  {
    key: 'cash_jewelry_unlisted',
    severity: 'prohibited',
    label: 'Efectivo, metales preciosos, joyería sin declarar',
    keywords: [
      'efectivo',
      'billetes',
      'dinero en efectivo',
      'oro fisico',
      'plata fisica',
      'lingote',
      'moneda de oro',
      'moneda de plata',
    ],
    advice:
      'Efectivo y metales preciosos no son asegurables por paquetería estándar. Entrega bajo custodia o notarial.',
  },

  // --- RESTRINGIDOS (van con empaque especial / warning) ---
  {
    key: 'glass_fragile_large',
    severity: 'restricted',
    label: 'Vidrio frágil grande',
    keywords: [
      'cristaleria',
      'vitral',
      'espejo grande',
      'ventana',
      'botellon',
      'vidrio soplado grande',
      'cuadro con vidrio',
    ],
    advice:
      'Vidrio grande requiere empaque reforzado (foam estructural, caja de madera, señales FRÁGIL). Declara valor completo para que SOS cubra.',
  },
  {
    key: 'alcohol_regulated',
    severity: 'restricted',
    label: 'Alcohol / bebidas con grado',
    keywords: [
      'vino',
      'vinos',
      'cerveza',
      'tequila',
      'mezcal',
      'whisky',
      'ron',
      'ginebra',
      'destilado',
      'licor',
    ],
    advice:
      'Alcohol requiere verificación de edad del destinatario (mayor 18). Carrier debe aceptar entrega bajo firma. Empaque anti-ruptura.',
  },
  {
    key: 'medications_otc',
    severity: 'restricted',
    label: 'Suplementos / medicamentos de venta libre',
    keywords: [
      'suplemento',
      'vitaminas',
      'proteina',
      'colageno',
      'ibuprofeno',
      'paracetamol',
      'homeopatico',
    ],
    advice:
      'Suplementos deben llevar registro COFEPRIS visible en el empaque. Medicamentos de prescripción están prohibidos (filtro legal).',
  },
  {
    key: 'cosmetics_leaky',
    severity: 'restricted',
    label: 'Cosméticos líquidos',
    keywords: [
      'crema facial',
      'serum',
      'tonico',
      'locion',
      'shampoo',
      'acondicionador',
      'gel para cabello',
      'esmalte de uñas',
      'quitaesmalte',
    ],
    advice:
      'Cosméticos líquidos requieren sellado doble (tapa + bolsa plástica) para evitar derrames que dañen otros paquetes.',
  },
  {
    key: 'heavy_bulky',
    severity: 'restricted',
    label: 'Muy pesado o voluminoso',
    keywords: [
      'refrigerador',
      'estufa',
      'lavadora',
      'secadora',
      'colchon king',
      'colchon queen',
      'sillon',
      'escritorio grande',
      'armario',
    ],
    advice:
      'Objetos de más de 25 kg o 1.2 m en cualquier dimensión suelen pasar a flete especializado (sobrecargo). Considera ofrecer flete directo.',
  },
];

// Normaliza string: lowercase + sin acentos.
const normalize = s =>
  String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();

/**
 * Evalúa si un listing es apto para envío por paquetería estándar.
 *
 * @param {Object} params
 * @param {string} params.title - título del listing
 * @param {string} params.description - descripción del listing
 * @param {Object} [params.aiAnalysis] - resultado de IMAGE_ANALYSIS_V1.
 *   Si viene, se usan sus tags.objects / tags.materials / tags.keywords.
 *
 * @returns {{
 *   verdict: 'ok' | 'restricted' | 'prohibited',
 *   matched: Array<{key, label, severity, advice, matchedKeyword}>,
 *   allowedMethods: Array<'skydropxCarrier' | 'freight' | 'pickup' | 'localDelivery'>,
 *   reason: string | null,
 * }}
 */
const evaluateShippingFit = ({ title, description, aiAnalysis } = {}) => {
  const haystack = normalize(
    [
      title,
      description,
      aiAnalysis?.tags?.objects?.join(' '),
      aiAnalysis?.tags?.materials?.join(' '),
      aiAnalysis?.tags?.keywords?.join(' '),
    ]
      .filter(Boolean)
      .join(' ')
  );

  if (!haystack) {
    return {
      verdict: 'ok',
      matched: [],
      allowedMethods: ['skydropxCarrier', 'freight', 'pickup', 'localDelivery'],
      reason: null,
    };
  }

  const matched = [];
  for (const cat of CATEGORIES) {
    for (const kw of cat.keywords) {
      const kwNorm = normalize(kw);
      // Buscamos como "palabra completa" para evitar false positives
      // ("pistol" dentro de "pistola de pintura" sí; "oro" dentro de
      // "doctoro" no — hacemos lookahead de word boundary ASCII).
      const re = new RegExp(`(^|[^a-z0-9])${kwNorm}($|[^a-z0-9])`, 'i');
      if (re.test(haystack)) {
        matched.push({ ...cat, matchedKeyword: kw });
        break;
      }
    }
  }

  if (matched.length === 0) {
    return {
      verdict: 'ok',
      matched: [],
      allowedMethods: ['skydropxCarrier', 'freight', 'pickup', 'localDelivery'],
      reason: null,
    };
  }

  const hasProhibited = matched.some(m => m.severity === 'prohibited');
  const verdict = hasProhibited ? 'prohibited' : 'restricted';

  const allowedMethods = hasProhibited
    ? ['freight', 'pickup', 'localDelivery']
    : ['skydropxCarrier', 'freight', 'pickup', 'localDelivery'];

  const reason = matched.map(m => `${m.label} (match: "${m.matchedKeyword}")`).join(' · ');

  return { verdict, matched, allowedMethods, reason };
};

module.exports = {
  CATEGORIES,
  evaluateShippingFit,
};
