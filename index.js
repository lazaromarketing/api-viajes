import express from 'express'
import cors from 'cors'
import axios from 'axios'
import dotenv from 'dotenv'
import rateLimit from 'express-rate-limit'
import { LRUCache } from 'lru-cache'
import { getDistance } from 'geolib'

dotenv.config()

// ───── Logger Mejorado (Definido antes para poder usarlo en la validación de env vars) ─────
const logger = {
  info: (msg, ...args) => console.log(`[INFO] ${new Date().toISOString()} ${msg}`, ...args),
  warn: (msg, ...args) => console.warn(`[WARN] ${new Date().toISOString()} ${msg}`, ...args),
  error: (msg, ...args) => console.error(`[ERROR] ${new Date().toISOString()} ${msg}`, ...args),
  debug: (msg, ...args) => process.env.NODE_ENV !== 'production' && console.log(`[DEBUG] ${new Date().toISOString()} ${msg}`, ...args)
}

// ───── Validación de Variables de Entorno ─────
const requiredEnvVars = ['OPENCAGE_API_KEY', 'MAPBOX_TOKEN', 'BOUNDS_NAYARIT', 'ALLOWED_MUNICIPIOS']
for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    logger.error(`❌ Error Crítico: Variable de entorno ${envVar} es requerida. La aplicación no puede iniciar.`)
    process.exit(1)
  }
}

// ───── Configuración ─────
const OPENCAGE_KEY = process.env.OPENCAGE_API_KEY
const MAPBOX_TOKEN = process.env.MAPBOX_TOKEN
const bounds = process.env.BOUNDS_NAYARIT.split(',').map(Number)
const allowed = process.env.ALLOWED_MUNICIPIOS
  .split(',')
  .map(m => m.trim().toLowerCase())

// Coordenadas aproximadas del centro de Tepic, Nayarit.
const TEPIC_CENTER = { lat: 21.4925, lon: -104.8532 };

// ───── Puntos Específicos Permitidos (para validación de área de servicio) ─────
const ALLOWED_SPECIFIC_POINTS = [
  { name: "Playa Las Islitas, San Blas", lat: 21.54333, lon: -105.28558, radiusKm: 1.0 },
  { name: "Centro de Compostela (Plaza Principal)", lat: 21.1685, lon: -104.9168, radiusKm: 0.2 }
];

// ───── POIs Adicionales (para mejorar la geocodificación de texto) ─────
const POIS_ADICIONALES = {
  "forum tepic": { lat: 21.492075, lon: -104.865812, address: "Blvrd Luis Donaldo Colosio 680, Subcentro Urbano, 63175 Tepic, Nay.", components: { _category: 'poi', _type: 'amenity', city: 'Tepic', postcode: '63175', house_number: '680', road: 'Blvrd Luis Donaldo Colosio', suburb: 'Subcentro Urbano' } },
  "catedral": { lat: 21.4997, lon: -104.8948, address: "Catedral de Tepic, México Nte. 132, Centro, Tepic", components: { _category: 'poi', _type: 'amenity', city: 'Tepic', postcode: '63000', house_number: '132', road: 'México Nte.', suburb: 'Centro' } },
  "walmart": { lat: 21.5150, lon: -104.8700, address: "Walmart, Av. Insurgentes 1072, Lagos del Country, Tepic", components: { _category: 'poi', _type: 'amenity', city: 'Tepic', postcode: '63173', house_number: '1072', road: 'Av. Insurgentes', suburb: 'Lagos del Country' } },
  "central de autobuses": { lat: 21.4880, lon: -104.8900, address: "Central de Autobuses de Tepic, Av. Insurgentes 1072, Tepic", components: { _category: 'poi', _type: 'amenity', city: 'Tepic', postcode: '63000', house_number: '1072', road: 'Av. Insurgentes' } },
  "centro": { lat: 21.5017, lon: -104.8940, address: "Centro Histórico, Tepic, Nayarit", components: { _category: 'locality', _type: 'city_district', city: 'Tepic', suburb: 'Centro' } },
  "el centro": { lat: 21.5017, lon: -104.8940, address: "Centro Histórico, Tepic, Nayarit", components: { _category: 'locality', _type: 'city_district', city: 'Tepic', suburb: 'Centro' } },
  "hospital general": { lat: 21.5000, lon: -104.8900, address: "Hospital General de Nayarit, Av Enfermería S/n, Tepic", components: { _category: 'poi', _type: 'amenity', city: 'Tepic', road: 'Av Enfermería', house_number: 'S/n' } },
  "cruz roja": { lat: 21.5050, lon: -104.8950, address: "Cruz Roja Mexicana, Tepic, Nayarit", components: { _category: 'poi', _type: 'amenity', city: 'Tepic' } },
  "walmart insurgentes": { lat: 21.5150, lon: -104.8700, address: "Walmart, Av. Insurgentes 1072, Lagos del Country, Tepic", components: { _category: 'poi', _type: 'amenity', city: 'Tepic', postcode: '63173', house_number: '1072', road: 'Av. Insurgentes', suburb: 'Lagos del Country' } },
  "bodega aurrera": { lat: 21.5100, lon: -104.8900, address: "Bodega Aurrera, Tepic, Nayarit", components: { _category: 'poi', _type: 'amenity', city: 'Tepic' } },
  "uan campus": { lat: 21.5150, lon: -104.8650, address: "Universidad Autónoma de Nayarit, Ciudad de la Cultura, Tepic", components: { _category: 'poi', _type: 'amenity', city: 'Tepic', suburb: 'Ciudad de la Cultura' } },
  "tec de tepic": { lat: 21.4800, lon: -104.8400, address: "Instituto Tecnológico de Tepic, Av. Tecnológico 2595, Tepic", components: { _category: 'poi', _type: 'amenity', city: 'Tepic', house_number: '2595', road: 'Av. Tecnológico' } },
};

// ───── Constantes de Pricing ─────
const PRICING = {
  BASE_PRICE: 50,
  TIERS: [
    { maxKm: 5, rate: null },
    { maxKm: 10, rate: 10 },
    { maxKm: 15, rate: 9 },
    { maxKm: Infinity, rate: 8 }
  ]
}

// ───── Rate Limiter ─────
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Demasiadas peticiones desde esta IP, por favor intenta de nuevo más tarde.',
    code: 'TOO_MANY_REQUESTS'
  }
})

// ───── Caché LRU ─────
const geoCache = new LRUCache({
  max: 500,
  ttl: 1000 * 60 * 60 * 24
})

// ───── Validadores ─────
const validators = {
  coordinates: (lat, lon) => {
    return typeof lat === 'number' && typeof lon === 'number' &&
      lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180
  },
  url: (url) => {
    try { new URL(url); return true } catch { return false }
  },
  phone: (telefono) => {
    return typeof telefono === 'string' && telefono.trim().length >= 10
  },
  address: (address) => {
    return typeof address === 'string' && address.trim().length > 3
  }
}

// ───── Helper para mapear calidad de geocodificación ─────
function mapQualityToPrecision(source, qualityScore, direccionEncontrada, originalAddress) {
  logger.debug(`mapQualityToPrecision - source: ${source}, qualityScore: <span class="math-inline">\{qualityScore\}, found\: "</span>{direccionEncontrada}", original: "${originalAddress}"`);
  let calidad = 'Desconocida';
  let precision_metros = 999;

  if (source === 'predefined_poi') {
    calidad = 'Excelente';
    precision_metros = 5;
  } else if (source === 'opencage' || source === 'opencage_reverse') {
    if (qualityScore >= 9) {
      calidad = 'Excelente';
      precision_metros = 10;
    } else if (qualityScore >= 7) {
      calidad = 'Buena';
      precision_metros = 30;
    } else if (qualityScore >= 4) {
      calidad = 'Aceptable';
      precision_metros = 150;
    } else {
      calidad = 'Baja';
      precision_metros = 600;
    }
  } else if (source === 'mapbox') {
    if (qualityScore >= 0.9) {
      calidad = 'Excelente';
      precision_metros = 10;
    } else if (qualityScore >= 0.7) {
      calidad = 'Buena';
      precision_metros = 30;
    } else if (qualityScore >= 0.4) {
      calidad = 'Aceptable';
      precision_metros = 150;
    } else {
      calidad = 'Baja';
      precision_metros = 600;
    }
  }

  const normalizedFound = (direccionEncontrada || "").toLowerCase();
  const normalizedOriginal = (originalAddress || "").toLowerCase();
  const isGenericResult = normalizedFound.includes('méxico') && !normalizedFound.includes('tepic') && !normalizedFound.includes('xalisco') && !normalizedFound.includes('san blas') && !normalizedFound.includes('compostela') && !/\d/.test(normalizedFound);
  const isOnlyPostalCode = /^\d{5},\s*(nayarit,\s*)?méxico$/.test(normalizedFound.trim());

  if (isGenericResult || isOnlyPostalCode) {
    logger.warn(`Calidad degradada para "<span class="math-inline">\{direccionEncontrada\}" \(original\: "</span>{originalAddress}") a "Baja" por ser genérica.`);
    calidad = 'Baja';
    precision_metros = 600;
  } else if ((calidad === 'Buena' || calidad === 'Excelente') && !/\d/.test(normalizedFound) && /\d/.test(normalizedOriginal)) {
    logger.warn(`Calidad degradada para "<span class="math-inline">\{direccionEncontrada\}" \(original\: "</span>{originalAddress}") a "Aceptable" por falta de número de calle explícito en resultado.`);
    calidad = 'Aceptable';
    precision_metros = 150;
  }

  logger.debug(` -> mapQualityToPrecision - Resultado: calidad: ${calidad}, precision_metros: ${precision_metros}`);
  return { calidad, precision_metros };
}

// ───── Geocode híbrido (texto) ─────
async function geocodeHybrid(address) {
  logger.debug(`geocodeHybrid iniciado para: "${address}"`);
  const normalizedAddressInput = address.toLowerCase().trim();

  for (const key in POIS_ADICIONALES) {
    if (normalizedAddressInput.includes(key) || key.includes(normalizedAddressInput)) {
      const poi = POIS_ADICIONALES[key];
      logger.info(`POI Adicional encontrado (flexible): "<span class="math-inline">\{poi\.address\}" para input "</span>{address}"`);
      return { lat: poi.lat, lon: poi.lon, direccion: poi.address, source: 'predefined_poi', quality: 10, components: poi.components, sugerencias: [] };
    }
  }

  const [latS, lonW, latN, lonE] = bounds;
  const mapboxBbox = `<span class="math-inline">\{lonW\},</span>{latS},<span class="math-inline">\{lonE\},</span>{latN}`;
  const opencageBounds = `<span class="math-inline">\{lonW\},</span>{latS},<span class="math-inline">\{lonE\},</span>{latN}`;

  let openCageResult = null;
  let mapboxResult = null;

  try {
    const ocURL = `https://api.opencagedata.com/geocode/v1/json?q=<span class="math-inline">\{encodeURIComponent\(address\)\}&key\=</span>{OPENCAGE_KEY}&language=es&limit=5&no_annotations=0&proximity=<span class="math-inline">\{TEPIC\_CENTER\.lat\},</span>{TEPIC_CENTER.lon}&bounds=${opencageBounds}&countrycode=mx`;
    const { data: oc } = await axios.get(ocURL, { timeout: 4000, headers: { 'User-Agent': 'TaxiBot-API/1.1' } });
    const bestOc = oc.results?.find(r => r.geometry.lat >= latS && r.geometry.lat <= latN && r.geometry.lng >= lonW && r.geometry.lng <= lonE);
    if (bestOc) {
      openCageResult = { lat: bestOc.geometry.lat, lon: bestOc.geometry.lng, direccion: bestOc.formatted, source: 'opencage', quality: bestOc.confidence || 0, components: bestOc.components, sugerencias: oc.results.filter(r => r !== bestOc).map(r => r.formatted).slice(0, 2) };
      logger.debug(`OpenCage encontró: ${openCageResult.direccion} (Calidad: ${openCageResult.quality})`);
      if (openCageResult.quality >= 8) {
        logger.info(`Retornando resultado de OpenCage por buena calidad: ${openCageResult.direccion}`);
        return openCageResult;
      }
    }
  } catch (err) {
    if (err.response?.status === 401 || err.response?.status === 403) { logger.error('OpenCage: Error de autenticación/autorización. Verifica la API Key.'); }
    else if (err.code === 'ENOTFOUND') { logger.error('OpenCage: Error de conectividad de red'); }
    else if (err.code === 'ECONNABORTED') { logger.error('OpenCage: Timeout de conexión'); }
    else if (err.response?.status === 429) { logger.error('OpenCage: Límite de rate excedido'); }
    else { logger.warn('OpenCage falló o no encontró resultados válidos:', err.message); }
  }

  try {
    const mbURL = `https://api.mapbox.com/geocoding/v5/mapbox.places/<span class="math-inline">\{encodeURIComponent\(address\)\}\.json?language\=es&limit\=5&access\_token\=</span>{MAPBOX_TOKEN}&proximity=<span class="math-inline">\{TEPIC\_CENTER\.lon\},</span>{TEPIC_CENTER.lat}&bbox=${mapboxBbox}&country=mx&types=poi,address,neighborhood,locality,place,district,postcode,region`;
    const { data: mb } = await axios.get(mbURL, { timeout: 4000, headers: { 'User-Agent': 'TaxiBot-API/1.1' } });
    const bestMb = mb.features?.find(f => f.center[1] >= latS && f.center[1] <= latN && f.center[0] >= lonW && f.center[0] <= lonE);
    if (bestMb) {
      mapboxResult = { lat: bestMb.center[1], lon: bestMb.center[0], direccion: bestMb.place_name, source: 'mapbox', quality: bestMb.relevance || 0, components: bestMb.context?.reduce((acc, ctx) => { if (ctx.id.startsWith('postcode')) acc.postcode = ctx.text; if (ctx.id.startsWith('place')) acc.city = ctx.text; if (ctx.id.startsWith('locality')) acc.locality = ctx.text; if (ctx.id.startsWith('neighborhood')) acc.suburb = ctx.text; if (ctx.id.startsWith('district')) acc.district = ctx.text; if (ctx.id.startsWith('address')) acc.house_number = ctx.text.match(/^(\d+)/)?.[1]; if (ctx.id.startsWith('street')) acc.road = ctx.text; return acc; }, { city: bestMb.context?.find(c=>c.id.startsWith('place'))?.text }), place_type: bestMb.place_type, sugerencias: mb.features.filter(f => f !== bestMb).map(f => f.place_name).slice(0, 2) };
      logger.debug(`Mapbox encontró: ${mapboxResult.direccion} (Calidad: ${mapboxResult.quality})`);
    }
  } catch (err) {
    if (err.response?.status === 401 || err.response?.status === 403) { logger.error('Mapbox: Error de autenticación/autorización. Verifica el Token.'); }
    else if (err.code === 'ENOTFOUND') { logger.error('Mapbox: Error de conectividad de red'); }
    else if (err.code === 'ECONNABORTED') { logger.error('Mapbox: Timeout de conexión'); }
    else if (err.response?.status === 429) { logger.error('Mapbox: Límite de rate excedido'); }
    else { logger.warn('Mapbox falló o no encontró resultados válidos:', err.message); }
  }

  if (openCageResult && mapboxResult) {
    if (mapboxResult.quality >= openCageResult.quality * 0.8) {
      logger.info(`Ambos geocoders encontraron, eligiendo Mapbox: ${mapboxResult.direccion}`);
      return mapboxResult;
    }
    logger.info(`Ambos geocoders encontraron, eligiendo OpenCage: ${openCageResult.direccion}`);
    return openCageResult;
  } else if (openCageResult) {
    logger.info(`Retornando solo resultado de OpenCage: ${openCageResult.direccion}`);
    return openCageResult;
  } else if (mapboxResult) {
    logger.info(`Retornando solo resultado de Mapbox: ${mapboxResult.direccion}`);
    return mapboxResult;
  }

  logger.error(`No se pudo geocodificar "${address}" con ninguna API después de todos los intentos.`);
  throw new Error(`No se pudo geocodificar la dirección: ${address}`);
}

// ───── Geocode con caché ─────
async function geocodeWithCache(address) {
  const key = `geocode:${address.trim().toLowerCase().replace(/\s+/g, '-')}`;
  if (geoCache.has(key)) {
    logger.debug(`Cache HIT para geocode: "${address}" (key: ${key})`);
    return geoCache.get(key);
  }
  logger.debug(`Cache MISS para geocode: "${address}" (key: ${key})`);
  const result = await geocodeHybrid(address);
  geoCache.set(key, result);
  return result;
}

// ───── Reverse Geocode con caché ─────
async function reverseGeocodeWithCache(lat, lon) {
    const key = `reverse:<span class="math-inline">\{lat\.toFixed\(5\)\},</span>{lon.toFixed(5)}`;
    if (geoCache.has(key)) {
        logger.debug(`Cache HIT para reverseGeocode: <span class="math-inline">\{lat\},</span>{lon} (key: ${key})`);
        return geoCache.get(key);
    }
    logger.debug(`Cache MISS para reverseGeocode: <span class="math-inline">\{lat\},</span>{lon} (key: ${key})`);

    try {
        const ocURL = `https://api.opencagedata.com/geocode/v1/json?q=<span class="math-inline">\{lat\}\+</span>{lon}&key=${OPENCAGE_KEY}&language=es&limit=1&no_annotations=0&countrycode=mx`;
        const { data } = await axios.get(ocURL, { timeout: 4000, headers: { 'User-Agent': 'TaxiBot-API/1.1' } });
        const best = data.results?.[0];
        if (!best) { throw new Error('No se encontró dirección para las coordenadas (OpenCage).'); }
        const result = { direccion: best.formatted, source: 'opencage_reverse', quality: best.confidence || 0, components: best.components };
        geoCache.set(key, result);
        return result;
    } catch (err) {
        logger.error(`Error en reverseGeocodeWithCache para <span class="math-inline">\{lat\},</span>{lon}:`, err.message);
        if (err.response?.status === 401 || err.response?.status === 403) { logger.error('OpenCage (reverse): Error de autenticación/autorización. Verifica la API Key.'); }
        throw err;
    }
}

// ───── Parseo de enlaces Google Maps ─────
function parseGoogleMapsLink(rawUrl) {
  logger.debug('Parseando link de Google Maps:', rawUrl);
  try {
    const url = new URL(rawUrl);

    const atMatch = url.pathname.match(/@([-0-9.]+),([-0-9.]+)/);
    if (atMatch && atMatch[1] && atMatch[2]) {
      logger.debug(`Parseado tipo /@lat,lon: <span class="math-inline">\{atMatch\[1\]\},</span>{atMatch[2]}`);
      return { lat: parseFloat(atMatch[1]), lon: parseFloat(atMatch[2]) };
    }

    const qParam = url.searchParams.get('q');
    if (qParam) {
      const qParts = qParam.split(',');
      if (qParts.length === 2 && !isNaN(parseFloat(qParts[0])) && !isNaN(parseFloat(qParts[1]))) {
        logger.debug(`Parseado tipo ?q=lat,lon: <span class="math-inline">\{qParts\[0\]\},</span>{qParts[1]}`);
        return { lat: parseFloat(qParts[0]), lon: parseFloat(qParts[1]) };
      }
    }

    const llParam = url.searchParams.get('ll') || url.searchParams.get('sll');
    if (llParam) {
        const llParts = llParam.split(',');
        if (llParts.length === 2 && !isNaN(parseFloat(llParts[0])) && !isNaN(parseFloat(llParts[1]))) {
            logger.debug(`Parseado tipo ?ll=lat,lon: <span class="math-inline">\{llParts\[0\]\},</span>{llParts[1]}`);
            return { lat: parseFloat(llParts[0]), lon: parseFloat(llParts[1]) };
        }
    }

    const placeOrSearchMatch = url.pathname.match(/\/(?:place|search)\/([^\/]+)/);
    if (placeOrSearchMatch && placeOrSearchMatch[1]) {
      const queryText = decodeURIComponent(placeOrSearchMatch[1].split('/')[0]).replace(/\+/g, ' ');
      logger.debug(`Parseado tipo /place/ o /search/: ${queryText}`);
      return { q: queryText };
    }
    
    if (qParam) {
      const queryText = qParam.replace(/\+/g, ' ');
      logger.debug(`Parseado tipo ?q=Texto: ${queryText}`);
      return { q: queryText };
    }

    logger.warn('No se pudo extraer lat/lon o query de búsqueda del link:', rawUrl);
    return {};
  } catch (error) {
    logger.error('Error crítico parseando URL de Google Maps:', error.message, rawUrl);
    return {};
  }
}

// ───── Cálculo de Costo ─────
function calculateCost(km) {
  if (isNaN(km) || km < 0) {
    logger.error(`Intento de calcular costo con distancia inválida: ${km}`);
    return PRICING.BASE_PRICE;
  }

  let calculatedPrice = PRICING.BASE_PRICE;
  if (km <= PRICING.TIERS[0].maxKm) {
      calculatedPrice = PRICING.BASE_PRICE;
  } else if (km <= PRICING.TIERS[1].maxKm) {
      calculatedPrice = PRICING.BASE_PRICE + ((km - PRICING.TIERS[0].maxKm) * PRICING.TIERS[1].rate);
  } else if (km <= PRICING.TIERS[2].maxKm) {
      calculatedPrice = PRICING.BASE_PRICE +
                        ((PRICING.TIERS[1].maxKm - PRICING.TIERS[0].maxKm) * PRICING.TIERS[1].rate) +
                        ((km - PRICING.TIERS[1].maxKm) * PRICING.TIERS[2].rate);
  } else {
      calculatedPrice = PRICING.BASE_PRICE +
                        ((PRICING.TIERS[1].maxKm - PRICING.TIERS[0].maxKm) * PRICING.TIERS[1].rate) +
                        ((PRICING.TIERS[2].maxKm - PRICING.TIERS[1].maxKm) * PRICING.TIERS[2].rate) +
                        ((km - PRICING.TIERS[2].maxKm) * PRICING.TIERS[3].rate);
  }
  return Math.max(PRICING.BASE_PRICE, Math.round(calculatedPrice));
}

// ───── Helper para generar link de Google Maps ─────
function generateGoogleMapsLink(lat, lon, label = '') {
  const encodedLabel = encodeURIComponent(label);
  return `https://www.google.com/maps/search/?api=1&query=<span class="math-inline">\{lat\},</span>{lon}&query_place_id=${encodedLabel}`;
}

// ───── Servidor ─────
const app = express()
app.use(cors())
app.use(express.json({ limit: '500kb' }))
app.use(apiLimiter)

logger.info('Servidor Express iniciado - Configuración cargada, rate-limiter y caché LRU inicializados.')

// ─── POST /geocode_link ─────────────────────────────────────────
app.post('/geocode_link', async (req, res) => {
  const { url: originalUrl } = req.body;
  logger.debug(`POST /geocode_link - URL recibida: ${originalUrl}`);

  if (!originalUrl || !validators.url(originalUrl)) {
    return res.status(400).json({ error: 'URL inválida o no proporcionada.', code: 'INVALID_URL_FORMAT' });
  }

  let finalUrl = originalUrl;
  try {
    const response = await axios.get(originalUrl, {
      maxRedirects: 5,
      timeout: 5000,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36' }
    });
    finalUrl = response.request?.res?.responseUrl || response.config.url;
    logger.debug(`URL final tras redirecciones: ${finalUrl}`);
  } catch (err) {
    const loc = err.response?.headers?.location;
    if (loc && err.response?.status >= 300 && err.response?.status < 400) {
      finalUrl = loc;
      logger.debug(`Redirección manual a: ${finalUrl}`);
    } else {
      logger.warn(`Error menor resolviendo URL, se usará la original. Error: ${err.message}`);
    }
  }
  try {
    const parsedForSorry = new URL(finalUrl);
    if (parsedForSorry.hostname.includes('google.') && parsedForSorry.pathname.startsWith('/sorry')) {
      const continueParam = parsedForSorry.searchParams.get('continue');
      if (continueParam) {
        finalUrl = decodeURIComponent(continueParam);
        logger.debug(`Extrayendo parámetro 'continue': ${finalUrl}`);
      }
    }
  } catch (error) {
    logger.warn(`No se pudo procesar el 'continue parameter': ${error.message}`);
  }

  const info = parseGoogleMapsLink(finalUrl);
  logger.debug('Información parseada del link:', JSON.stringify(info));

  try {
    let resultData;
    if (info.lat != null && info.lon != null) {
      if (!validators.coordinates(info.lat, info.lon)) { return res.status(400).json({ error: 'Coordenadas inválidas en el link.', code: 'INVALID_COORDINATES_FROM_LINK' }); }
      const reverseData = await reverseGeocodeWithCache(info.lat, info.lon);
      const { calidad, precision_metros } = mapQualityToPrecision(reverseData.source, reverseData.quality, reverseData.direccion, 'Link con coordenadas');
      resultData = { lat: info.lat, lon: info.lon, direccion_encontrada: reverseData.direccion, calidad_evaluada: calidad, precision_estimada_metros: precision_metros, fuente_geocodificacion: reverseData.source, componentes_direccion: reverseData.components };
    } else if (info.q) {
      if (!validators.address(info.q)) { return res.status(400).json({ error: 'Texto de dirección inválido en el link.', code: 'INVALID_ADDRESS_FROM_LINK' }); }
      const geocodedData = await geocodeWithCache(info.q);
      const { calidad, precision_metros } = mapQualityToPrecision(geocodedData.source, geocodedData.quality, geocodedData.direccion, info.q);
      resultData = { lat: geocodedData.lat, lon: geocodedData.lon, direccion_encontrada: geocodedData.direccion, calidad_evaluada: calidad, precision_estimada_metros: precision_metros, fuente_geocodificacion: geocodedData.source, componentes_direccion: geocodedData.components };
    } else {
      return res.status(400).json({ error: 'No se pudo extraer información de ubicación del link.', code: 'UNPARSABLE_LINK_CONTENT' });
    }

    // Validación de área de servicio
    const [latS, lonW, latN, lonE] = bounds;
    if (resultData.lat < latS || resultData.lat > latN || resultData.lon < lonW || resultData.lon > lonE) {
      logger.warn(`Resultado de /geocode_link fuera de BOUNDS_NAYARIT.`);
      return res.status(400).json({ error: 'La dirección obtenida del link está fuera de nuestra área de servicio.', code: 'OUT_OF_BOUNDS' });
    }
    let componentsForMunicipality = resultData.components;
    if (!componentsForMunicipality && resultData.source !== 'predefined_poi') {
        const tempReverse = await reverseGeocodeWithCache(resultData.lat, resultData.lon);
        componentsForMunicipality = tempReverse.components;
    }
    let detectedMunicipality = '';
    if (componentsForMunicipality) {
        detectedMunicipality = (componentsForMunicipality.city || componentsForMunicipality.town || componentsForMunicipality.county || componentsForMunicipality.village || '').toLowerCase();
    }
    let isSpecificAllowedPoint = false;
    for (const point of ALLOWED_SPECIFIC_POINTS) {
        const distanceToPointMeters = getDistance({ latitude: resultData.lat, longitude: resultData.lon }, { latitude: point.lat, longitude: point.lon });
        if (distanceToPointMeters <= point.radiusKm * 1000) { isSpecificAllowedPoint = true; break; }
    }
    if (detectedMunicipality && !allowed.includes(detectedMunicipality) && !isSpecificAllowedPoint) {
        logger.warn(`Resultado de /geocode_link en municipio no permitido: ${detectedMunicipality}.`);
        return res.status(400).json({ error: `La dirección del link está en un municipio no cubierto (${detectedMunicipality.charAt(0).toUpperCase() + detectedMunicipality.slice(1)}).`, code: 'OUT_OF_SERVICE_AREA' });
    }
    return res.json(resultData);
  } catch (err) {
    logger.error(`Error procesando /geocode_link para "${finalUrl}": ${err.message}`, err.stack);
    if (err.message.includes('ninguna API') || err.message.includes('No se pudo geocodificar')) {
      return res.status(503).json({ error: 'Servicio de mapas no disponible o dirección no encontrada.', code: 'GEOCODING_UNAVAILABLE_OR_NOT_FOUND' });
    }
    return res.status(500).json({ error: 'Error interno del servidor al procesar el link.', code: 'INTERNAL_LINK_PROCESSING_ERROR' });
  }
});

// ─── POST /reverse_origin ────────────────────────────────────────
app.post('/reverse_origin', async (req, res) => {
  const { lat, lon } = req.body;
  logger.debug(`POST /reverse_origin - coordenadas: lat=<span class="math-inline">\{lat\}, lon\=</span>{lon}`);

  if (lat == null || lon == null || !validators.coordinates(lat, lon)) {
    return res.status(400).json({ error: 'Coordenadas (lat, lon) inválidas o no proporcionadas.', code: 'INVALID_COORDINATES' });
  }

  try {
    const result = await reverseGeocodeWithCache(lat, lon);
    const { calidad, precision_metros } = mapQualityToPrecision(result.source, result.quality, result.direccion, `<span class="math-inline">\{lat\},</span>{lon}`);

    return res.json({ direccion_origen: result.direccion, source: result.source, quality_score: result.quality, calidad_evaluada: calidad, precision_estimada_metros: precision_metros, componentes_direccion: result.components });
  } catch (err) {
    logger.error(`Error en /reverse_origin para <span class="math-inline">\{lat\},</span>{lon}: ${err.message}`, err.stack);
    if (err.message.includes('No se encontró dirección')) { return res.status(404).json({ error: 'No se encontró dirección para estas coordenadas.', code: 'ADDRESS_NOT_FOUND_REVERSE' }); }
    if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT') { return res.status(408).json({ error: 'Timeout en el servicio de geocodificación inversa.', code: 'REVERSE_GEOCODING_TIMEOUT' }); }
    if (err.response?.status === 429) { return res.status(429).json({ error: 'Límite de peticiones al servicio de geocodificación excedido.', code: 'RATE_LIMIT_EXCEEDED_EXTERNAL' }); }
    if (err.response?.status === 401 || err.response?.status === 403) { return res.status(503).json({ error: 'Problema con la configuración del servicio de geocodificación (auth).', code: 'EXTERNAL_SERVICE_AUTH_ERROR' }); }
    return res.status(500).json({ error: 'Error interno del servidor en geocodificación inversa.', code: 'INTERNAL_REVERSE_GEOCODING_ERROR' });
  }
});


// ─── POST /validate_address ────────────────────────
app.post('/validate_address', async (req, res) => {
  const { direccion } = req.body;
  logger.debug(`POST /validate_address - direccion: "${direccion}"`);

  if (!direccion || !validators.address(direccion)) {
    return res.status(400).json({ error: 'Dirección no proporcionada o inválida.', code: 'INVALID_ADDRESS_INPUT' });
  }

  try {
    const result = await geocodeHybrid(direccion);
    const { calidad, precision_metros } = mapQualityToPrecision(result.source, result.quality, result.direccion, direccion);
    const analisis = { es_poi_conocido: result.source === 'predefined_poi', tiene_numero_calle: false, tiene_colonia_barrio: false, tiene_ciudad_principal: false, sugerencias_geocoder: result.sugerencias || [] };
    if (result.components) {
      const comps = result.components;
      analisis.tiene_numero_calle = !!(comps.house_number || comps.street_number || (comps.road && /\d/.test(comps.road)));
      analisis.tiene_colonia_barrio = !!(comps.suburb || comps.neighbourhood || comps.residential || comps.city_district || comps.locality);
      analisis.tiene_ciudad_principal = !!(comps.city && allowed.includes(comps.city.toLowerCase())) || !!(comps.town && allowed.includes(comps.town.toLowerCase()));
      if (!analisis.es_poi_conocido) {
          if (result.source === 'mapbox' && result.place_type && (result.place_type.includes('poi') || result.place_type.includes('landmark'))) analisis.es_poi_geocodificado = true;
          else if (result.source === 'opencage' && comps._category === 'poi') analisis.es_poi_geocodificado = true;
      }
    } else if (result.direccion) {
      if (/\d/.test(result.direccion)) analisis.tiene_numero_calle = true;
      if (/(colonia|fraccionamiento|barrio|residencial)/i.test(result.direccion)) analisis.tiene_colonia_barrio = true;
      if (/(tepic|xalisco)/i.test(result.direccion)) analisis.tiene_ciudad_principal = true;
    }
    return res.json({ lat: result.lat, lon: result.lon, direccion_encontrada: result.direccion, calidad_evaluada: calidad, precision_estimada_metros: precision_metros, analisis_direccion: analisis, fuente_geocodificacion: result.source, componentes_direccion: result.components });
  } catch (err) {
    logger.error(`Error en /validate_address para "${direccion}": ${err.message}`, err.stack);
    if (err.message.includes('No se pudo geocodificar') || err.message.includes('ninguna API')) {
      return res.status(404).json({ error: 'No se pudo encontrar o validar la dirección proporcionada.', code: 'ADDRESS_VALIDATION_NOT_FOUND' });
    }
    return res.status(500).json({ error: 'Error interno del servidor al validar la dirección.', code: 'INTERNAL_ADDRESS_VALIDATION_ERROR' });
  }
});


// ─── POST /geocode_text ─────────────────────────────────────────
app.post('/geocode_text', async (req, res) => {
  const { direccion } = req.body;
  logger.debug(`POST /geocode_text - direccion: "${direccion}"`);

  if (!direccion || !validators.address(direccion)) {
    return res.status(400).json({ error: 'Dirección no proporcionada o inválida.', code: 'INVALID_ADDRESS_INPUT' });
  }

  try {
    const result = await geocodeWithCache(direccion);
    const { calidad, precision_metros } = mapQualityToPrecision(result.source, result.quality, result.direccion, direccion);
    const [latS, lonW, latN, lonE] = bounds;
    if (result.lat < latS || result.lat > latN || result.lon < lonW || result.lon > lonE) {
      logger.warn(`Dirección "<span class="math-inline">\{result\.direccion\}" en \(</span>{result.lat}, ${result.lon}) está fuera de los BOUNDS definidos.`);
      return res.status(400).json({ error: 'La dirección está fuera de nuestra área de servicio geográfica principal.', code: 'OUT_OF_BOUNDS' });
    }
    let detectedMunicipality = '';
    if (result.components) {
      detectedMunicipality = (result.components.city || result.components.town || result.components.county || result.components.village || '').toLowerCase();
      logger.debug(`Municipio detectado de componentes directos: "${detectedMunicipality}"`);
    }
    if (!detectedMunicipality || !allowed.includes(detectedMunicipality)) {
      logger.debug(`Municipio no en componentes directos o no permitido ("${detectedMunicipality}"), intentando reverse geocoding para <span class="math-inline">\{result\.lat\},</span>{result.lon}`);
      try {
        const reverseData = await reverseGeocodeWithCache(result.lat, result.lon);
        if (reverseData.components) {
          detectedMunicipality = (reverseData.components.city || reverseData.components.town || reverseData.components.county || reverseData.components.village || '').toLowerCase();
          logger.debug(`Municipio detectado por reverse geocoding: "${detectedMunicipality}"`);
        }
      } catch (reverseErr) {
        logger.warn(`Falló el reverse geocoding para validación de municipio en /geocode_text: ${reverseErr.message}`);
      }
    }
    let isSpecificAllowedPoint = false;
    for (const point of ALLOWED_SPECIFIC_POINTS) {
      const distanceToPointMeters = getDistance({ latitude: result.lat, longitude: result.lon }, { latitude: point.lat, longitude: point.lon });
      if (distanceToPointMeters <= point.radiusKm * 1000) { isSpecificAllowedPoint = true; logger.info(`Dirección "${result.direccion}" coincide con punto específico permitido: ${point.name}`); break; }
    }
    if (!isSpecificAllowedPoint && detectedMunicipality && !allowed.includes(detectedMunicipality)) {
      logger.warn(`Dirección "${result.direccion}" en municipio no permitido: ${detectedMunicipality}`);
      return res.status(400).json({ error: `Solo operamos en: ${allowed.map(m => m.charAt(0).toUpperCase() + m.slice(1)).join(', ')} y puntos específicos. Tu dirección parece estar en ${detectedMunicipality.charAt(0).toUpperCase() + detectedMunicipality.slice(1)}.`, code: 'OUT_OF_SERVICE_AREA' });
    }
    if (!isSpecificAllowedPoint && !detectedMunicipality) {
        logger.warn(`No se pudo determinar el municipio para "${result.direccion}" y no es un punto específico.`);
    }
    res.json({ datos: { lat: result.lat, lon: result.lon, direccion_encontrada: result.direccion, precision_estimada_metros: precision_metros, calidad_evaluada: calidad }, analisis: { sugerencias: result.sugerencias || [] }, fuente_geocodificacion: result.source, componentes_direccion: result.components });
  } catch (err) {
    logger.error(`Error en /geocode_text para "${direccion}": ${err.message}`, err.stack);
    if (err.response?.status === 400 && (err.response.data?.code === 'OUT_OF_SERVICE_AREA' || err.response.data?.code === 'OUT_OF_BOUNDS')) { return res.status(400).json(err.response.data); }
    if (err.message.includes('No se pudo geocodificar') || err.message.includes('ninguna API')) { return res.status(404).json({ error: 'No se encontró la dirección solicitada.', code: 'ADDRESS_NOT_FOUND_GEOCODE_TEXT' }); }
    return res.status(500).json({ error: 'Error interno del servidor al geocodificar la dirección.', code: 'INTERNAL_GEOCODING_TEXT_ERROR' });
  }
});


// CAMBIO: Endpoint renombrado de /generate_map a /calculate_fare
// ¡¡¡DEBES ACTUALIZAR ESTA URL EN TU CÓDIGO DE BOTPRESS!!!
app.post('/calculate_fare', async (req, res) => {
  const { lat1, lon1, lat2, lon2, destino, telefono } = req.body;
  logger.debug(`POST /calculate_fare - Origen: (<span class="math-inline">\{lat1\},</span>{lon1}), Destino: "<span class="math-inline">\{destino\}", Coords\: \(</span>{lat2},${lon2}), Tel: ${telefono}`);

  if (lat1 == null || lon1 == null || !validators.coordinates(lat1, lon1)) { return res.status(400).json({ error: 'Coordenadas de origen (lat1, lon1) inválidas o no proporcionadas.', code: 'INVALID_ORIGIN_COORDINATES' }); }
  if (!telefono || !validators.phone(telefono)) { return res.status(400).json({ error: 'Número de teléfono no proporcionado o inválido.', code: 'INVALID_PHONE_NUMBER' }); }

  let destinationResult;
  if (lat2 != null && lon2 != null && validators.coordinates(lat2, lon2)) {
    logger.info(`✅ Usando coordenadas directas para destino: (${lat2}, ${lon2})`);
    const direccionDestino = destino && destino.trim() && destino !== 'undefined' ? destino : 'Ubicación seleccionada';
    destinationResult = { lat: lat2, lon: lon2, direccion: direccionDestino };
    const [latS, lonW, latN, lonE] = bounds;
    if (lat2 < latS || lat2 > latN || lon2 < lonW || lon2 > lonE) {
      logger.warn(`Coordenadas de destino (${lat2}, ${lon2}) fuera de BOUNDS.`);
      return res.status(400).json({ error: 'El destino está fuera de nuestra área de servicio geográfica.', code: 'DESTINATION_OUT_OF_BOUNDS' });
    }
  } else {
    if (!destino || !validators.address(destino) || destino === 'undefined') { return res.status(400).json({ error: 'Dirección de destino no proporcionada o inválida.', code: 'INVALID_DESTINATION_ADDRESS_TEXT' }); }
    logger.info(`🔍 Geocodificando destino: "${destino}"`);
    try {
      destinationResult = await geocodeWithCache(destino);
      const [latS, lonW, latN, lonE] = bounds;
      if (destinationResult.lat < latS || destinationResult.lat > latN || destinationResult.lon < lonW || destinationResult.lon > lonE) {
        logger.warn(`Destino geocodificado "${destinationResult.direccion}" fuera de BOUNDS.`);
        return res.status(400).json({ error: 'La dirección de destino está fuera de nuestra área de servicio geográfica.', code: 'DESTINATION_OUT_OF_BOUNDS' });
      }
    } catch (e) {
      logger.error(`Error geocodificando destino "${destino}": ${e.message}`);
      if (e.message.includes('No se pudo geocodificar')) { return res.status(404).json({ error: 'No se pudo encontrar la dirección de destino.', code: 'DESTINATION_ADDRESS_NOT_FOUND' }); }
      return res.status(500).json({ error: 'Error interno al procesar la dirección de destino.', code: 'DESTINATION_PROCESSING_ERROR' });
    }
  }

  const { lat: lat2Final, lon: lon2Final, direccion: direccionDestino } = destinationResult;

  try {
    const distMeters = getDistance({ latitude: lat1, longitude: lon1 }, { latitude: lat2Final, longitude: lon2Final });
    const distKm = parseFloat((distMeters / 1000).toFixed(2));
    const costo = calculateCost(distKm);
    const linkOrigen = generateGoogleMapsLink(lat1, lon1, "Punto de partida");
    const linkDestino = generateGoogleMapsLink(lat2Final, lon2Final, direccionDestino);

    logger.info(`✅ Viaje calculado: De (<span class="math-inline">\{lat1\},</span>{lon1}) a "<span class="math-inline">\{direccionDestino\}" \(</span>{lat2Final},${lon2Final}). Distancia: ${distKm}km. Costo: $${costo}. Tel: ${telefono}`);

    return res.json({
      mensaje: 'Tarifa calculada correctamente.',
      datos: {
        lat_origen: lat1,
        lon_origen: lon1,
        lat_destino: lat2Final,
        lon_destino: lon2Final,
        direccion_destino: direccionDestino,
        link_Maps_destino: linkDestino,
        link_Maps_origen: linkOrigen,
        distancia_km: distKm,
        costo_estimado: costo,
        moneda: "MXN",
        telefono_registrado: telefono
      }
    });
  } catch (error) {
    logger.error(`Error calculando distancia para viaje a "${direccionDestino}": ${error.message}`);
    return res.status(500).json({ error: 'Error interno al calcular la tarifa del viaje.', code: 'FARE_CALCULATION_ERROR' });
  }
});

// ───── Manejo de errores globales ─────
app.use((err, req, res, next) => {
  logger.error('Error no manejado detectado por el middleware global:', { message: err.message, stack: err.stack, url: req.originalUrl, method: req.method, ip: req.ip });
  const errorResponse = { error: 'Error interno del servidor. Por favor, intente más tarde.', code: 'INTERNAL_SERVER_ERROR' };
  if (process.env.NODE_ENV !== 'production') { errorResponse.details = err.message; }
  res.status(err.status || 500).json(errorResponse);
});

// ───── Endpoint de salud ─────
app.get('/health', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.json({ status: 'OK', timestamp: new Date().toISOString(), uptime: process.uptime ? `${Math.floor(process.uptime())}s` : 'N/A', cache_size: geoCache.size, cache_length: geoCache.length });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  logger.info(`🚀 API de Taxis (Automanager Drive) corriendo en puerto ${PORT}`);
  logger.info(`   -> Entorno: ${process.env.NODE_ENV || 'development'}`);
  logger.info(`   -> Municipios Permitidos: ${allowed.join(', ')}`);
  logger.info(`   -> Puntos Específicos Permitidos: ${ALLOWED_SPECIFIC_POINTS.map(p => p.name).join(', ') || 'Ninguno'}`);
  logger.info(`   -> POIs Adicionales Cargados: ${Object.keys(POIS_ADICIONALES).length}`);
  logger.info(`   -> Caché LRU inicializada: Max ${geoCache.max} elementos, TTL ${geoCache.ttl / (1000 * 60 * 60)} horas.`);
});
