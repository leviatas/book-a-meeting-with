# Book a Meeting

Plataforma **open source** de agendamiento de reuniones, al estilo Calendly:
compartís un link y la otra persona elige un horario libre. Si conectás Google
Calendar, también se crea la reunión en el calendario que elijas.

## Qué hace

- **Tipos de evento** (“Charla de 30 min”, “Demo de 1 h”…): duración, color,
  descripción, ubicación (Google Meet, teléfono, presencial, link propio),
  link público editable, activar/desactivar, duplicar.
- **Reglas de agenda por evento**: aviso mínimo, cuántos días hacia adelante se
  puede reservar, margen antes/después (buffers), cada cuánto arrancan los
  turnos y máximo de reservas por día.
- **Preguntas al invitado**: texto corto, texto largo o teléfono, obligatorias
  u opcionales.
- **Disponibilidad**: horarios semanales con varios rangos por día, zona
  horaria propia, varios horarios con nombre (“Laboral”, “Verano”…) y
  **excepciones por fecha** (feriados, vacaciones, días con otro horario).
- **Google Calendar**: los eventos de los calendarios que elijas **bloquean**
  tu disponibilidad (freebusy) y cada reserva **se crea** en el calendario que
  elijas, con Google Meet e invitación al invitado. Reprogramar mueve el
  evento; cancelar lo borra.
- **Página pública** (`/u/<usuario>` y `/u/<usuario>/<evento>`): calendario
  mensual, turnos en la zona horaria del invitado (elegible), formato 12/24 h.
- **Gestión del invitado** sin cuenta (`/reserva/<id>`): ver, reprogramar,
  cancelar con motivo, agregar a Google Calendar.
- **Panel de reservas**: próximas / pasadas / canceladas, detalle con
  respuestas y cancelación por el anfitrión.
- **Mails** opcionales por SMTP (confirmación, reprogramación, cancelación, con
  `.ics`).
- **Espacio personal**: se crea al entrar con Google por primera vez. Podés
  restringir el acceso al panel con `ALLOWED_EMAILS`. Los invitados reservan
  sin registrarse.

La [guía de la agenda personal](docs/agenda-personal.md) explica cómo compartir
la primera reunión, configurar cupos y topes, y activar recordatorios.

Stack: Node 20 + Express + Prisma/SQLite (`server/`), React + Vite (`client/`),
Docker Compose detrás de nginx, Cloudflare Tunnel opcional.

## 1. Google Cloud: login + Calendar

En [Google Cloud Console](https://console.cloud.google.com/):

1. Creá un proyecto y habilitá la **Google Calendar API** (APIs & Services →
   Library → “Google Calendar API” → Enable).
2. **OAuth consent screen**: User Type `External`, nombre de la app, emails. En
   **Scopes** agregá `.../auth/calendar.readonly` y `.../auth/calendar.events`.
   Mientras la app esté en modo *Testing*, sólo las cuentas cargadas en
   **Test users** pueden conectar el calendario (máx. 100). Para abrirla a
   cualquiera hay que publicarla, y como los scopes de Calendar son
   “sensibles”, Google pide verificación.
3. **Credentials → Create Credentials → OAuth client ID**, tipo
   `Web application`:
   - **Authorized JavaScript origins** (login):
     `http://localhost:5173`, `http://localhost:8080` y tu URL pública.
   - **Authorized redirect URIs** (Calendar):
     `http://localhost:5173/api/google/callback`,
     `http://localhost:8080/api/google/callback` y
     `https://tu-dominio/api/google/callback`.
4. Copiá el **Client ID** y el **Client secret** al `.env`.

Sin `GOOGLE_CLIENT_SECRET` la app funciona igual (login, eventos, reservas),
pero sin la integración con Calendar.

## 2. Levantar con Docker

```bash
cp .env.example .env
# Completá GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET y JWT_SECRET (openssl rand -hex 32)
docker compose up -d --build
```

El cliente usa el puerto de `CLIENT_PORT` (8080 por defecto). Entrá con Google
para abrir tu espacio personal. En **Disponibilidad** elegí tus horarios. En
**Eventos**, elegí **Crear reunión de 30 minutos** o armá un evento a medida.
Conectá Google Calendar desde **Integraciones** si querés bloquear sus horarios
ocupados o generar enlaces de Meet.

```bash
docker compose logs -f server       # logs del backend
docker compose down                 # bajar (el volumen NO se toca)
docker compose down -v              # ⚠️ borra el volumen: se pierde la base
```

### 2a. Publicarlo con Cloudflare Tunnel

Sin abrir puertos ni IP pública. Necesitás un dominio en Cloudflare.

1. [Cloudflare Zero Trust](https://one.dash.cloudflare.com/) → **Networks →
   Tunnels → Create a tunnel**, conector **Cloudflared**, entorno **Docker**.
   Copiá el token (lo que sigue a `--token`).
2. **Public Hostname**: `agenda.tu-dominio.com` → servicio `http://client:80`
   (el nombre del servicio en la red de Compose, no `localhost`).
3. En `.env`:
   ```bash
   CLOUDFLARE_TUNNEL_TOKEN="el-token"
   CLIENT_ORIGIN="https://agenda.tu-dominio.com"
   ```
4. Sumá ese origen a los *JavaScript origins* y
   `https://agenda.tu-dominio.com/api/google/callback` a los *redirect URIs*.
5. `docker compose --profile cloudflare up -d --build`

`CLIENT_ORIGIN` se usa para CORS, para la redirect URI de Calendar y para los
links de los mails: tiene que ser exactamente la URL pública.

## 3. Desarrollo sin Docker

```bash
cd server && cp .env.example .env && npm install && npx prisma migrate dev && npm run dev
cd client && cp .env.example .env && npm install && npm run dev
```

Vite proxea `/api` al server, así que el callback de Calendar en
`http://localhost:5173/api/google/callback` funciona igual que en Docker.

## 4. Deploy

`./deploy.sh` actualiza el checkout a `origin/main` y rebuildea. **Hace
`git reset --hard`**: descarta trabajo local. `.github/workflows/deploy.yml` lo
corre en cada push a `main` desde un runner self-hosted (variable
`DEPLOY_DIR` en GitHub → Settings → Actions → Variables).

## Licencia

MIT — ver [LICENSE](LICENSE).
