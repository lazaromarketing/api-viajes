import express from "express";
import cors from "cors";
import axios from "axios";
import dotenv from "dotenv";
import { getDistance } from "geolib";

// Cargar .env
dotenv.config();
const apiKey = process.env.OPENCAGE_API_KEY;
const bounds = process.env.BOUNDS_NAYARIT.split(",").map(Number);
const allowed = process.env.ALLOWED_MUNICIPIOS
  .split(",")
  .map((m) => m.trim().toLowerCase());

const app = express();
app.use(cors());
app.use(express.json());

app.post("/generate_map", async (req, res) => {
  const { lat1, lon1, destino, telefono } = req.body;
  if (!lat1 || !lon1 || !destino || !telefono) {
    return res.status(400).json({ error: "Faltan datos requeridos." });
  }

  try {
    // Llamada a OpenCage
    const url = `https://api.opencagedata.com/geocode/v1/json`
      + `?q=${encodeURIComponent(destino)}`
      + `&key=${apiKey}`
      + `&countrycode=mx`
      + `&limit=1`;
    const { data } = await axios.get(url);
    if (!data.results.length) {
      return res.status(404).json({ error: "No se encontró el destino." });
    }

    const result = data.results[0];
    const { lat, lng } = result.geometry;
    const comps = result.components;

    // 1) validar municipio
    const municipio = (
      comps.city ||
      comps.town ||
      comps.village ||
      comps.county
    )
      .toLowerCase();
    if (!allowed.includes(municipio)) {
      return res
        .status(400)
        .json({ error: `Solo operamos en: ${allowed.map(u=>u[0].toUpperCase()+u.slice(1)).join(", ")}.` });
    }

    // 2) validar dentro del rectángulo
    const [latSur, lonOeste, latNorte, lonEste] = bounds;
    if (lat < latSur || lat > latNorte || lng < lonOeste || lng > lonEste) {
      return res
        .status(400)
        .json({ error: "La dirección está fuera de nuestra área de servicio." });
    }

    // 3) calcular distancia y costo
    const distanciaMetros = getDistance(
      { latitude: lat1, longitude: lon1 },
      { latitude: lat, longitude: lng }
    );
    const distanciaKm = distanciaMetros / 1000;
    const distanciaKmRounded = Math.round(distanciaKm * 100) / 100;

    let costo;
    if (distanciaKmRounded <= 5) costo = 50;
    else if (distanciaKmRounded <= 10) costo = distanciaKmRounded * 10;
    else if (distanciaKmRounded <= 15) costo = distanciaKmRounded * 9;
    else costo = distanciaKmRounded * 8;
    costo = Math.max(50, Math.round(costo));

    // 4) responder
    return res.json({
      mensaje: "Precio calculado correctamente.",
      datos: {
        lat_origen: lat1,
        lon_origen: lon1,
        lat_destino: lat,
        lon_destino: lng,
        direccion_destino: destino,
        distancia_km: distanciaKmRounded.toFixed(2),
        costo_estimado: costo,
        telefono,
      },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Error interno al procesar la solicitud." });
  }
});

// Reverse geocode
app.post("/reverse_origin", async (req, res) => {
  const { lat, lon } = req.body;
  if (!lat || !lon) {
    return res.status(400).json({ error: "Faltan lat o lon." });
  }
  try {
    const url = `https://api.opencagedata.com/geocode/v1/json`
      + `?q=${lat}+${lon}`
      + `&key=${apiKey}`
      + `&countrycode=mx`
      + `&limit=1`;
    const { data } = await axios.get(url);
    if (!data.results.length) {
      return res.status(404).json({ error: "No se pudo geocodificar origen." });
    }
    return res.json({ direccion_origen: data.results[0].formatted });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Error interno reverse geocode." });
  }
});

app.listen(3000, () => console.log("API corriendo en http://localhost:3000"));
