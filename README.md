# 🗺️ API Viajes

> **API de geocoding híbrido y generación de rutas inteligente para servicios de viaje**

[![Node.js](https://img.shields.io/badge/Node.js-≥14.0.0-green.svg)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](http://makeapullrequest.com)

---

## 🎯 **Descripción**

API robusta diseñada para extraer coordenadas de enlaces de Google Maps, realizar geocoding con sistema de fallback y generar rutas optimizadas con cálculo automático de costos.

### ✨ **Características principales**

- **🌍 Geocoding híbrido**: Mapbox como servicio principal + Google Maps como fallback automático
- **📍 Extracción inteligente**: Obtiene coordenadas lat/lon directamente desde URLs de Google Maps
- **🔄 Reverse geocoding**: Convierte coordenadas a direcciones legibles
- **🗺️ Generación de rutas**: Crea mapas interactivos con rutas y cálculo de costos por distancia
- **⚡ Sistema de caché LRU**: Acelera respuestas para peticiones repetidas
- **🛡️ Rate limiting**: Protección contra abuso de la API
- **✅ Validación geográfica**: Control de municipios permitidos para operación

---

## 🛠️ **Instalación**

### **Requisitos previos**
- Node.js ≥ 14.0.0
- npm o yarn
- Tokens de API (Mapbox y Google Maps)

### **Pasos de instalación**

1. **Clonar el repositorio**
   ```bash
   git clone https://github.com/lazaromarketing/api-viajes.git
   cd api-viajes
   ```

2. **Instalar dependencias**
   ```bash
   npm install
   # o usando yarn
   yarn install
   ```

3. **Configurar variables de entorno**
   ```bash
   cp .env.example .env
   # Edita el archivo .env con tus credenciales
   ```

---

## ⚙️ **Configuración**

Crea un archivo `.env` en la raíz del proyecto con las siguientes variables:

```env
# 🗝️ APIs Keys
MAPBOX_TOKEN=tu_token_de_mapbox_aqui
GOOGLE_API_KEY=tu_api_key_de_google_aqui

# 🌐 Servidor
PORT=3000

# 🏘️ Configuración geográfica
ALLOWED_MUNICIPIOS=tepic,xalisco,bahia de banderas
```

### **Obtener API Keys**

- **Mapbox**: Regístrate en [mapbox.com](https://www.mapbox.com/) y obtén tu token de acceso
- **Google Maps**: Habilita la API de Geocoding en [Google Cloud Console](https://console.cloud.google.com/)

---

## 🚀 **Uso**

### **Desarrollo**
```bash
npm run dev
```

### **Producción**
```bash
npm start
```

El servidor estará disponible en `http://localhost:3000`

---

## 🔌 **Endpoints de la API**

### **1. Geocodificar enlace de Google Maps**

**`POST /geocode_link`**

Extrae coordenadas de un enlace de Google Maps.

```json
// Request
{
  "url": "https://www.google.com/maps/@21.50508,-104.89630,16z"
}

// Response 200
{
  "lat": 21.50508,
  "lon": -104.89630
}
```

**Códigos de respuesta:**
- `200`: Coordenadas extraídas exitosamente
- `400`: URL inválida o parámetros faltantes
- `403`: Ubicación fuera de municipios permitidos
- `500`: Error interno del servidor

---

### **2. Reverse Geocoding**

**`POST /reverse_origin`**

Convierte coordenadas a una dirección legible.

```json
// Request
{
  "lat": 21.50508,
  "lon": -104.89630
}

// Response 200
{
  "address": "Calle Roble 347, Tepic, Nayarit, México"
}
```

---

### **3. Generar mapa con ruta y costo**

**`POST /generate_map`**

Genera URL de mapa interactivo con ruta trazada y calcula el costo del viaje.

```json
// Request
{
  "lat1": 21.50508,
  "lon1": -104.89630,
  "destino": "Calle Roble 347 Tepic",
  "telefono": "3113150046"
}

// Response 200
{
  "mapUrl": "https://www.google.com/maps/dir/?api=1&origin=21.50508,-104.89630&destination=Calle+Roble+347+Tepic",
  "costo": 50,
  "distancia": "2.5 km",
  "tiempo_estimado": "8 min"
}
```

---

## 📋 **Ejemplos de uso**

### **Con cURL**

```bash
# Geocodificar enlace
curl -X POST http://localhost:3000/geocode_link \
     -H "Content-Type: application/json" \
     -d '{"url":"https://www.google.com/maps/@21.50508,-104.89630,16z"}'

# Reverse geocoding
curl -X POST http://localhost:3000/reverse_origin \
     -H "Content-Type: application/json" \
     -d '{"lat":21.50508,"lon":-104.89630}'

# Generar ruta con costo
curl -X POST http://localhost:3000/generate_map \
     -H "Content-Type: application/json" \
     -d '{
           "lat1":21.50508,
           "lon1":-104.89630,
           "destino":"Calle Roble 347 Tepic",
           "telefono":"3113150046"
         }'
```

### **Con JavaScript/Fetch**

```javascript
// Ejemplo de geocodificación
const response = await fetch('http://localhost:3000/geocode_link', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    url: 'https://www.google.com/maps/@21.50508,-104.89630,16z'
  })
});

const data = await response.json();
console.log(data); // { lat: 21.50508, lon: -104.89630 }
```

---

## 🏗️ **Estructura del proyecto**

```
api-viajes/
├── src/
│   ├── controllers/     # Controladores de rutas
│   ├── services/        # Lógica de negocio
│   ├── middleware/      # Middleware personalizado
│   └── utils/           # Utilidades y helpers
├── tests/               # Tests unitarios
├── docs/                # Documentación adicional
├── .env.example         # Plantilla de variables de entorno
├── package.json
└── README.md
```

---

## 🤝 **Contribuir**

¡Las contribuciones son bienvenidas! Sigue estos pasos:

1. **Fork** el proyecto
2. **Crear una rama** para tu feature:
   ```bash
   git checkout -b feature/amazing-feature
   ```
3. **Commit** tus cambios:
   ```bash
   git commit -m "feat: add amazing feature"
   ```
4. **Push** a la rama:
   ```bash
   git push origin feature/amazing-feature
   ```
5. **Abrir un Pull Request**

### **Estándares de código**
- Usar [Conventional Commits](https://www.conventionalcommits.org/)
- Mantener cobertura de tests >80%
- Documentar nuevas funcionalidades

---

## 🐛 **Reporte de problemas**

Si encuentras algún bug o tienes una sugerencia:

1. Revisa si ya existe un [issue similar](https://github.com/lazaromarketing/api-viajes/issues)
2. Crea un nuevo issue con detalles específicos
3. Incluye pasos para reproducir el problema

---

## 📄 **Licencia**

Este proyecto está bajo la Licencia MIT - ver el archivo [LICENSE](LICENSE) para más detalles.

---

## 👨‍💻 **Autor**

**Lazaro Marketing**
- GitHub: [@lazaromarketing](https://github.com/lazaromarketing)
- Email: contacto@lazaromarketing.com

---

<div align="center">

**⭐ Si este proyecto te fue útil, considera darle una estrella ⭐**

Made with ❤️ in Tepic, Nayarit

</div>
