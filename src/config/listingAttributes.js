// XOLOLO — catálogo de sub-categorías + atributos por categoría/hoja.
//
// Shape de wizard objetivo (PR 2+):
//   1. Categoría (nivel 1, existente) → sub-categoría (nuevo, de aquí)
//   2. Fotos
//   3. Atributos específicos de la hoja (de aquí)
//   4. Precio + inventario
//   5. Entrega
//   6. Título + descripción (IA auto-genera usando atributos + fotos)
//   7. Publicar
//
// Decisiones de diseño:
//   - Catálogo local versionado en git (no en Sharetribe Console) — rápido
//     iterar en PR. Fase B migra a Console para filtros server-side nativos.
//   - Segunda mano NO es categoría separada; es flag transversal
//     (publicData.condition='used'). Un listing en cualquier categoría
//     puede ser usado y mantiene los MISMOS atributos.
//   - Cobertura: 10 categorías × ~5 sub promedio × ~5-7 atributos. Diseñado
//     para cubrir ~80% de casos. Lo que falte se agrega sin romper nada
//     (atributos nuevos aparecen vacíos en listings viejos — legacy OK).
//
// Shape de un atributo:
//   {
//     type: 'select' | 'multiselect' | 'text' | 'number' | 'dimensions' | 'boolean',
//     label: 'string visible',
//     required: boolean (default false),
//     options?: ['opt1', 'opt2']   // para select / multiselect
//     unit?: 'cm' | 'ml' | 'g' | 'kg' | 'mxn' | ...  // para number / dimensions
//     placeholder?: 'string'       // hint para text
//     helpText?: 'string'          // guía debajo del input
//   }

// Opciones reutilizables (constantes).
const ESTADOS_MX = [
  'Aguascalientes', 'Baja California', 'Baja California Sur', 'Campeche',
  'Chiapas', 'Chihuahua', 'CDMX', 'Coahuila', 'Colima', 'Durango',
  'Estado de México', 'Guanajuato', 'Guerrero', 'Hidalgo', 'Jalisco',
  'Michoacán', 'Morelos', 'Nayarit', 'Nuevo León', 'Oaxaca', 'Puebla',
  'Querétaro', 'Quintana Roo', 'San Luis Potosí', 'Sinaloa', 'Sonora',
  'Tabasco', 'Tamaulipas', 'Tlaxcala', 'Veracruz', 'Yucatán', 'Zacatecas',
];

const COLORES_BASICOS = [
  'Negro', 'Blanco', 'Gris', 'Café', 'Beige', 'Rojo', 'Vino', 'Rosa',
  'Naranja', 'Amarillo', 'Verde', 'Azul', 'Morado', 'Dorado', 'Plateado',
  'Multicolor', 'Transparente', 'Estampado',
];

const GENERO_PRENDAS = ['Hombre', 'Mujer', 'Unisex', 'Niño', 'Niña', 'Bebé'];

const TALLAS_ROPA_LETRA = ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL'];
const TALLAS_CALZADO_MX = ['14', '15', '16', '17', '18', '19', '20', '21', '22', '23',
  '24', '24.5', '25', '25.5', '26', '26.5', '27', '27.5', '28', '28.5', '29', '30'];

// Dimensiones estándar reutilizable.
const DIMENSIONES_CM = {
  type: 'dimensions',
  label: 'Dimensiones (alto × ancho × largo)',
  unit: 'cm',
  required: false,
};

// Marca y modelo reutilizables (text libre; Fase C autocomplete).
const MARCA = { type: 'text', label: 'Marca', placeholder: 'Nike, Apple, Samsung...', required: false };
const MODELO = { type: 'text', label: 'Modelo', placeholder: 'ej. Air Max 90', required: false };

// Árbol de categorías + sub-categorías.
// Las categorías coinciden con src/config/categories.js (id).
export const CATEGORY_TREE = {
  artesanias: {
    label: 'Artesanías',
    subcategories: {
      textiles: 'Textiles y bordados',
      alfareria: 'Alfarería y barro',
      joyeria_artesanal: 'Joyería artesanal',
      madera: 'Madera y talla',
      cuero: 'Cuero y piel',
      metal: 'Metal y herrería',
      otro: 'Otro',
    },
  },
  hogar: {
    label: 'Hogar',
    subcategories: {
      muebles: 'Muebles',
      decoracion: 'Decoración',
      cocina: 'Cocina y comedor',
      bano: 'Baño',
      jardin: 'Jardín y exterior',
      iluminacion: 'Iluminación',
      textiles_hogar: 'Textiles (sábanas, cortinas)',
      organizacion: 'Organización y almacenamiento',
    },
  },
  moda: {
    label: 'Moda',
    subcategories: {
      ropa: 'Ropa',
      calzado: 'Calzado',
      bolsas: 'Bolsas y mochilas',
      bisuteria: 'Bisutería y accesorios',
      relojes: 'Relojes',
      lentes: 'Lentes y gafas',
    },
  },
  belleza: {
    label: 'Belleza',
    subcategories: {
      maquillaje: 'Maquillaje',
      skincare: 'Skincare y cuidado facial',
      fragancias: 'Fragancias',
      cabello: 'Cuidado del cabello',
      unas: 'Uñas',
      equipo: 'Equipo y herramientas',
    },
  },
  alimentos: {
    label: 'Alimentos',
    subcategories: {
      procesados: 'Procesados y conservas',
      frescos: 'Frescos (vegetales, frutas, carnes)',
      bebidas: 'Bebidas',
      reposteria: 'Repostería',
      panaderia: 'Panadería',
      snacks: 'Snacks',
      especialidad: 'Especialidad (orgánico, gourmet, local)',
    },
  },
  tecnologia: {
    label: 'Tecnología',
    subcategories: {
      celulares: 'Celulares y tablets',
      laptops: 'Laptops y computadoras',
      audio: 'Audio (bocinas, audífonos)',
      gaming: 'Gaming (consolas, juegos)',
      smart_home: 'Smart home',
      accesorios: 'Accesorios (cables, cargadores)',
      componentes: 'Componentes y repuestos',
    },
  },
  mascotas: {
    label: 'Mascotas',
    subcategories: {
      alimentos_pet: 'Alimentos',
      juguetes_pet: 'Juguetes',
      accesorios_pet: 'Accesorios (collares, correas, platos)',
      salud_pet: 'Salud e higiene',
      camas_pet: 'Camas y descanso',
      transporte_pet: 'Transporte (jaulas, mochilas)',
    },
  },
  papeleria: {
    label: 'Papelería',
    subcategories: {
      oficina: 'Oficina',
      escolar: 'Escolar',
      creativa: 'Creativa (arte, scrapbook)',
      impresion: 'Impresión y papel',
      organizacion_pap: 'Organización (agendas, carpetas)',
    },
  },
  turismo: {
    label: 'Turismo',
    subcategories: {
      experiencias: 'Experiencias y actividades',
      tours: 'Tours guiados',
      alojamiento: 'Alojamiento',
      transporte: 'Transporte',
      guias: 'Guías de turista',
      clases: 'Clases y talleres turísticos',
    },
  },
  'servicios-pro': {
    label: 'Servicios Pro',
    subcategories: {
      diseno: 'Diseño (gráfico, web, UX)',
      legal: 'Legal',
      contabilidad: 'Contabilidad y fiscal',
      marketing: 'Marketing y redes',
      consultoria: 'Consultoría',
      tecnico: 'Técnico (reparación, instalación)',
      educacion: 'Educación y tutorías',
      salud: 'Salud (nutrición, psicología)',
      belleza_srv: 'Belleza (estilismo, maquillaje)',
    },
  },
  wellness: {
    label: 'Wellness / Salud',
    subcategories: {
      suplementos: 'Suplementos y vitaminas',
      yoga_pilates: 'Yoga y pilates',
      meditacion: 'Meditación y mindfulness',
      fitness: 'Fitness y entrenamiento',
      nutricion: 'Nutrición y planes alimenticios',
      masajes: 'Masajes y terapias corporales',
      medicina_alternativa: 'Medicina alternativa',
      dispositivos_wellness: 'Dispositivos de bienestar',
      aromaterapia: 'Aromaterapia y esenciales',
      retiros: 'Retiros y experiencias wellness',
    },
  },
};

// Atributos por path "categoria.subcategoria".
// Caen al nivel de categoría si no hay match a nivel sub.
export const ATTRIBUTES_BY_PATH = {
  // ARTESANÍAS — comunes a toda la categoría
  'artesanias': {
    tecnica: {
      type: 'select',
      label: 'Técnica artesanal',
      options: ['Telar de cintura', 'Bordado', 'Deshilado', 'Barro negro', 'Barro bruñido',
        'Talavera', 'Vidrio soplado', 'Hojalatería', 'Talla en madera', 'Marquetería',
        'Repujado en metal', 'Alebrije', 'Otro'],
    },
    material_principal: {
      type: 'select',
      label: 'Material principal',
      options: ['Algodón', 'Lana', 'Lino', 'Barro', 'Cerámica', 'Madera', 'Piel',
        'Cuero', 'Metal', 'Vidrio', 'Fibras naturales', 'Mixto'],
    },
    origen_estado: {
      type: 'select', label: 'Origen (estado)', options: ESTADOS_MX,
      helpText: 'Estado de MX donde se elaboró',
    },
    piezas_incluidas: { type: 'number', label: 'Piezas incluidas', unit: 'pzas' },
    dimensiones: DIMENSIONES_CM,
    hecho_a_mano: { type: 'boolean', label: 'Hecho 100% a mano' },
  },

  // HOGAR
  'hogar.muebles': {
    tipo: {
      type: 'select', label: 'Tipo de mueble',
      options: ['Sala', 'Comedor', 'Recámara', 'Cama', 'Mesa', 'Silla', 'Sillón',
        'Librero', 'Escritorio', 'Clóset', 'Zapatera', 'Auxiliar', 'Otro'],
    },
    material: {
      type: 'select', label: 'Material',
      options: ['Madera maciza', 'MDF', 'Melamina', 'Metal', 'Mimbre', 'Bambú',
        'Vidrio', 'Mármol', 'Rattán', 'Mixto'],
    },
    color: { type: 'multiselect', label: 'Color', options: COLORES_BASICOS },
    estilo: {
      type: 'select', label: 'Estilo',
      options: ['Moderno', 'Rústico', 'Industrial', 'Minimalista', 'Boho',
        'Clásico', 'Contemporáneo', 'Vintage'],
    },
    dimensiones: DIMENSIONES_CM,
    armado_requerido: { type: 'boolean', label: 'Requiere armado' },
  },
  'hogar': {
    material: { type: 'text', label: 'Material', placeholder: 'ej. cerámica, madera, textil' },
    color: { type: 'multiselect', label: 'Color', options: COLORES_BASICOS },
    dimensiones: DIMENSIONES_CM,
    estilo: {
      type: 'select', label: 'Estilo',
      options: ['Moderno', 'Rústico', 'Industrial', 'Minimalista', 'Boho',
        'Clásico', 'Vintage'],
    },
  },

  // MODA
  'moda.ropa': {
    marca: MARCA,
    talla: { type: 'select', label: 'Talla', options: TALLAS_ROPA_LETRA, required: true },
    color: { type: 'multiselect', label: 'Color', options: COLORES_BASICOS },
    genero: { type: 'select', label: 'Género', options: GENERO_PRENDAS, required: true },
    tipo_prenda: {
      type: 'select', label: 'Tipo de prenda',
      options: ['Playera', 'Camisa', 'Blusa', 'Pantalón', 'Jeans', 'Short',
        'Falda', 'Vestido', 'Sudadera', 'Suéter', 'Chamarra', 'Abrigo',
        'Traje', 'Ropa interior', 'Pijama', 'Deportiva', 'Otro'],
    },
    material: {
      type: 'select', label: 'Material',
      options: ['Algodón', 'Mezclilla', 'Lino', 'Lana', 'Seda', 'Poliéster',
        'Rayón', 'Nylon', 'Elastano', 'Cuero', 'Sintético', 'Mezcla'],
    },
    temporada: {
      type: 'select', label: 'Temporada',
      options: ['Primavera-verano', 'Otoño-invierno', 'Todo el año'],
    },
  },
  'moda.calzado': {
    marca: MARCA,
    talla_mx: { type: 'select', label: 'Talla (MX)', options: TALLAS_CALZADO_MX, required: true },
    color: { type: 'multiselect', label: 'Color', options: COLORES_BASICOS },
    genero: { type: 'select', label: 'Género', options: GENERO_PRENDAS, required: true },
    tipo_calzado: {
      type: 'select', label: 'Tipo de calzado',
      options: ['Deportivo', 'Casual', 'Formal', 'Botas', 'Botines',
        'Sandalias', 'Huaraches', 'Tacones', 'Flats', 'Pantuflas', 'Otro'],
    },
    material: {
      type: 'select', label: 'Material',
      options: ['Cuero', 'Piel', 'Sintético', 'Textil', 'Lona', 'Gamuza',
        'Charol', 'Mesh deportivo', 'Mixto'],
    },
  },
  'moda.bolsas': {
    marca: MARCA,
    tipo_bolsa: {
      type: 'select', label: 'Tipo',
      options: ['Mochila', 'Bolsa de mano', 'Crossbody', 'Clutch', 'Bolsa grande (tote)',
        'Backpack', 'Riñonera', 'Portafolio', 'Maleta', 'Pañalera'],
    },
    color: { type: 'multiselect', label: 'Color', options: COLORES_BASICOS },
    material: {
      type: 'select', label: 'Material',
      options: ['Cuero', 'Piel', 'Sintético', 'Lona', 'Nylon', 'Textil', 'Yute'],
    },
    dimensiones: DIMENSIONES_CM,
  },
  'moda.bisuteria': {
    tipo_pieza: {
      type: 'select', label: 'Tipo de pieza',
      options: ['Collar', 'Pulsera', 'Aretes', 'Anillo', 'Cadena', 'Pulsera tobillera',
        'Dije', 'Broche', 'Set', 'Otro'],
    },
    material: {
      type: 'select', label: 'Material',
      options: ['Oro', 'Plata .925', 'Plata chapada', 'Acero quirúrgico',
        'Bisutería', 'Chapado en oro', 'Semipreciosa', 'Otro'],
    },
    color: { type: 'multiselect', label: 'Color', options: COLORES_BASICOS },
    marca: MARCA,
  },
  'moda.relojes': {
    marca: { ...MARCA, required: true },
    modelo: MODELO,
    tipo_movimiento: {
      type: 'select', label: 'Movimiento',
      options: ['Cuarzo', 'Automático', 'Mecánico', 'Smart (inteligente)', 'Digital'],
    },
    color_caja: { type: 'select', label: 'Color de caja', options: COLORES_BASICOS },
    material_correa: {
      type: 'select', label: 'Material de correa',
      options: ['Piel', 'Metal', 'Silicón', 'Tela', 'Resina'],
    },
    genero: { type: 'select', label: 'Género', options: GENERO_PRENDAS },
  },
  'moda.lentes': {
    marca: MARCA,
    tipo_lente: {
      type: 'select', label: 'Tipo',
      options: ['De sol', 'Graduados', 'Protección luz azul', 'Deportivos', 'Lectura'],
    },
    color_armazon: { type: 'select', label: 'Color de armazón', options: COLORES_BASICOS },
    genero: { type: 'select', label: 'Género', options: GENERO_PRENDAS },
    polarizado: { type: 'boolean', label: 'Polarizado' },
  },

  // BELLEZA
  'belleza': {
    marca: MARCA,
    tamano_ml: { type: 'number', label: 'Tamaño', unit: 'ml' },
    tipo_piel_cabello: {
      type: 'select', label: 'Tipo (si aplica)',
      options: ['Normal', 'Seca', 'Grasa', 'Mixta', 'Sensible', 'Todas',
        'Cabello graso', 'Cabello seco', 'Cabello rizado', 'Cabello liso'],
    },
    sin_crueldad: { type: 'boolean', label: 'Libre de crueldad animal' },
    organico: { type: 'boolean', label: 'Orgánico/natural' },
  },
  'belleza.maquillaje': {
    marca: MARCA,
    tipo_producto: {
      type: 'select', label: 'Tipo de producto',
      options: ['Labial', 'Base', 'Rubor', 'Sombras', 'Delineador', 'Rímel',
        'Corrector', 'Iluminador', 'Fijador', 'Primer', 'Paleta', 'Set'],
    },
    tono_color: { type: 'text', label: 'Tono/color', placeholder: 'ej. rojo mate, beige' },
    tamano_ml: { type: 'number', label: 'Tamaño', unit: 'ml' },
  },
  'belleza.fragancias': {
    marca: { ...MARCA, required: true },
    tipo_fragancia: {
      type: 'select', label: 'Tipo',
      options: ['Eau de Parfum (EDP)', 'Eau de Toilette (EDT)', 'Cologne',
        'Body mist', 'Loción', 'Aceite perfumado'],
    },
    tamano_ml: { type: 'number', label: 'Tamaño', unit: 'ml' },
    genero: { type: 'select', label: 'Género', options: ['Hombre', 'Mujer', 'Unisex'] },
    familia_olfativa: {
      type: 'select', label: 'Familia olfativa',
      options: ['Floral', 'Cítrico', 'Amaderado', 'Oriental', 'Fougère',
        'Chypre', 'Dulce/Gourmand', 'Fresco', 'Especiado'],
    },
  },

  // ALIMENTOS
  'alimentos': {
    peso_neto: { type: 'number', label: 'Peso neto', unit: 'g' },
    caducidad: { type: 'text', label: 'Caducidad', placeholder: 'ej. 30 días refrigerado' },
    organico: { type: 'boolean', label: 'Orgánico' },
    restricciones: {
      type: 'multiselect', label: 'Apto para',
      options: ['Vegano', 'Vegetariano', 'Sin gluten', 'Sin lactosa', 'Sin azúcar',
        'Keto', 'Diabéticos', 'Kosher', 'Halal'],
    },
    region_origen: { type: 'select', label: 'Región de origen', options: ESTADOS_MX },
  },

  // TECNOLOGÍA
  'tecnologia.celulares': {
    marca: { ...MARCA, required: true },
    modelo: { ...MODELO, required: true },
    almacenamiento_gb: {
      type: 'select', label: 'Almacenamiento',
      options: ['16GB', '32GB', '64GB', '128GB', '256GB', '512GB', '1TB'],
    },
    ram_gb: {
      type: 'select', label: 'RAM',
      options: ['2GB', '3GB', '4GB', '6GB', '8GB', '12GB', '16GB'],
    },
    color: { type: 'multiselect', label: 'Color', options: COLORES_BASICOS },
    sistema_operativo: {
      type: 'select', label: 'Sistema operativo',
      options: ['Android', 'iOS', 'HarmonyOS', 'Otro'],
    },
    bateria_salud_pct: {
      type: 'number', label: 'Salud de batería (%)', unit: '%',
      helpText: 'Si es usado — abre Config → Batería para verlo',
    },
    accesorios_incluidos: {
      type: 'multiselect', label: 'Accesorios incluidos',
      options: ['Cargador', 'Cable', 'Audífonos', 'Caja original', 'Mica', 'Funda'],
    },
    desbloqueado: { type: 'boolean', label: 'Desbloqueado (todas las compañías)' },
  },
  'tecnologia.laptops': {
    marca: { ...MARCA, required: true },
    modelo: MODELO,
    procesador: {
      type: 'select', label: 'Procesador',
      options: ['Intel i3', 'Intel i5', 'Intel i7', 'Intel i9', 'AMD Ryzen 3',
        'AMD Ryzen 5', 'AMD Ryzen 7', 'AMD Ryzen 9', 'Apple M1', 'Apple M2',
        'Apple M3', 'Apple M4', 'Otro'],
    },
    ram_gb: {
      type: 'select', label: 'RAM',
      options: ['4GB', '8GB', '16GB', '32GB', '64GB'],
    },
    almacenamiento_gb: {
      type: 'select', label: 'Almacenamiento',
      options: ['128GB', '256GB', '512GB', '1TB', '2TB'],
    },
    tipo_almacenamiento: {
      type: 'select', label: 'Tipo de disco',
      options: ['SSD', 'HDD', 'eMMC', 'NVMe'],
    },
    pantalla_pulg: { type: 'number', label: 'Pantalla', unit: '"' },
    sistema_operativo: {
      type: 'select', label: 'Sistema operativo',
      options: ['Windows 11', 'Windows 10', 'macOS', 'Linux', 'ChromeOS', 'Otro'],
    },
    color: { type: 'select', label: 'Color', options: COLORES_BASICOS },
  },
  'tecnologia.audio': {
    marca: MARCA,
    modelo: MODELO,
    tipo_audio: {
      type: 'select', label: 'Tipo',
      options: ['Audífonos in-ear', 'Audífonos over-ear', 'Audífonos on-ear',
        'True wireless (TWS)', 'Bocina portátil', 'Bocina de estante',
        'Soundbar', 'Micrófono', 'Interface de audio'],
    },
    conectividad: {
      type: 'multiselect', label: 'Conectividad',
      options: ['Bluetooth', 'Cable 3.5mm', 'USB-C', 'Lightning', 'Wi-Fi', 'Óptico'],
    },
    cancelacion_ruido: { type: 'boolean', label: 'Cancelación activa de ruido (ANC)' },
    color: { type: 'select', label: 'Color', options: COLORES_BASICOS },
  },
  'tecnologia.gaming': {
    marca: MARCA,
    plataforma: {
      type: 'select', label: 'Plataforma',
      options: ['PlayStation 5', 'PlayStation 4', 'Xbox Series X/S', 'Xbox One',
        'Nintendo Switch', 'PC', 'Retro', 'Portátil'],
    },
    tipo_producto_gaming: {
      type: 'select', label: 'Tipo',
      options: ['Consola', 'Videojuego', 'Control', 'Audífonos gaming',
        'Teclado', 'Mouse', 'Silla', 'Monitor', 'Accesorio'],
    },
    region: {
      type: 'select', label: 'Región (juegos/consolas)',
      options: ['NTSC-U/C (América)', 'PAL (Europa)', 'NTSC-J (Japón)', 'Global'],
    },
  },
  'tecnologia': {
    marca: MARCA,
    modelo: MODELO,
    color: { type: 'select', label: 'Color', options: COLORES_BASICOS },
  },

  // MASCOTAS
  'mascotas': {
    tipo_mascota: {
      type: 'select', label: 'Tipo de mascota', required: true,
      options: ['Perro', 'Gato', 'Ave', 'Pez', 'Hámster/Roedor', 'Reptil', 'Conejo', 'Otro'],
    },
    tamano_mascota: {
      type: 'select', label: 'Tamaño mascota',
      options: ['Chico (<10kg)', 'Mediano (10-25kg)', 'Grande (>25kg)', 'Todas'],
    },
    marca: MARCA,
  },
  'mascotas.alimentos_pet': {
    tipo_mascota: {
      type: 'select', label: 'Para', required: true,
      options: ['Perro', 'Gato', 'Ave', 'Pez', 'Hámster/Roedor', 'Reptil', 'Conejo'],
    },
    etapa_vida: {
      type: 'select', label: 'Etapa de vida',
      options: ['Cachorro', 'Adulto', 'Senior', 'Todas las edades'],
    },
    marca: MARCA,
    peso_kg: { type: 'number', label: 'Peso', unit: 'kg' },
    ingrediente_principal: { type: 'text', label: 'Ingrediente principal', placeholder: 'pollo, salmón, res...' },
    tipo_dieta: {
      type: 'multiselect', label: 'Dieta',
      options: ['Seca', 'Húmeda', 'Natural (BARF)', 'Sin granos', 'Hipoalergénica', 'Light'],
    },
  },

  // PAPELERÍA
  'papeleria': {
    tipo_papeleria: {
      type: 'select', label: 'Tipo',
      options: ['Cuadernos', 'Plumas y lápices', 'Carpetas', 'Hojas y papel',
        'Agendas', 'Calendarios', 'Sobres', 'Tijeras y cutters', 'Adhesivos',
        'Marcadores', 'Pintura y arte', 'Sellos', 'Otro'],
    },
    cantidad_pack: { type: 'number', label: 'Cantidad por paquete', unit: 'pzas' },
    color: { type: 'multiselect', label: 'Color', options: COLORES_BASICOS },
    tamano_papel: {
      type: 'select', label: 'Tamaño papel',
      options: ['Carta', 'Oficio', 'A4', 'A5', 'A3', 'Media carta', 'Otro'],
    },
    marca: MARCA,
  },

  // TURISMO
  'turismo': {
    duracion: { type: 'text', label: 'Duración', placeholder: 'ej. 3 horas / 1 día / 2 noches' },
    personas_min: { type: 'number', label: 'Personas mínimo', unit: 'pers' },
    personas_max: { type: 'number', label: 'Personas máximo', unit: 'pers' },
    incluye_transporte: { type: 'boolean', label: 'Incluye transporte' },
    incluye_comida: { type: 'boolean', label: 'Incluye alimentos' },
    idioma: {
      type: 'multiselect', label: 'Idiomas disponibles',
      options: ['Español', 'Inglés', 'Francés', 'Alemán', 'Italiano', 'Portugués', 'Japonés'],
    },
    nivel: {
      type: 'select', label: 'Nivel',
      options: ['Familiar', 'Relajado', 'Aventura ligera', 'Aventura extrema'],
    },
    region: { type: 'select', label: 'Región', options: ESTADOS_MX },
  },

  // SERVICIOS PRO
  'servicios-pro': {
    modalidad: {
      type: 'select', label: 'Modalidad', required: true,
      options: ['Presencial', 'En línea', 'Mixto'],
    },
    duracion_sesion: {
      type: 'text', label: 'Duración de sesión',
      placeholder: 'ej. 60 min, 2 horas, 1 jornada',
    },
    incluye_material: { type: 'boolean', label: 'Incluye material/herramientas' },
    certificacion: { type: 'text', label: 'Certificación / cédula profesional', placeholder: 'ej. céd. prof. 1234567' },
    experiencia_anos: { type: 'number', label: 'Años de experiencia', unit: 'años' },
    area_cobertura: {
      type: 'multiselect', label: 'Área de cobertura (presencial)',
      options: ESTADOS_MX,
    },
  },
  'servicios-pro.educacion': {
    modalidad: {
      type: 'select', label: 'Modalidad', required: true,
      options: ['Presencial', 'En línea', 'Mixto'],
    },
    nivel: {
      type: 'select', label: 'Nivel',
      options: ['Preescolar', 'Primaria', 'Secundaria', 'Preparatoria',
        'Universidad', 'Posgrado', 'Adultos', 'Todos'],
    },
    materia: { type: 'text', label: 'Materia', placeholder: 'ej. matemáticas, inglés' },
    certificacion: { type: 'text', label: 'Cédula profesional / certificación' },
    duracion_sesion: { type: 'text', label: 'Duración de clase', placeholder: 'ej. 60 min' },
  },

  // WELLNESS / SALUD
  // Comunes a toda la categoría (productos genéricos de wellness).
  'wellness': {
    marca: MARCA,
    enfoque: {
      type: 'multiselect', label: 'Enfoque de bienestar',
      options: ['Físico', 'Mental', 'Emocional', 'Espiritual', 'Nutricional',
        'Relajación', 'Energía', 'Sueño', 'Postural'],
    },
  },
  'wellness.suplementos': {
    marca: { ...MARCA, required: true },
    tipo_suplemento: {
      type: 'select', label: 'Tipo', required: true,
      options: ['Vitamina', 'Mineral', 'Multivitamínico', 'Proteína', 'Aminoácido',
        'Omega-3 / Aceites', 'Pre-entreno', 'Post-entreno', 'Colágeno',
        'Herbolario / Fitoterápico', 'Probiótico', 'Fibra', 'Adaptógeno',
        'Quemador', 'Otro'],
    },
    presentacion: {
      type: 'select', label: 'Presentación',
      options: ['Cápsulas', 'Tabletas', 'Polvo', 'Líquido', 'Gomitas', 'Barras', 'Sobres'],
    },
    tamano_pack: { type: 'number', label: 'Cantidad', unit: 'unidades' },
    tamano_ml_g: { type: 'number', label: 'Tamaño por unidad', unit: 'ml / g' },
    apto_para: {
      type: 'multiselect', label: 'Apto para',
      options: ['Vegano', 'Vegetariano', 'Sin gluten', 'Sin lactosa', 'Sin azúcar',
        'Keto', 'Kosher', 'Halal'],
    },
    caducidad: { type: 'text', label: 'Caducidad', placeholder: 'ej. 24 meses' },
    requiere_receta: { type: 'boolean', label: 'Requiere receta médica' },
    cofepris: { type: 'text', label: 'Registro COFEPRIS', placeholder: 'opcional, si aplica' },
  },
  'wellness.yoga_pilates': {
    modalidad: {
      type: 'select', label: 'Modalidad', required: true,
      options: ['Presencial', 'En línea', 'Mixto'],
    },
    disciplina: {
      type: 'select', label: 'Disciplina',
      options: ['Hatha Yoga', 'Vinyasa', 'Ashtanga', 'Yin Yoga', 'Kundalini',
        'Yoga Restaurativo', 'Yoga Aéreo', 'Pilates Mat', 'Pilates Reformer',
        'Pilates Clínico', 'Barre', 'Otro'],
    },
    nivel: {
      type: 'select', label: 'Nivel',
      options: ['Principiante', 'Intermedio', 'Avanzado', 'Todos los niveles'],
    },
    duracion_sesion: { type: 'text', label: 'Duración de sesión', placeholder: 'ej. 60 min' },
    personas_max: { type: 'number', label: 'Personas máximo (clase grupal)', unit: 'pers' },
    certificacion_instructor: {
      type: 'text', label: 'Certificación del instructor',
      placeholder: 'ej. RYT-200, Yoga Alliance',
    },
    incluye_equipo: { type: 'boolean', label: 'Incluye tapete/equipo' },
  },
  'wellness.meditacion': {
    modalidad: {
      type: 'select', label: 'Modalidad', required: true,
      options: ['Presencial', 'En línea', 'Mixto', 'Grabación / audio'],
    },
    tipo_meditacion: {
      type: 'select', label: 'Tipo',
      options: ['Mindfulness', 'Guiada', 'Silenciosa', 'Trascendental',
        'Metta (compasión)', 'Visualización', 'Chakra', 'Vipassana',
        'Zen', 'Respiración consciente'],
    },
    duracion_sesion: { type: 'text', label: 'Duración', placeholder: 'ej. 20 min' },
    nivel: {
      type: 'select', label: 'Nivel',
      options: ['Principiante', 'Intermedio', 'Avanzado', 'Todos'],
    },
    idioma: {
      type: 'multiselect', label: 'Idioma',
      options: ['Español', 'Inglés'],
    },
  },
  'wellness.fitness': {
    modalidad: {
      type: 'select', label: 'Modalidad', required: true,
      options: ['Presencial', 'En línea', 'Mixto', 'Plan escrito (sin sesiones)'],
    },
    disciplina_fitness: {
      type: 'select', label: 'Disciplina',
      options: ['Funcional', 'HIIT', 'CrossFit', 'Pesas / Fuerza', 'Cardio',
        'Spinning', 'Boxeo', 'Kickboxing', 'MMA', 'Calistenia', 'Running',
        'Natación', 'Ciclismo', 'Entrenamiento en casa', 'Otro'],
    },
    nivel: {
      type: 'select', label: 'Nivel',
      options: ['Principiante', 'Intermedio', 'Avanzado', 'Atleta'],
    },
    objetivo: {
      type: 'multiselect', label: 'Objetivo',
      options: ['Pérdida de peso', 'Ganancia muscular', 'Tonificación',
        'Resistencia', 'Flexibilidad', 'Rehabilitación', 'Rendimiento deportivo'],
    },
    duracion_sesion: { type: 'text', label: 'Duración por sesión', placeholder: 'ej. 60 min' },
    certificacion_instructor: {
      type: 'text', label: 'Certificación del entrenador',
      placeholder: 'ej. NSCA, ACSM, CEFO',
    },
    incluye_plan: { type: 'boolean', label: 'Incluye plan escrito personalizado' },
  },
  'wellness.nutricion': {
    modalidad: {
      type: 'select', label: 'Modalidad', required: true,
      options: ['Presencial', 'En línea', 'Mixto'],
    },
    enfoque_nutricional: {
      type: 'select', label: 'Enfoque',
      options: ['Control de peso', 'Deportivo', 'Clínico (diabetes, hipertensión)',
        'Vegetariano / vegano', 'Keto / baja en carbs', 'Infantil',
        'Materno-infantil', 'Trastornos alimentarios', 'Longevidad / anti-aging',
        'General / bienestar'],
    },
    cedula_profesional: {
      type: 'text', label: 'Cédula profesional de Nutriólogo', required: true,
      placeholder: 'número de cédula SEP',
      helpText: 'Obligatorio para legalidad del servicio en MX',
    },
    incluye_plan: { type: 'boolean', label: 'Incluye plan alimenticio escrito' },
    incluye_seguimiento: { type: 'boolean', label: 'Incluye seguimiento semanal' },
    duracion_programa: { type: 'text', label: 'Duración del programa', placeholder: 'ej. 1 sesión, 4 semanas, 3 meses' },
  },
  'wellness.masajes': {
    modalidad: {
      type: 'select', label: 'Modalidad', required: true,
      options: ['Presencial en spa / consultorio', 'A domicilio', 'Mixto'],
    },
    tipo_masaje: {
      type: 'select', label: 'Tipo de masaje',
      options: ['Relajante', 'Sueco', 'Deportivo', 'Descontracturante',
        'Tailandés', 'Shiatsu', 'Reflexología', 'Piedras calientes',
        'Linfático', 'Tejido profundo', 'Prenatal', 'Antiestrés'],
    },
    duracion_sesion: { type: 'text', label: 'Duración', placeholder: 'ej. 60 min, 90 min' },
    area_cobertura: {
      type: 'multiselect', label: 'Zona de cobertura (si domicilio)',
      options: ESTADOS_MX,
    },
    incluye_aceites: { type: 'boolean', label: 'Incluye aceites y materiales' },
    certificacion: { type: 'text', label: 'Certificación', placeholder: 'ej. Diplomado masaje terapéutico' },
  },
  'wellness.medicina_alternativa': {
    modalidad: {
      type: 'select', label: 'Modalidad', required: true,
      options: ['Presencial', 'En línea', 'Mixto'],
    },
    tipo_terapia: {
      type: 'select', label: 'Tipo de terapia',
      options: ['Acupuntura', 'Homeopatía', 'Herbolaria', 'Reiki', 'Osteopatía',
        'Quiropráctica', 'Flores de Bach', 'Terapia floral', 'Aromaterapia',
        'Terapia energética', 'Biodescodificación', 'Hipnosis',
        'Constelaciones familiares', 'Otro'],
    },
    duracion_sesion: { type: 'text', label: 'Duración de sesión', placeholder: 'ej. 60 min' },
    certificacion: {
      type: 'text', label: 'Certificación / cédula',
      placeholder: 'ej. acupuntor certificado, cédula médica',
      helpText: 'Importante: ciertas terapias requieren título médico (acupuntura, osteopatía)',
    },
  },
  'wellness.dispositivos_wellness': {
    marca: { ...MARCA, required: true },
    modelo: MODELO,
    tipo_dispositivo: {
      type: 'select', label: 'Tipo de dispositivo',
      options: ['Báscula inteligente', 'Oxímetro', 'Termómetro digital',
        'Baumanómetro / presión', 'Glucómetro', 'Smartband / smartwatch',
        'Pulsómetro', 'Masajeador eléctrico', 'Fascia gun / pistola masaje',
        'Rodillo de foam', 'Difusor de aromas', 'Lámpara de sal',
        'Esterilla de acupresión', 'Otro'],
    },
    conectividad: {
      type: 'multiselect', label: 'Conectividad',
      options: ['Bluetooth', 'Wi-Fi', 'USB', 'App móvil', 'Sin conectividad'],
    },
    requiere_calibracion: { type: 'boolean', label: 'Requiere calibración médica' },
    cofepris: { type: 'text', label: 'Registro COFEPRIS (si médico)', placeholder: 'opcional' },
  },
  'wellness.aromaterapia': {
    marca: MARCA,
    tipo_producto: {
      type: 'select', label: 'Tipo',
      options: ['Aceite esencial puro', 'Mezcla de aceites', 'Difusor',
        'Vela aromática', 'Spray aromático', 'Roll-on', 'Jabón aromático',
        'Incienso', 'Set'],
    },
    aroma: {
      type: 'multiselect', label: 'Aroma / propósito',
      options: ['Lavanda', 'Eucalipto', 'Menta', 'Romero', 'Naranja',
        'Limón', 'Ylang ylang', 'Árbol del té', 'Rosa', 'Jazmín', 'Sándalo',
        'Mirra', 'Incienso', 'Mezcla relajante', 'Mezcla energizante',
        'Mezcla para sueño', 'Mezcla para concentración'],
    },
    tamano_ml: { type: 'number', label: 'Tamaño', unit: 'ml' },
    organico: { type: 'boolean', label: '100% natural / orgánico' },
    uso: {
      type: 'select', label: 'Modo de uso recomendado',
      options: ['Difusor', 'Aplicación tópica', 'Baño', 'Inhalación directa', 'Múltiple'],
    },
  },
  'wellness.retiros': {
    modalidad: {
      type: 'select', label: 'Modalidad', required: true,
      options: ['Retiro presencial', 'Retiro online', 'Experiencia de un día'],
    },
    enfoque_retiro: {
      type: 'multiselect', label: 'Enfoque',
      options: ['Yoga', 'Meditación', 'Detox', 'Silencio', 'Mujeres',
        'Hombres', 'Parejas', 'Familiar', 'Ayuno', 'Breathwork',
        'Temazcal', 'Ceremonial / plantas sagradas', 'Deportivo'],
    },
    duracion: { type: 'text', label: 'Duración', placeholder: 'ej. 3 días 2 noches' },
    personas_max: { type: 'number', label: 'Personas máximo', unit: 'pers' },
    incluye_alojamiento: { type: 'boolean', label: 'Incluye alojamiento' },
    incluye_comida: { type: 'boolean', label: 'Incluye alimentos' },
    incluye_transporte: { type: 'boolean', label: 'Incluye transporte' },
    region: { type: 'select', label: 'Ubicación', options: ESTADOS_MX },
  },
};

// XOLOLO: atributos TRANSVERSALES del tipo "Evento" (listingType pseudo
// 'event-ticket' que se mapea a product + publicData.isEvent=true).
// Se SOBREESCRIBEN sobre los atributos de categoría cuando el seller
// marca "Evento con fecha fija". Un taller de wellness.yoga, un
// concierto en artesanias, un tour en turismo — todos usan estos
// mismos campos de evento. Persisten en publicData.event = {...}.
export const EVENT_ATTRIBUTES = {
  event_date_start: {
    type: 'text', // sin tipo date aún — placeholder YYYY-MM-DD
    label: 'Fecha de inicio',
    placeholder: '2026-10-30',
    required: true,
    helpText: 'Formato YYYY-MM-DD',
  },
  event_time_start: {
    type: 'text',
    label: 'Hora de inicio',
    placeholder: '11:00',
    required: true,
    helpText: 'Formato HH:MM (24h)',
  },
  event_date_end: {
    type: 'text',
    label: 'Fecha de fin',
    placeholder: '2026-10-30',
    helpText: 'Si es el mismo día, repite la fecha de inicio',
  },
  event_time_end: {
    type: 'text',
    label: 'Hora de fin',
    placeholder: '14:00',
    required: true,
  },
  event_location: {
    type: 'text',
    label: 'Lugar / dirección exacta',
    placeholder: 'Starbucks, Plaza de Armas, Centro de Cuernavaca',
    required: true,
  },
  event_modality: {
    type: 'select',
    label: 'Modalidad',
    options: ['Presencial', 'En línea', 'Mixto'],
    required: true,
  },
  event_capacity: {
    type: 'number',
    label: 'Cupo total',
    unit: 'personas',
    required: true,
    helpText: 'Se usa como stock del listing — se descuenta por cada reserva',
  },
  event_includes: {
    type: 'text',
    label: 'Qué incluye',
    placeholder: 'ej. materiales, alimentos, bebida de bienvenida',
  },
  event_min_age: {
    type: 'number',
    label: 'Edad mínima (opcional)',
    unit: 'años',
  },
  event_ticket_qr: {
    type: 'boolean',
    label: 'Enviar boleto con QR por email (además de la lista de nombres)',
    helpText: 'Si lo activas, el buyer recibe un PDF con QR escaneable en la puerta. Por default sólo se usa lista de nombres.',
  },
};

/* ----- Helpers de lectura ----- */

export const getSubcategories = categoryId => {
  const cat = CATEGORY_TREE[categoryId];
  if (!cat) return [];
  return Object.entries(cat.subcategories || {}).map(([id, label]) => ({ id, label }));
};

/**
 * Devuelve el objeto de atributos aplicable a (categoryId, subcategoryId).
 * Precedencia:
 *   1. Si existe `categoryId.subcategoryId` → ese set.
 *   2. Si no, cae a `categoryId` (atributos comunes de la categoría).
 *   3. Si no hay nada, {} (listing sin atributos — legacy OK).
 *
 * Si `isEvent=true`, devuelve ÚNICAMENTE EVENT_ATTRIBUTES — no mergea
 * con los de la categoría. Rationale: un taller de orquídeas en
 * Hogar.jardin no necesita color/estilo/dimensiones (son de muebles),
 * sólo fecha/hora/lugar/cupo/modalidad. Un evento es un servicio
 * temporal, no un objeto físico que herede atributos materiales.
 */
export const getAttributesForListing = (categoryId, subcategoryId, isEvent = false) => {
  if (isEvent) return { ...EVENT_ATTRIBUTES };
  if (!categoryId) return {};
  const specific = subcategoryId ? ATTRIBUTES_BY_PATH[`${categoryId}.${subcategoryId}`] : null;
  if (specific) return specific;
  return ATTRIBUTES_BY_PATH[categoryId] || {};
};

/**
 * Lista plana (ordenada) para iterar en forms. Preserva el orden del
 * objeto (ES2015+ garantiza orden de inserción para keys string).
 */
export const listAttributes = (categoryId, subcategoryId, isEvent = false) => {
  const attrs = getAttributesForListing(categoryId, subcategoryId, isEvent);
  return Object.entries(attrs).map(([key, def]) => ({ key, ...def }));
};

/**
 * Valida que `values` cumpla con los atributos requeridos de la
 * (categoría, sub). Devuelve array de keys faltantes, o [] si todo OK.
 * Útil para validación de form en PR 2.
 */
export const getMissingRequiredAttributes = (categoryId, subcategoryId, values = {}, isEvent = false) => {
  const attrs = getAttributesForListing(categoryId, subcategoryId, isEvent);
  const missing = [];
  for (const [key, def] of Object.entries(attrs)) {
    if (!def.required) continue;
    const v = values[key];
    const isEmpty =
      v === undefined ||
      v === null ||
      v === '' ||
      (Array.isArray(v) && v.length === 0);
    if (isEmpty) missing.push(key);
  }
  return missing;
};
