/*********************************************************************
 *  API DE VIAJES –  versión con geocodificador híbrido
 *  1) Intenta OpenCage. Si la precisión es > 100 m ó falla,
 *  2) Reintenta con Mapbox Geocoding.
 *********************************************************************/

import express   from 'express'
import cors      from 'cors'
import axios     from 'axios'
import dotenv    from 'dotenv'
import { getDistance } from 'geolib'

// ───────────────────────── cargar variables .env
dotenv.config()
const OPENCAGE_KEY  = process.env.OPENCAGE_API_KEY
const MAPBOX_TOKEN  = process.env.MAPBOX_TOKEN         // ← NUEVO
const bounds        = process.env.BOUNDS_NAYARIT.split(',').map(Number)
const allowed       = process.env.ALLOWED_MUNICIPIOS.split(',')
                     .map(m => m.trim().toLowerCase())

// ───────────────────────── helpers ────────────────────────────────
async function geocodeHybrid (lat, lon) {
  /* ---------- 1️⃣  OpenCage ---------- */
  const ocURL =
    `https://api.opencagedata.com/geocode/v1/json?q=${lat}+${lon}` +
    `&key=${OPENCAGE_KEY}&no_annotations=0&language=es&limit=1`

  try {
    const { data: oc } = await axios.get(ocURL)
    const best         = oc.results[0]

    if (best) {
      const accuracy =
        best.annotations?.accuracy /* m */ ??
        (best.annotations?.confidence ? best.annotations.confidence * 100 : 999)

      if (accuracy <= 100) {
        return { address: best.formatted, source: 'opencage', accuracy }
      }
    }
  } catch (err) {
    console.warn('OpenCage falló →', err.message)
  }

  /* ---------- 2️⃣  Mapbox (fallback) ---------- */
  const mbURL =
    `https://api.mapbox.com/geocoding/v5/mapbox.places/${lon},${lat}.json` +
    `?language=es&types=address,poi&limit=1&access_token=${MAPBOX_TOKEN}`

  const { data: mb } = await axios.get(mbURL)
  const place        = mb.features?.[0]

  if (place) {
    const accuracy = place.properties?.accuracy || 150
    return { address: place.place_name, source: 'mapbox', accuracy }
  }

  throw new Error('No se pudo geocodificar con ninguna API')
}

// ───────────────────────── servidor ───────────────────────────────
const app = express()
app.use(cors())
app.use(express.json())

/* ================================================================
 *  /generate_map  (sin cambios)
 * ================================================================*/
app.post('/generate_map', async (req, res) => {
  const { lat1, lon1, destino, telefono } = req.body
  if (!lat1 || !lon1 || !destino || !telefono) {
    return res.status(400).json({ error: 'Faltan datos requeridos.' })
  }

  try {
    /* ---------- OpenCage directo para el DESTINO ---------- */
    const url =
      `https://api.opencagedata.com/geocode/v1/json?q=${encodeURIComponent(destino)}` +
      `&key=${OPENCAGE_KEY}&countrycode=mx&limit=1`

    const { data } = await axios.get(url)
    if (!data.results.length) {
      return res.status(404).json({ error: 'No se encontró el destino.' })
    }

    const result      = data.results[0]
    const { lat, lng } = result.geometry
    const comps       = result.components

    /* 1) municipio permitido */
    const municipio = (
      comps.city || comps.town || comps.village || comps.county
    ).toLowerCase()

    if (!allowed.includes(municipio)) {
      return res.status(400).json({
        error: `Solo operamos en: ${allowed
          .map(u => u[0].toUpperCase() + u.slice(1))
          .join(', ')}.`
      })
    }

    /* 2) dentro de los bounds */
    const [latSur, lonOeste, latNorte, lonEste] = bounds
    if (lat < latSur || lat > latNorte || lng < lonOeste || lng > lonEste) {
      return res
        .status(400)
        .json({ error: 'La dirección está fuera de nuestra área de servicio.' })
    }

    /* 3) distancia y costo */
    const distanciaMetros = getDistance(
      { latitude: lat1, longitude: lon1 },
      { latitude: lat,  longitude: lng }
    )
    const distanciaKm        = Math.round((distanciaMetros / 1000) * 100) / 100
    let   costo

    if (distanciaKm <= 5)      costo = 50
    else if (distanciaKm <=10) costo = distanciaKm * 10
    else if (distanciaKm <=15) costo = distanciaKm *  9
    else                       costo = distanciaKm *  8
    costo = Math.max(50, Math.round(costo))

    /* 4) respuesta */
    return res.json({
      mensaje: 'Precio calculado correctamente.',
      datos  : {
        lat_origen    : lat1,
        lon_origen    : lon1,
        lat_destino   : lat,
        lon_destino   : lng,
        direccion_destino: destino,
        distancia_km  : distanciaKm.toFixed(2),
        costo_estimado: costo,
        telefono
      }
    })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Error interno al procesar la solicitud.' })
  }
})

/* ================================================================
 *  /reverse_origin  (usa geocodeHybrid)
 * ================================================================*/
app.post('/reverse_origin', async (req, res) => {
  const { lat, lon } = req.body
  if (!lat || !lon) {
    return res.status(400).json({ error: 'Faltan lat o lon.' })
  }

  try {
    const { address } = await geocodeHybrid(lat, lon)
    return res.json({ direccion_origen: address })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Error interno reverse geocode.' })
  }
})

// ───────────────────────── listen ────────────────────────────────
app.listen(3000, () => console.log('API corriendo en http://localhost:3000'))
