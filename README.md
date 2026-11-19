# Book a Meeting

Dashboard multi-empresa con autenticación por Google. Cada cuenta nueva pide
acceso a una empresa y queda **pendiente de aprobación** hasta que un
administrador de esa empresa la acepta.

- `server/` — API en Node.js + Express, SQLite vía Prisma, login con Google
  (verificación del ID token con `google-auth-library`), sesión por JWT.
- `client/` — Frontend en React + Vite, botón "Sign in with Google" (Google
  Identity Services).
- `docker-compose.yml` — levanta ambos servicios en contenedores.

## 1. Credenciales de Google (Client ID)

1. En [Google Cloud Console](https://console.cloud.google.com/) creá un
   proyecto.
2. **APIs & Services → OAuth consent screen**: User Type `External`, completá
   nombre de la app, email de soporte y email del desarrollador. No hace falta
   agregar scopes (email y perfil vienen por defecto). Agregá tu cuenta en
   "Test users", o publicá la app.
3. **APIs & Services → Credentials → + Create Credentials → OAuth client ID**,
   tipo `Web application`. En **Authorized JavaScript origins** van todos los
   orígenes desde los que se sirve el cliente:
   - `http://localhost:5173` (desarrollo con `npm run dev`)
   - `http://localhost:8080` (Docker Compose)
   - la URL pública, si usás el túnel de Cloudflare

   **Authorized redirect URIs**: ninguno. Google Identity Services valida el
   origen, no un redirect.

Un origen que falte se ve como un botón de Google que no renderiza o un login
que falla sin error claro; el mensaje real está en la consola del browser.

## 2. Levantar con Docker

```bash
cp .env.example .env
# Completá GOOGLE_CLIENT_ID y JWT_SECRET (openssl rand -hex 32)

# Una sola vez, para generar la migración inicial:
cd server && npm install && npx prisma migrate dev --name init && cd ..

docker compose up -d --build
```

Cliente en `http://localhost:8080` (cambiable con `CLIENT_PORT`). El puerto del
server no se publica: nginx proxea `/api/*` al contenedor.

Entrá con la cuenta que pusiste en `ADMIN_EMAILS`: queda como superadmin, crea
la primera empresa y desde ahí aprueba al resto.

Comandos útiles:

```bash
docker compose logs -f server       # logs del backend
docker compose exec server sh       # shell adentro del contenedor
docker compose down                 # bajar (el volumen NO se toca)
docker compose down -v              # ⚠️ borra el volumen: se pierde la base
```

### 2a. Exponerlo a internet con Cloudflare Tunnel (opcional)

Sin abrir puertos ni tener IP pública. Necesitás un dominio en Cloudflare.

1. [Cloudflare Zero Trust](https://one.dash.cloudflare.com/) → **Networks →
   Tunnels → Create a tunnel**, conector **Cloudflared**, entorno **Docker**.
   Copiá el token (la cadena larga después de `--token`).
2. En **Public Hostname** del túnel, agregá tu hostname apuntando al servicio
   `http://client:80` — el nombre del servicio en la red de Compose, no
   `localhost`.
3. En `.env`:
   ```bash
   CLOUDFLARE_TUNNEL_TOKEN="el-token-que-copiaste"
   CLIENT_ORIGIN="https://tu-dominio"
   ```
4. Agregá `https://tu-dominio` a "Authorized JavaScript origins" del Client ID.
5. ```bash
   docker compose --profile cloudflare up -d --build
   ```

Sin `--profile cloudflare` el servicio ni se crea, así que podés dejar el token
vacío mientras no lo uses.

## 3. Desarrollo local sin Docker

```bash
cd server
cp .env.example .env     # completá GOOGLE_CLIENT_ID y JWT_SECRET
npm install
npx prisma migrate dev --name init
npm run dev              # http://localhost:4000
```

```bash
cd client
cp .env.example .env     # completá VITE_GOOGLE_CLIENT_ID
npm install
npm run dev              # http://localhost:5173
```

## 4. Deploy

`./deploy.sh` actualiza el checkout a `origin/main` y rebuildea los
contenedores. **Hace `git reset --hard`: descarta commits locales y trabajo sin
commitear.**

`.github/workflows/deploy.yml` lo dispara en cada push a `main` desde un runner
self-hosted que corre en el mismo servidor. Para habilitarlo:

1. Instalá el runner: repo → Settings → Actions → Runners → *New self-hosted
   runner*. Después `sudo ./svc.sh install && sudo ./svc.sh start` para que
   sobreviva a los reinicios.
2. Definí la variable `DEPLOY_DIR` (Settings → Secrets and variables → Actions
   → **Variables**) apuntando al clon del repo en el servidor.

Ese clon tiene su propio `.env` con los secretos, que **no** está en el repo y
hay que crearlo a mano la primera vez.
