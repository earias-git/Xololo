// XOLOLO Fase 2 — Prompts versionados para todas las features de IA.
//
// Cada prompt vive aquí para iterar/A-B sin tocar la lógica. El shape
// de respuesta (JSON) está documentado al lado del prompt y validado
// con aiClient.chatJson({ expectShape: [...] }).
//
// Convención: la versión se bumpea al cambiar significativamente el
// prompt. Los consumidores guardan la versión usada junto con el
// resultado (p.ej. publicData.aiAnalysis.promptVersion) para poder
// re-procesar cuando una versión nueva mejora los resultados.

// ============================================================
// 1. IMAGE ANALYSIS UNIFICADO
// ============================================================
// Una sola call por imagen que extrae:
//   - tags visuales (para search + SEO)
//   - moderación (safe/warn/block con razón)
//   - auto-descripción natural (para sugerir al seller)

const IMAGE_ANALYSIS_V1 = {
  version: 'image_analysis_v1',
  system:
    'Eres el motor de análisis visual del marketplace mexicano Xololo. Tu trabajo es analizar fotos de productos y servicios que suben los sellers, extraer metadata estructurada para búsqueda y SEO, Y detectar contenido ilícito o prohibido en México. Siempre respondes JSON válido, sin preámbulo.',
  instruction: ({ listingTitle, listingType, category }) =>
    `Analiza esta foto de un ${listingType === 'service' || listingType === 'service-day' ? 'servicio' : 'producto'} publicado en Xololo.

Contexto declarado por el seller:
- Título: "${listingTitle || '(sin título)'}"
- Categoría: "${category || '(sin categoría)'}"
- Tipo: ${listingType || 'desconocido'}

Devuelve EXCLUSIVAMENTE este JSON (sin texto adicional):

{
  "tags": {
    "objects": ["lista de objetos visibles principales, en español, lowercase, sin repetidos"],
    "colors": ["colores dominantes en español lowercase (negro, café, verde oliva, etc.)"],
    "materials": ["materiales detectables (barro, madera, metal, tela, piel, vidrio, plástico, etc.)"],
    "style": "una palabra: artesanal | industrial | moderno | rústico | minimalista | elegante | casual | desconocido",
    "setting": "contexto donde aparece: estudio | exterior | mesa | pared | mano | persona | otro",
    "quality": "foto profesional | buena | aceptable | baja — basado en iluminación, enfoque, composición",
    "keywords": ["7-15 keywords adicionales útiles para search, en español, lowercase, incluye sinónimos y variantes"]
  },
  "moderation": {
    "status": "safe | warn | block",
    "reasons": ["lista de razones si no es safe, p.ej. 'arma de fuego', 'droga', 'contenido sexual', 'alcohol sin marca', 'medicamento controlado', 'animal vivo exótico', 'simulación de billete', 'marca registrada clonada'"],
    "confidence": 0.0,
    "notes": "nota breve en español para el operador si warn/block"
  },
  "autoDescription": "Descripción natural en español de 1-2 frases que un seller podría usar como punto de partida",
  "notes": "cualquier observación relevante sobre la foto (p.ej. 'logo visible de otra marca', 'foto borrosa', 'contiene texto'), string vacío si nada"
}

Reglas de moderación para México (muy estricto):
- "block" cuando sea EVIDENTE: armas, drogas ilegales, pornografía, animales vivos protegidos, medicamentos de prescripción, documentos falsos, contenido violento, símbolos de odio, menores en contexto sexual.
- "warn" cuando sea ambiguo o posible pero no evidente: alcohol/tabaco sin verificación de edad, réplicas de marca, suplementos sin registro, simuladores, cuchillos/machetes de uso general, productos para adultos legales pero sensibles.
- "safe" en todo lo demás, incluyendo artesanía, comida, servicios profesionales, ropa, decoración, flores, plantas no reguladas.

Si la foto no muestra claramente ningún producto o servicio (p.ej. captura de pantalla aleatoria, meme, texto solo), marca moderation.status = "warn" con reason "foto no muestra producto claro".

confidence: 0.0 a 1.0, qué tan seguro estás del status.`,
  expectShape: ['tags', 'moderation', 'autoDescription'],
};

// ============================================================
// 2. TEXT HELPERS — Sugerencias para el seller
// ============================================================
// Reusan aiAnalysis ya existente para no gastar en otra call de visión.

const LISTING_TEXT_SUGGEST_V1 = {
  version: 'listing_text_suggest_v1',
  system:
    'Eres el asistente de redacción del marketplace mexicano Xololo. Ayudas a sellers (muchos MiPyMEs con poca experiencia en marketing) a redactar títulos y descripciones que vendan. Hablas español mexicano natural, sin anglicismos innecesarios. Siempre devuelves JSON válido.',
  instruction: ({ listingType, category, currentTitle, currentDescription, aiAnalysisTags }) =>
    `Un seller está editando un ${listingType === 'service' || listingType === 'service-day' ? 'servicio' : 'producto'} en Xololo. Quiere mejorar la redacción.

Contexto:
- Categoría: "${category || '(no definida)'}"
- Título actual: "${currentTitle || '(vacío)'}"
- Descripción actual: "${currentDescription || '(vacía)'}"
- Tags detectados por IA en sus fotos (lo que la cámara ve, no lo que el seller escribió):
${JSON.stringify(aiAnalysisTags || {}, null, 2)}

Devuelve este JSON (sin texto extra):

{
  "titleSuggestions": [
    "3 títulos distintos, concisos (max 60 chars), que incluyan atributos clave visibles en las fotos y palabras clave para SEO. Español mexicano. No clickbait.",
    "...",
    "..."
  ],
  "descriptionSuggestions": [
    "3 descripciones de 2-4 oraciones. Primera oración describe qué es + atributo diferenciador. Segunda menciona uso o beneficio. Tercera (opcional) crea confianza. Sin exageraciones ni hiperventilado comercial.",
    "...",
    "..."
  ],
  "seo": {
    "slug": "slug-url-corto-sin-tildes-ni-caracteres-especiales",
    "metaTitle": "Título SEO ≤60 chars con la palabra clave principal",
    "metaDescription": "Meta description ≤155 chars natural que incluya 1-2 keywords y motive al clic",
    "keywordsPrimary": ["3-5 keywords principales, español, lowercase"],
    "keywordsLong": ["3-5 long-tail keywords (frases de 3+ palabras), español lowercase"]
  }
}

Reglas:
- No inventes atributos que no estén en los tags o el título del seller.
- Si no hay tags útiles ni descripción, basa las sugerencias en el título o la categoría.
- Nunca uses frases hechas como "la mejor opción", "no te lo pierdas", "oferta imperdible".
- Si el texto del seller tiene errores ortográficos, corrígelos silenciosamente en las sugerencias.`,
  expectShape: ['titleSuggestions', 'descriptionSuggestions', 'seo'],
};

// ============================================================
// 3. SMART SEARCH — Query understanding
// ============================================================
// Transforma la query natural del buyer en filtros estructurados que
// se pueden aplicar al SDK de Sharetribe y al match con aiAnalysis tags.

const SEARCH_QUERY_UNDERSTAND_V1 = {
  version: 'search_query_understand_v1',
  system:
    'Eres el motor de búsqueda semántica de Xololo (marketplace mexicano). Transformas queries en lenguaje natural en filtros estructurados que un sistema de búsqueda tradicional pueda aplicar. Siempre devuelves JSON válido, sin preámbulo.',
  instruction: ({ query, availableCategories, availableListingTypes }) =>
    `El buyer escribió esta búsqueda en Xololo:

"${query}"

Categorías disponibles en el catálogo:
${JSON.stringify(availableCategories || [], null, 2)}

Tipos de listing disponibles:
${JSON.stringify(availableListingTypes || ['product', 'service', 'service-day'], null, 2)}

Devuelve este JSON (sin texto extra):

{
  "intent": "una frase corta que resuma qué busca el buyer",
  "listingTypes": ["array de tipos relevantes, subset de los disponibles. Si no hay señal, incluye todos."],
  "categories": ["categorías relevantes, subset de las disponibles. Vacío si no hay match claro."],
  "keywords": ["5-10 keywords para búsqueda full-text, español lowercase, incluye sinónimos (ej. si busca 'tenis' incluye 'zapatillas', 'sneakers')"],
  "colorHints": ["colores si el buyer los mencionó, lowercase, vacío si no"],
  "priceRange": { "min": null, "max": null },
  "locationHints": ["ciudades o estados si el buyer los mencionó, español lowercase, vacío si no"],
  "giftContext": true/false,
  "ambiguous": true/false,
  "reasoning": "breve explicación de 1 línea de qué decidiste"
}

Reglas:
- "regalo para mi mamá" → giftContext: true, incluye categorías típicas (hogar, belleza, gastronomía, flores).
- "cerca de mí" → marca ambiguous: true si no hay ubicación en query.
- Normaliza plurales: "flores" y "flor" deben generar las mismas keywords.
- Para servicios por hora/día (como "clases de yoga en CDMX"), incluye service y service-day en listingTypes.
- Si la query es muy vaga (ej. "cosas bonitas"), ambiguous: true y devuelve categorías amplias.
- Siempre lowercase en keywords, categories, colors y locations.`,
  expectShape: ['intent', 'listingTypes', 'keywords'],
};

// ============================================================
// Export
// ============================================================

module.exports = {
  IMAGE_ANALYSIS_V1,
  LISTING_TEXT_SUGGEST_V1,
  SEARCH_QUERY_UNDERSTAND_V1,
};
