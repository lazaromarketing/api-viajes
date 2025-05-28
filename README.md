# 🚖 API de Servicios de Taxi - Nayarit

API REST para cálculo de rutas, geocodificación y estimación de precios para servicios de taxi en Nayarit, México.

## 🚀 Características

- **Geocodificación Híbrida**: Utiliza OpenCage y Mapbox como respaldo
- **Cálculo de Rutas**: Estimación de distancia y costos en tiempo real  
- **Procesamiento de Enlaces**: Extrae coordenadas de enlaces de Google Maps
- **Caché Inteligente**: Sistema LRU para optimizar respuestas repetidas
- **Rate Limiting**: Protección contra abuso con límites de 100 req/15min
- **Área de Servicio**: Validación automática de municipios permitidos

## 📋 Prerequisitos

- Node.js 18+
- NPM o Yarn
- Cuentas API para:
  - [OpenCage Geocoding API](https://opencagedata.com/)
  - [Mapbox Geocoding API](https://www.mapbox.com/)

## ⚙️ Instalación

1. **Clonar el repositorio**
```bash
git clone https://github.com/tu-usuario/api-taxi-nayarit.git
cd api-taxi-nayarit
```

2. **Instalar dependencias**
```bash
npm install
```

3. **Configurar variables de entorno**
```bash
cp .env.example .env
```

Edita el archivo `.env`:
```env
OPENCAGE_API_KEY=tu_clave_opencage
MAPBOX_TOKEN=tu_token_mapbox
BOUNDS_NAYARIT=21.0,-105.5,22.5,-104.0
ALLOWED_MUNICIPIOS=tepic,xalisco,san blas,compostela
PORT=3000
NODE_ENV=development
```

4. **Iniciar el servidor**
```bash
# Desarrollo
npm run dev

# Producción  
npm start
```

## 🔌 Endpoints

### 1. Procesar Enlaces de Google Maps
```http
POST /geocode_link
Content-Type: application/json

{
  "url": "https://maps.google.com/maps?q=Plaza+Principal+Tepic"
}
```

**Respuesta:**
```json
{
  "lat": 21.5041,
  "lon": -104.8942,
  "direccion": "Plaza Principal, Tepic, Nayarit, México",
  "source": "opencage",
  "accuracy": 25
}
```

### 2. Geocodificación Inversa
```http
POST /reverse_origin
Content-Type: application/json

{
  "lat": 21.5041,
  "lon": -104.8942
}
```

**Respuesta:**
```json
{
  "direccion_origen": "Centro, Tepic, Nayarit, México",
  "source": "opencage",
  "accuracy": 25
}
```

### 3. Generar Mapa y Calcular Precio
```http
POST /generate_map
Content-Type: application/json

{
  "lat1": 21.5041,
  "lon1": -104.8942,
  "destino": "Universidad Autónoma de Nayarit",
  "telefono": "3111234567"
}
```

**Respuesta:**
```json
{
  "mensaje": "Precio calculado correctamente.",
  "datos": {
    "lat_origen": 21.5041,
    "lon_origen": -104.8942,
    "lat_destino": 21.4567,
    "lon_destino": -104.8123,
    "direccion_destino": "Universidad Autónoma de Nayarit, Tepic",
    "distancia_km": "8.50",
    "costo_estimado": 85,
    "telefono": "3111234567"
  }
}
```

### 4. Estado del Servicio
```http
GET /health
```

**Respuesta:**
```json
{
  "status": "OK",
  "timestamp": "2025-05-28T15:30:00.000Z",
  "cache_size": 45
}
```

## 💰 Tarifas

| Distancia | Precio |
|-----------|--------|
| 0-5 km    | $50 (tarifa base) |
| 5-10 km   | $10 por km |
| 10-15 km  | $9 por km |
| +15 km    | $8 por km |

## 🗺️ Área de Servicio

Actualmente operamos en los siguientes municipios de Nayarit:
- Tepic
- Xalisco  
- San Blas
- Compostela

## 🤖 Integración con Bot

Esta API está diseñada para integrarse con bots de Telegram/WhatsApp para:

1. **Usuario envía ubicación** → Bot obtiene coordenadas
2. **Usuario envía destino** → API geocodifica y calcula precio
3. **Bot muestra estimación** → Usuario confirma viaje
4. **Conexión con conductor** → Proceso de reserva

## 🛠️ Tecnologías

- **Node.js** + Express.js
- **Axios** para llamadas HTTP
- **LRU Cache** para optimización
- **Geolib** para cálculos de distancia
- **Express Rate Limit** para protección

## 📊 Códigos de Error

| Código | Descripción |
|--------|-------------|
| `TOO_MANY_REQUESTS` | Límite de requests excedido |
| `MISSING_COORDS` | Coordenadas faltantes |
| `INVALID_COORDINATES` | Coordenadas inválidas |
| `DESTINO_NOT_FOUND` | Destino no encontrado |
| `OUT_OF_SERVICE_AREA` | Fuera del área de servicio |
| `OUT_OF_BOUNDS` | Fuera de los límites geográficos |

## 🚀 Despliegue

### Render.com
1. Conecta tu repositorio de GitHub
2. Configura las variables de entorno en el dashboard
3. Render detectará automáticamente Node.js y desplegará

### Variables de Entorno en Producción
```env
NODE_ENV=production
OPENCAGE_API_KEY=tu_clave_produccion
MAPBOX_TOKEN=tu_token_produccion
BOUNDS_NAYARIT=21.0,-105.5,22.5,-104.0
ALLOWED_MUNICIPIOS=tepic,xalisco,san blas,compostela
```

## 🤝 Contribuir

1. Fork el proyecto
2. Crea una rama (`git checkout -b feature/nueva-funcionalidad`)
3. Commit tus cambios (`git commit -m 'Agregar nueva funcionalidad'`)
4. Push a la rama (`git push origin feature/nueva-funcionalidad`)
5. Abre un Pull Request

## 📝 Licencia

Este proyecto está bajo la Licencia MIT - ver el archivo [LICENSE](LICENSE) para detalles.

## 📞 Contacto

- **Proyecto**: ddriverstepic
- **Desarrollador**: lazaromarketing
- **Email**: cntacto@somoslazaro.marketing
- **GitHub**: https://github.com/lazaromarketing/api-viajes

---

⭐ **¡Dale una estrella si te resulta útil!**
