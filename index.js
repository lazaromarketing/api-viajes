import express from "express";
import cors from "cors";
import axios from "axios";
import dotenv from "dotenv";
import { getDistance } from "geolib";

// Cargar las variables del archivo .env
dotenv.config();

// Inicializar app de Express
const app = express();
app.use(cors());
app.use(express.json());

// Obtener API KEY desde las variables de entorno
const apiKey = process.env.OPENCAGE_API_KEY;

app.post("/", async (req, res) => {
  const { lat1, lon1, destino, telefono } = req.body;

  if (!lat1 || !lon1 || !destino || !telefono) {
    return res.status(400).json({ error: "Faltan datos requeridos." });
  }

  try {
    // Construir URL de OpenCage
    const url = `https://api.opencagedata.com/geocode/v1/json?q=${encodeURIComponent(destino)}&key=${apiKey}`;

    // Hacer la petición a OpenCage
    const response = await axios.get(url);

    if (response.data.results.length === 0) {
      return res.status(404).json({ error: "No se encontró el destino." });
    }

    const { lat, lng } = response.data.results[0].geometry;

    // Calcular distancia entre origen y destino
    const distanciaMetros = getDistance(
      { latitude: lat1, longitude: lon1 },
      { latitude: lat, longitude: lng }
    );
    const distanciaKm = (distanciaMetros / 1000).toFixed(2);

    // Calcular precio basado en la distancia
    let costo = 0;
    if (distanciaKm <= 5) {
      costo = 50;
    } else if (distanciaKm > 5 && distanciaKm <= 10) {
      costo = distanciaKm * 10;
    } else if (distanciaKm > 10 && distanciaKm <= 15) {
      costo = distanciaKm * 9;
    } else {
      costo = distanciaKm * 8;
    }

    // Siempre respetar el mínimo de $50
    if (costo < 50) {
      costo = 50;
    }

    costo = Math.round(costo); // Redondear el precio

    // Responder datos completos
    res.json({
      mensaje: "Precio calculado correctamente.",
      datos: {
        lat_origen: lat1,
        lon_origen: lon1,
        lat_destino: lat,
        lon_destino: lng,
        direccion_destino: destino,
        distancia_km: distanciaKm,
        costo_estimado: costo,
        telefono: telefono
      }
    });

  } catch (error) {
    console.error("Error al procesar la solicitud:", error.message);
    res.status(500).json({ error: "Error interno al procesar la solicitud." });
  }
});

// Correr el servidor
app.listen(3000, () => {
  console.log("API corriendo en http://localhost:3000");
});
