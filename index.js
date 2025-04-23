const express = require('express');
const app = express();
app.use(express.json());

app.post('/generate_map', (req, res) => {
  const { lat1, lon1, destino, telefono } = req.body;

  const latDestino = 21.5045;
  const lonDestino = -104.8946;
  const idViaje = "VJ" + Math.floor(Math.random() * 100000);
  const fecha = new Date().toLocaleDateString("es-MX");
  const hora = new Date().toLocaleTimeString("es-MX");

  res.json({
    latitud_destino: latDestino,
    longitud_destino: lonDestino,
    url_waze: `https://waze.com/ul?ll=${latDestino},${lonDestino}&navigate=yes`,
    waze_url_ubi_pasajero: `https://waze.com/ul?ll=${lat1},${lon1}&navigate=yes`,
    fecha_registro: fecha,
    hora_registro: hora,
    id_viaje: idViaje
  });
});

app.get('/', (req, res) => res.send('API funcionando 🚀'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`API corriendo en el puerto ${PORT}`));
