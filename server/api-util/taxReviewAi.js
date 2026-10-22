// XOLOLO Track #39: pre-clasificación con IA de las clasificaciones
// fiscales declaradas por sellers.
//
// La IA NO decide por sí sola. Produce una recomendación — verdict +
// razones + confidence — que un operador humano revisa en
// /ops/tax-reviews. Reduce la carga cognitiva al operador y acelera
// la aprobación de los claramente válidos.
//
// Flujo:
//   1. Seller declara en el PricingPanel: "mi producto es Art. 9 IV".
//      → listing.publicData.taxClassification = { code: 'exento_9_iv',
//          reviewStatus: 'pending' }
//   2. Ops abre /ops/tax-reviews → por cada item sin aiReview, se
//      dispara classifyTaxDeclaration() → persiste
//      publicData.taxClassification.aiReview = { verdict, confidence,
//      reasoning, model, classifiedAt }.
//   3. UI muestra el verdict al operador junto al botón Aprobar/Rechazar.
//
// Verdicts posibles (3 niveles, mapeados a semáforo):
//   - 'likely_valid'    → verde. Caso textbook, aprobar sin tocar más.
//   - 'needs_review'    → amarillo. Caso borderline, lee las razones.
//   - 'likely_invalid'  → rojo. Patrón de fraude o incompatibilidad clara.
//
// Confidence: 0-100. Un verdict con confianza <60 se trata como
// 'needs_review' en la UI, aunque el modelo haya dicho 'likely_valid'.

const { chatJson, isConfigured } = require('./aiClient');

// Reglas condensadas que el modelo necesita saber para evaluar.
// Mantener sincronizadas con src/util/xololoTaxClassification.js.
const CATALOG_RULES = `
CÓDIGOS DE CLASIFICACIÓN FISCAL (México):

EXENCIONES LIVA Art. 9:
- exento_9_iv  → Bienes muebles usados vendidos por PARTICULAR de forma
  OCASIONAL. Incompatible con: productos nuevos, sellers que son empresa
  (persona moral o física con actividad empresarial), venta habitual.
  Pierde la exención si el seller hace actividad empresarial.
- exento_9_iii → Libros, revistas u obras del PROPIO AUTOR. El autor
  vende directamente lo que él escribió. NO aplica para una librería
  que revende obras ajenas.

TASA 0% LIVA Art. 2-A:
- tasa_cero_2a_i_a → Animales y vegetales NO industrializados (p.ej.
  frutas y verduras frescas). NO aplica si el producto está procesado.
- tasa_cero_2a_i_b → Alimentos NO procesados (crudos). NO aplica para
  comida preparada, snacks industrializados, bebidas azucaradas.
- tasa_cero_2a_i_d → Ixtle, palma, lechuguilla. Fibras vegetales
  específicas; no cualquier artesanía.
- tasa_cero_2a_i_f → Fertilizantes y plaguicidas AGRÍCOLAS. NO aplica
  para productos domésticos (jardín residencial).
- tasa_cero_2a_i_i → Libros editados por el PROPIO contribuyente
  (editorial que publica sus propios libros).
- tasa_cero_2a_i_j → Toallas sanitarias, tampones y copas menstruales.

EXENCIONES LIVA Art. 15 (SERVICIOS):
- exento_15_iv → Enseñanza con RVOE o preescolar/primaria/etc. con
  autorización SEP. NO aplica para cursos de hobby sin reconocimiento.
- exento_15_xiv → Servicios médicos prestados por quien tiene CÉDULA
  profesional (médico, odontólogo, psicólogo con cédula). NO aplica
  para masajes, terapias alternativas sin cédula médica.
- exento_15_xvi → Regalías del autor por obra inscrita en INDAUTOR.

ACTIVIDADES LISR 113-A (plataformas digitales):
- actividad_transporte → Servicios de transporte terrestre de pasajeros
  o bienes.
- actividad_hospedaje → Servicios de hospedaje (noche en casa, cuarto).

CRITERIOS DE EVALUACIÓN:
1. Coherencia título ↔ clasificación: "iPhone 14 nuevo" declarado como
   exento_9_iv es inválido (no es usado, muy probablemente no es
   particular ocasional).
2. Coherencia descripción ↔ clasificación: pistas en el texto (p.ej.
   "soy distribuidor autorizado") contradicen Art. 9 IV.
3. Coherencia personType ↔ clasificación: una persona moral no puede
   invocar Art. 9 IV (ese es sólo para particulares).
4. Coherencia condition ↔ clasificación: condition='new' con exento_9_iv
   es inválido.
5. Coherencia categoría ↔ clasificación: "ropa nueva" declarada como
   tasa_cero_2a_i_a (vegetales) es evidente inválido.
`.trim();

const SYSTEM_PROMPT = `Eres un auxiliar fiscal para la plataforma Xololo (marketplace mexicano).

Tu trabajo: evaluar si la clasificación fiscal declarada por un seller para su listing es creíble, dudosa, o claramente inválida, ANTES de que un operador humano lo revise. Tu salida sirve de pre-filtro, no reemplaza la revisión humana.

${CATALOG_RULES}

Devuelves SIEMPRE un objeto JSON con esta estructura exacta:
{
  "verdict": "likely_valid" | "needs_review" | "likely_invalid",
  "confidence": <int 0-100>,
  "reasoning": "<2-4 frases en español, directo al punto, sin markdown>",
  "redFlags": ["<flag corto>", "..."]  // array vacío [] si no hay
}

Reglas:
- Nunca inventes información que no esté en el input.
- Si falta información clave para decidir (p.ej. descripción vacía),
  verdict = "needs_review" y menciona qué falta en reasoning.
- "likely_invalid" sólo cuando hay incompatibilidad OBJETIVA (código
  requiere usado y condition=new, código requiere particular y
  personType=moral, categoría obviamente ajena al código).
- "likely_valid" sólo cuando el caso es textbook claro.
- Todo lo demás → "needs_review".`;

const buildUserMessage = ctx => {
  const {
    title,
    description,
    categoryId,
    condition,
    personType,
    sellerMode,
    priceSubunits,
    currency,
    declaredCode,
  } = ctx;
  const pricePesos = Number.isFinite(priceSubunits)
    ? `$${(priceSubunits / 100).toFixed(2)} ${currency || 'MXN'}`
    : 'desconocido';
  return `Evalúa esta declaración fiscal:

Listing:
- Título: ${title || '(sin título)'}
- Descripción: ${description || '(sin descripción)'}
- Categoría: ${categoryId || '(sin categoría)'}
- Condición: ${condition || '(no declarada)'}
- Precio: ${pricePesos}

Seller:
- Tipo de persona: ${personType || '(no declarado)'}
- Modo: ${sellerMode || 'store'}

Clasificación declarada por el seller:
- Código: ${declaredCode}

Decide verdict y responde con el JSON pedido.`;
};

/**
 * Clasifica una declaración fiscal con IA. Devuelve el objeto aiReview
 * listo para persistir en publicData.taxClassification.aiReview, O
 * `null` si no hay IA configurada (falla cerrado — Ops seguirá
 * revisando manualmente sin la ayuda).
 */
const classifyTaxDeclaration = async ctx => {
  if (!isConfigured()) return null;
  if (!ctx?.declaredCode) return null;

  const startedAt = Date.now();
  try {
    const data = await chatJson({
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildUserMessage(ctx) }],
      expectShape: ['verdict', 'confidence', 'reasoning'],
      maxTokens: 400,
    });

    // Normaliza salidas inesperadas.
    const verdictAllowed = new Set(['likely_valid', 'needs_review', 'likely_invalid']);
    const verdict = verdictAllowed.has(data.verdict) ? data.verdict : 'needs_review';
    const confidence = Math.max(0, Math.min(100, Number(data.confidence) || 0));
    // Baja confianza degrada automáticamente a needs_review aunque el
    // modelo haya opinado likely_valid.
    const effectiveVerdict =
      verdict === 'likely_valid' && confidence < 60 ? 'needs_review' : verdict;

    return {
      verdict: effectiveVerdict,
      verdictRaw: verdict !== effectiveVerdict ? verdict : undefined,
      confidence,
      reasoning: String(data.reasoning || '').slice(0, 1000),
      redFlags: Array.isArray(data.redFlags) ? data.redFlags.slice(0, 10) : [],
      model: process.env.XOLOLO_AI_MODEL || 'claude-haiku-5-5',
      classifiedAt: new Date().toISOString(),
      latencyMs: Date.now() - startedAt,
    };
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[taxReviewAi] classifyTaxDeclaration failed:', e?.message);
    return {
      verdict: 'needs_review',
      confidence: 0,
      reasoning: `IA no pudo clasificar: ${e?.message || 'error desconocido'}`,
      redFlags: [],
      model: null,
      classifiedAt: new Date().toISOString(),
      error: true,
    };
  }
};

module.exports = { classifyTaxDeclaration };
