import express      from 'express'
import cors         from 'cors'
import axios        from 'axios'
import dotenv       from 'dotenv'
import rateLimit    from 'express-rate-limit'
import { LRUCache } from 'lru-cache'
import { getDistance } from 'geolib'

dotenv.config()

// ───── Validación de Variables de Entorno ─────
const requiredEnvVars = ['OPENCAGE_API_KEY', 'MAPBOX_TOKEN', 'BOUNDS_NAYARIT', 'ALLOWED_MUNICIPIOS']
for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    console.error(`❌ Error: Variable de entorno ${envVar} es requerida`)
    process.exit(1)
  }
}

// ───── Configuración ─────
const OPENCAGE_KEY = process.env.OPENCAGE_API_KEY
const MAPBOX_TOKEN = process.env.MAPBOX_TOKEN
const bounds       = process.env.BOUNDS_NAYARIT.split(',').map(Number)
const allowed      = process.env.ALLOWED_MUNICIPIOS
  .split(',')
  .map(m => m.trim().toLowerCase())

// ───── Constantes de Pricing ─────
const PRICING = {
  BASE_PRICE: 50,
  TIERS: [
    { maxKm: 5, rate: null },      // Tarifa base hasta 5km
    { maxKm: 10, rate: 10 },       // $10 por km hasta 10km
    { maxKm: 15, rate: 9 },        // $9 por km hasta 15km
    { maxKm: Infinity, rate: 8 }   // $8 por km para más de 15km
  ]
}

// ───── Rate Limiter ─────
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutos
  max: 100,                  // hasta 100 peticiones por IP
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Demasiadas peticiones, intenta de nuevo más tarde.',
    code: 'TOO_MANY_REQUESTS'
  }
})

// ───── Caché LRU ─────
const geoCache = new LRUCache({
  max: 500,
  ttl: 1000 * 60 * 60 * 24   // 24 horas
})

// ───── Logger Mejorado ─────
const logger = {
  info: (msg, ...args) => console.log(`[INFO] ${msg}`, ...args),
  warn: (msg, ...args) => console.warn(`[WARN] ${msg}`, ...args),
  error: (msg, ...args) => console.error(`[ERROR] ${msg}`, ...args),
  debug: (msg, ...args) => process.env.NODE_ENV !== 'production' && console.log(`[DEBUG] ${msg}`, ...args)
}

// ───── Validadores ─────
const validators = {
  coordinates: (lat, lon) => {
    return typeof lat === 'number' && typeof lon === 'number' &&
           lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180
  },
  
  url: (url) => {
    try {
      new URL(url)
      return true
    } catch {
      return false
    }
  },
  
  phone: (telefono) => {
    return typeof telefono === 'string' && telefono.trim().length > 0
  },
  
  address: (address) => {
    return typeof address === 'string' && address.trim().length > 0
  }
}

// ───── Geocode híbrido (texto) ─────
async function geocodeHybrid(address) {
  logger.debug(`geocodeHybrid iniciado para: "${address}"`)
  
  // 1) OpenCage con timeout y manejo robusto
  try {
    const ocURL = `https://api.opencagedata.com/geocode/v1/json`
      + `?q=${encodeURIComponent(address)}`
      + `&key=${OPENCAGE_KEY}`
      + `&language=es&limit=1&no_annotations=0`
    
    const { data: oc } = await axios.get(ocURL, { 
      timeout: 5000,
      headers: { 'User-Agent': 'Geocoding-API/1.0' }
    })
    
    const best = oc.results?.[0]
    if (best) {
      const accuracy = best.annotations?.accuracy
        ?? (best.annotations?.confidence
             ? best.annotations.confidence * 100
             : 999)
      if (accuracy <= 100) {
        const { lat, lng } = best.geometry
        logger.debug(`OpenCage exitoso - precisión: ${accuracy}m`)
        return { lat, lon: lng, direccion: best.formatted, source: 'opencage', accuracy }
      }
    }
  } catch (err) {
    if (err.code === 'ENOTFOUND') {
      logger.error('OpenCage: Error de conectividad de red')
    } else if (err.code === 'ECONNABORTED') {
      logger.error('OpenCage: Timeout de conexión')
    } else if (err.response?.status === 429) {
      logger.error('OpenCage: Límite de rate excedido')
    } else {
      logger.warn('OpenCage falló:', err.message)
    }
  }

  // 2) Mapbox con timeout y manejo robusto
  try {
    const mbURL = `https://api.mapbox.com/geocoding/v5/mapbox.places/`
      + `${encodeURIComponent(address)}.json`
      + `?language=es&limit=1&access_token=${MAPBOX_TOKEN}`
    
    const { data: mb } = await axios.get(mbURL, { 
      timeout: 5000,
      headers: { 'User-Agent': 'Geocoding-API/1.0' }
    })
    
    const place = mb.features?.[0]
    if (place) {
      const [lon, lat] = place.center
      logger.debug('Mapbox exitoso')
      return { lat, lon, direccion: place.place_name, source: 'mapbox', accuracy: 150 }
    }
  } catch (err) {
    if (err.code === 'ENOTFOUND') {
      logger.error('Mapbox: Error de conectividad de red')
    } else if (err.code === 'ECONNABORTED') {
      logger.error('Mapbox: Timeout de conexión')
    } else if (err.response?.status === 429) {
      logger.error('Mapbox: Límite de rate excedido')
    } else {
      logger.warn('Mapbox falló:', err.message)
    }
  }

  throw new Error('No se pudo geocodificar con ninguna API')
}

// ───── Geocode con caché ─────
async function geocodeWithCache(address) {
  const key = address.trim().toLowerCase()
  if (geoCache.has(key)) {
    logger.debug(`Cache HIT para: "${key}"`)
    return geoCache.get(key)
  }
  logger.debug(`Cache MISS para: "${key}"`)
  const result = await geocodeHybrid(address)
  geoCache.set(key, result)
  return result
}

// ───── Parseo de enlaces Google Maps ─────
function parseGoogleMapsLink(raw) {
  logger.debug('Parseando link de Google Maps:', raw)
  try {
    const url = new URL(raw)

    // 1) /@lat,lon,
    const at = url.pathname.match(/@([-0-9.]+),([-0-9.]+)/)
    if (at) return { lat: +at[1], lon: +at[2] }

    // 2) /place/<dirección>
    const placeMatch = url.pathname.match(/\/place\/([^\/]+)/)
    if (placeMatch) {
      const q = decodeURIComponent(placeMatch[1]).replace(/\+/g, ' ')
      return { q }
    }

    // 3) ?q=Texto+dirección
    const qParam = url.searchParams.get('q')
    if (qParam) return { q: qParam.replace(/\+/g, ' ') }

    return {}
  } catch (error) {
    logger.warn('Error parseando URL:', error.message)
    return {}
  }
}

// ───── Cálculo de Costo ─────
function calculateCost(km) {
  for (const tier of PRICING.TIERS) {
    if (km <= tier.maxKm) {
      if (tier.rate === null) return PRICING.BASE_PRICE
      return Math.max(PRICING.BASE_PRICE, Math.round(km * tier.rate))
    }
  }
  return PRICING.BASE_PRICE
}

// ───── Servidor ─────
const app = express()
app.use(cors())
app.use(express.json({ limit: '1mb' }))
app.use(apiLimiter)

logger.info('Servidor iniciado - Configuración cargada, límites y caché inicializados')

// ─── POST /geocode_link ─────────────────────────────────────────
app.post('/geocode_link', async (req, res) => {
  const { url } = req.body
  logger.debug('POST /geocode_link - URL recibida:', url)
  
  // Validación de entrada
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'URL requerida y debe ser string', code: 'INVALID_URL' })
  }
  
  if (!validators.url(url)) {
    return res.status(400).json({ error: 'URL inválida', code: 'MALFORMED_URL' })
  }

  // 1) Sigue redirección de short links con timeout
  let finalUrl = url
  try {
    await axios.get(url, { 
      maxRedirects: 0, 
      timeout: 3000,
      headers: { 'User-Agent': 'Geocoding-API/1.0' }
    })
  } catch (err) {
    const loc = err.response?.headers?.location
    if (loc && err.response?.status >= 300 && err.response?.status < 400) {
      finalUrl = loc
      logger.debug('URL redirigida a:', finalUrl)
    } else if (err.code === 'ECONNABORTED') {
      return res.status(408).json({ error: 'Timeout al acceder a la URL', code: 'URL_TIMEOUT' })
    }
  }

  // 2) Si es página de "/sorry/index", extrae el parámetro continue
  try {
    const u = new URL(finalUrl)
    if (u.hostname.includes('google.com') && u.pathname.startsWith('/sorry')) {
      const cont = u.searchParams.get('continue')
      if (cont) {
        const decoded = decodeURIComponent(cont)
        logger.debug('Extrayendo continue parameter:', decoded)
        finalUrl = decoded
      }
    }
  } catch (error) {
    logger.warn('Error procesando continue parameter:', error.message)
  }

  // 3) Parsear coords o texto
  const info = parseGoogleMapsLink(finalUrl)
  logger.debug('Información parseada del link:', info)

  try {
    if (info.lat != null && info.lon != null) {
      if (!validators.coordinates(info.lat, info.lon)) {
        return res.status(400).json({ error: 'Coordenadas inválidas', code: 'INVALID_COORDINATES' })
      }
      return res.json({ lat: info.lat, lon: info.lon, direccion: 'Coordenadas directas' })
    }
    
    if (info.q) {
      if (!validators.address(info.q)) {
        return res.status(400).json({ error: 'Dirección inválida', code: 'INVALID_ADDRESS' })
      }
      const data = await geocodeWithCache(info.q)
      return res.json(data)
    }
    
    return res.status(400).json({
      error: 'No se encontró lat/lon ni parámetro q en el link',
      code: 'INVALID_LINK'
    })
  } catch (err) {
    logger.error('Error procesando link:', err.message)
    if (err.message.includes('ninguna API')) {
      return res.status(503).json({
        error: 'Servicios de geocodificación temporalmente no disponibles',
        code: 'GEOCODING_SERVICE_UNAVAILABLE'
      })
    }
    return res.status(500).json({
      error: 'Error interno procesando el link',
      code: 'LINK_PROCESSING_ERROR'
    })
  }
})

// ─── POST /reverse_origin ────────────────────────────────────────
app.post('/reverse_origin', async (req, res) => {
  const { lat, lon } = req.body
  logger.debug('POST /reverse_origin - coordenadas:', { lat, lon })
  
  // Validación de entrada
  if (lat == null || lon == null) {
    return res.status(400).json({ error: 'Coordenadas lat y lon son requeridas', code: 'MISSING_COORDS' })
  }
  
  if (!validators.coordinates(lat, lon)) {
    return res.status(400).json({ error: 'Coordenadas inválidas', code: 'INVALID_COORDINATES' })
  }
  
  try {
    const ocURL = `https://api.opencagedata.com/geocode/v1/json`
      + `?q=${lat}+${lon}`
      + `&key=${OPENCAGE_KEY}`
      + `&language=es&limit=1&no_annotations=0`
    
    const { data } = await axios.get(ocURL, { 
      timeout: 5000,
      headers: { 'User-Agent': 'Geocoding-API/1.0' }
    })
    
    const best = data.results?.[0]
    if (!best) {
      return res.status(404).json({ 
        error: 'No se encontró dirección para estas coordenadas', 
        code: 'ADDRESS_NOT_FOUND' 
      })
    }
    
    return res.json({
      direccion_origen: best.formatted,
      source: 'opencage',
      accuracy: best.annotations?.accuracy ?? 999
    })
  } catch (err) {
    logger.error('Error en reverse geocoding:', err.message)
    if (err.code === 'ECONNABORTED') {
      return res.status(408).json({
        error: 'Timeout en servicio de geocodificación',
        code: 'GEOCODING_TIMEOUT'
      })
    }
    if (err.response?.status === 429) {
      return res.status(429).json({
        error: 'Límite de requests excedido, intenta más tarde',
        code: 'RATE_LIMIT_EXCEEDED'
      })
    }
    return res.status(500).json({
      error: 'Error interno en reverse geocoding',
      code: 'REVERSE_GEOCODE_ERROR'
    })
  }
})

// ─── POST /generate_map ─────────────────────────────────────────
app.post('/generate_map', async (req, res) => {
  const { lat1, lon1, destino, telefono } = req.body
  logger.debug('POST /generate_map - datos:', req.body)
  
  // Validación de entrada
  if (lat1 == null || lon1 == null || !destino || !telefono) {
    return res.status(400).json({ error: 'Todos los campos son requeridos: lat1, lon1, destino, telefono', code: 'MISSING_PARAMS' })
  }
  
  if (!validators.coordinates(lat1, lon1)) {
    return res.status(400).json({ error: 'Coordenadas de origen inválidas', code: 'INVALID_ORIGIN_COORDS' })
  }
  
  if (!validators.address(destino)) {
    return res.status(400).json({ error: 'Destino inválido', code: 'INVALID_DESTINATION' })
  }
  
  if (!validators.phone(telefono)) {
    return res.status(400).json({ error: 'Teléfono inválido', code: 'INVALID_PHONE' })
  }

  // 1) Geocode destino (cache + hybrid)
  let result
  try {
    result = await geocodeWithCache(destino)
  } catch (e) {
    logger.error('Error geocodificando destino:', e.message)
    if (e.message.includes('ninguna API')) {
      return res.status(404).json({ error: 'No se encontró el destino', code: 'DESTINO_NOT_FOUND' })
    }
    return res.status(503).json({ 
      error: 'Servicios de geocodificación no disponibles', 
      code: 'GEOCODING_SERVICE_ERROR' 
    })
  }
  
  const { lat, lon, direccion, source } = result
  logger.debug(`Destino geocodificado: ${direccion} (${lat},${lon}) fuente=${source}`)

  // 2) Verificar municipio (solo OpenCage)
  if (source === 'opencage') {
    try {
      const ocURL = `https://api.opencagedata.com/geocode/v1/json`
        + `?q=${lat}+${lon}`
        + `&key=${OPENCAGE_KEY}`
        + `&language=es&limit=1`
      
      const response = await axios.get(ocURL, { 
        timeout: 5000,
        headers: { 'User-Agent': 'Geocoding-API/1.0' }
      })
      
      const comps = response.data.results[0]?.components || {}
      const municipio = (comps.city || comps.town || comps.village || comps.county || '').toLowerCase()
      
      if (municipio && !allowed.includes(municipio)) {
        return res.status(400).json({
          error: `Solo operamos en: ${allowed.map(m => m[0].toUpperCase()+m.slice(1)).join(', ')}.`,
          code: 'OUT_OF_SERVICE_AREA'
        })
      }
    } catch (e) {
      logger.warn('No se pudo verificar municipio:', e.message)
    }
  }

  // 3) Verificar bounds
  const [latS, lonW, latN, lonE] = bounds
  if (lat < latS || lat > latN || lon < lonW || lon > lonE) {
    return res.status(400).json({ 
      error: 'La dirección está fuera de nuestra área de servicio', 
      code: 'OUT_OF_BOUNDS' 
    })
  }

  // 4) Calcular distancia y costo
  try {
    const distM = getDistance({ latitude: lat1, longitude: lon1 }, { latitude: lat, longitude: lon })
    const km = Math.round(distM / 10) / 100
    const costo = calculateCost(km)
    
    logger.debug(`Distancia calculada: ${km}km → costo: $${costo}`)

    return res.json({
      mensaje: 'Precio calculado correctamente.',
      datos: {
        lat_origen: lat1,    lon_origen: lon1,
        lat_destino: lat,    lon_destino: lon,
        direccion_destino: direccion,
        distancia_km: km.toFixed(2),
        costo_estimado: costo,
        telefono
      }
    })
  } catch (error) {
    logger.error('Error calculando distancia:', error.message)
    return res.status(500).json({
      error: 'Error calculando la distancia',
      code: 'DISTANCE_CALCULATION_ERROR'
    })
  }
})

// ───── Manejo de errores globales ─────
app.use((err, req, res, next) => {
  logger.error('Error no manejado:', err.message)
  res.status(500).json({
    error: 'Error interno del servidor',
    code: 'INTERNAL_SERVER_ERROR'
  })
})

// ───── Endpoint de salud ─────
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    cache_size: geoCache.size
  })
})

const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
  logger.info(`API corriendo en http://localhost:${PORT}`)
  logger.info(`Cache inicializado - Municipios permitidos: ${allowed.join(', ')}`)
})