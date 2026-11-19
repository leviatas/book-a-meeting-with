# CLAUDE.md

Guía para Claude Code (claude.ai/code) al trabajar en este repo.

## Qué es esto

Book a Meeting. Dashboard multi-empresa con login por Google. El rol y el estado
de aprobación de un usuario son **por empresa** (ver `Membership`): una cuenta
nueva elige a qué empresa pedir acceso y queda `PENDING` ahí hasta que un admin
de esa empresa la aprueba. Los emails de `ADMIN_EMAILS` son superadmin desde el
primer login: pueden crear empresas y nunca quedan esperando aprobación.

Dos servicios, sin monorepo — cada uno con su `package.json`, instalados y
corridos por separado:

- `server/` — Node.js + Express, SQLite vía Prisma, login con Google (verifica
  el ID token en el server con `google-auth-library`, nunca confía en la
  identidad que manda el cliente), sesión por JWT propio.
- `client/` — React + Vite, "Sign in with Google" vía Google Identity Services
  (cargado como `<script>` en runtime, no como paquete npm).

## Versionado (obligatorio en cada cambio)

**Toda modificación del código sube la versión**, en el mismo cambio que la
introduce y sin esperar a que la pidan. La versión vive **en dos archivos que
tienen que quedar siempre en el mismo número**: `client/package.json` y
`server/package.json`. No hay script que los sincronice: se editan los dos a
mano.

- **MAJOR** — algo deja de ser compatible: una migración que no se puede volver
  atrás, un cambio de API o de configuración (`.env`, Docker) que obliga a
  tocar algo afuera del repo.
- **MINOR** — funcionalidad nueva compatible: una pantalla, un campo, una ruta,
  una migración que se aplica sola.
- **PATCH** — arreglo de un bug, ajuste de estilos o de textos, refactor sin
  cambio visible.

Cambios sólo de documentación o de comentarios no suben la versión.

`client/package.json` es la que Vite inyecta como `__APP_VERSION__` en el
footer de toda pantalla logueada. Si se desincronizan, el pie de página y el
server dicen versiones distintas de la misma instancia.

## Comandos

Backend (`server/`):
```bash
npm install
npx prisma migrate dev --name <desc>   # crear+aplicar migración tras editar schema.prisma
npm run dev                            # nodemon, http://localhost:4000
npm run prisma:studio                  # inspeccionar la base
```

Frontend (`client/`):
```bash
npm install
npm run dev       # vite, http://localhost:5173
npm run build
```

No hay lint ni tests configurados — no asumir que existen `npm test` /
`npm run lint`.

Docker (desde la raíz):
```bash
cp .env.example .env   # completar GOOGLE_CLIENT_ID y JWT_SECRET
docker compose up -d --build
```

`./deploy.sh` es el camino de actualización de producción: hace
`git reset --hard origin/main` y rebuildea. **Descarta commits locales y trabajo
sin commitear**, así que nunca correrlo como atajo para rebuildear.

**Después de cualquier cambio de código, correr `docker compose up -d --build`**
para que el usuario lo vea en su Docker local — este proyecto se prueba por
Docker, no por `npm run dev`.

Cliente en `http://localhost:8080` (nginx, `CLIENT_PORT` del `.env`), que
proxea `/api/*` al servicio `server` (puerto 4000, **no** publicado al host). El
server corre `prisma migrate deploy` al arrancar el contenedor
(`server/docker-entrypoint.sh`). La base persiste en el volumen
`bookameeting_data`.

El servicio `cloudflared` (profile `cloudflare`) expone el cliente por un
Cloudflare Tunnel; sólo arranca con `docker compose --profile cloudflare up` o
`COMPOSE_PROFILES=cloudflare` en el `.env`.

## Arquitectura

**Multi-empresa**: una instancia aloja varias empresas. Todo dato de negocio
cuelga de una `Company`; el rol y el estado de un `User` **no** son globales,
viven en `Membership` (`userId` + `companyId` + `role` + `status`, único por
par). El cliente dice con qué empresa opera en el header `X-Company-Id`
(`client/src/api.js`, seteado a nivel módulo con `api.setActiveCompanyId(id)`
desde `AuthContext`; ninguna página pasa `companyId` por su cuenta).

Del lado del server, `requireCompany` (`server/src/middleware/auth.js`) lee ese
header, carga la `Membership` y cuelga `req.membership` / `req.company` del
request — `requireApproved`/`requireAdmin` leen de ahí, **no** de `req.user`.

Reglas que no se negocian:

- **Toda consulta de nivel superior filtra por `companyId: req.company.id`.**
- **Los lookups por id usan `findFirst({ where: { id, companyId } })`**, no
  `findUnique`: un id de otra empresa tiene que dar 404 en vez de filtrar datos.
- **El `companyId` que se escribe sale del middleware, nunca del body.**
- Las entidades hijas no llevan `companyId` propio: su alcance se chequea a
  través del padre ya scopeado, para no tener dos fuentes de verdad que puedan
  divergir.

`User.isSuperAdmin` (de `ADMIN_EMAILS`, independiente de toda `Membership`)
habilita crear empresas. Un superadmin igual necesita una `Membership` para
operar, pero nunca queda `PENDING`: `POST /companies/:id/join` se la crea
`ADMIN`/`APPROVED`, y `ensureSuperAdminMemberships` (llamado desde
`/auth/google` y `/auth/me`) asciende cualquier `PENDING` que ya tuviera. Sin
esto el bootstrap se traba: pedir acceso a una empresa sin admins deja al dueño
de la instancia esperando una aprobación que nadie puede dar. Sólo se asciende
`PENDING` — un `REJECTED` es una decisión explícita y no se pisa.

**Auth**: el cliente saca el ID token con Google Identity Services →
`POST /api/auth/google` → el backend lo verifica con `google-auth-library`
(audience = `GOOGLE_CLIENT_ID`) → crea/actualiza el `User` seteando sólo
`isSuperAdmin` → firma y devuelve su propio JWT (7 días) más la lista de
`Membership` → el cliente guarda el token en `localStorage` y manda
`Authorization: Bearer <token>` en cada request.

`App.jsx` gatea el routing en este orden: sin login → `Login`; logueado pero sin
`activeMembership` o con `status !== APPROVED` → `AccountStatus`; si no →
`Dashboard`/`Admin` dentro de `Layout`. **Ese gate es UI, no seguridad**: todo
lo que esconde tiene que estar cerrado también del lado del server con la
cadena `requireAuth` / `requireCompany` / `requireApproved` / `requireAdmin` /
`requireWriter` / `requireSuperAdmin`.

`READER` es un rol de solo lectura: pasa `requireApproved` pero falla
`requireWriter`, chequeo que va **inline en cada ruta POST/PUT/DELETE**, nunca
en un `router.use(...)`, para que los GET queden abiertos a cualquier membresía
aprobada.

**Modelo de datos** (`server/prisma/schema.prisma`): SQLite no tiene enums, así
que `role`/`status` son strings y los valores válidos se validan en la capa de
aplicación, no en el schema. Al agregar un valor nuevo, actualizar el array de
validación de la ruta correspondiente. Lo mismo con el **orden**: ordenar por
esas columnas es alfabético, no semántico, así que cualquier lista que necesite
precedencia real tiene que mapear el valor a un rank primero.

Cualquier migración que agregue una columna requerida y sin default a una tabla
con datos necesita `prisma migrate dev --create-only` y editar el SQL a mano
para backfillear antes de aplicar: `migrate dev` se planta apenas ve un paso con
pérdida de datos sobre una tabla no vacía.

**Resolución de la URL del server** (`client/src/api.js`): `API_URL =
import.meta.env.VITE_API_URL ?? 'http://localhost:4000'` — `??` y **no** `||`, a
propósito. El build de Docker pasa `VITE_API_URL=""` para que el bundle llame
same-origin `/api/*` (nginx lo proxea al contenedor `server`, cuyo puerto nunca
se publica al host). `||` trataría ese string vacío como falsy y caería al
default `http://localhost:4000`, que no es alcanzable desde afuera de la red de
Docker — ese bug exacto rompe el login en Docker mientras anda bien con
`npm run dev`. Si tocás este archivo, dejá el `??`.

**CORS**: el backend permite exactamente un origen, `CLIENT_ORIGIN`, no un
wildcard. Tiene que coincidir con la URL desde la que el browser carga el
cliente.

**La configuración del cliente OAuth vive fuera del repo**, en Google Cloud
Console: la lista "Authorized JavaScript origins" del Client ID tiene que
incluir todos los orígenes desde los que se sirve el cliente
(`http://localhost:5173` para `npm run dev`, `http://localhost:8080` para
Docker, el dominio del túnel si se usa). No hace falta redirect URI: Google
Identity Services valida el origen, no un redirect. `GOOGLE_CLIENT_ID` se
necesita en `server/.env` (verificación del token) y en `client/.env` como
`VITE_GOOGLE_CLIENT_ID` (horneado en el bundle en tiempo de build — no hay
config de runtime para la SPA).

**Prisma + Alpine**: el Dockerfile del server instala `openssl` explícitamente y
`schema.prisma` declara `binaryTargets = ["native", "linux-musl-openssl-3.0.x"]`
— el layout de OpenSSL de musl no lo autodetecta Prisma, y falla en silencio al
arrancar el contenedor. Conservar las dos cosas.

**Persistencia**: la base y los uploads van adentro de `/app/data`, mapeado al
volumen `bookameeting_data`. Lo que quede afuera se pierde en cada rebuild.

**Zona horaria**: `TZ` es una sola para toda la instancia. Si alguna vez hay que
agendar algo a una hora de pared ("a las 9:00") para empresas en husos
distintos, `TZ` no alcanza: hay que guardar un offset por empresa y calcular
con él, sin usar `getHours()`/`setDate()`, que leen la TZ del proceso.

## Interfaz

**Idioma**: todo lo que ve el usuario va en **castellano rioplatense** ("andá",
"hacé"), incluidas las rutas, las etiquetas de navegación y los mensajes de
error que devuelve la API. Los identificadores (modelos, campos, funciones)
quedan en inglés.

**Estilo de los campos** (`client/src/styles.css`, sección "Campos"): ningún
`input`/`select`/`textarea` puede quedar con el estilo por defecto del
navegador — se ve despareja la app y el default ignora el tema oscuro. Hay
**una** regla base sobre el elemento, con el `:not()` de checkbox/radio/range/
file envuelto en `:where()` para que el selector siga pesando 0,0,1 y cualquier
regla con clase lo pise sin `!important`. Un campo nuevo ya sale bien: al
estilar uno puntual tocar sólo tamaño/ancho/alto, nunca repetir borde, fondo,
tipografía ni foco.

**Confirmación de acciones destructivas**
(`client/src/components/ConfirmDialog.jsx`): toda acción que borra o reemplaza
datos tiene que pasar por `useConfirm()` y esperar un `true` antes de llamar a
la API. **No usar `window.confirm`**: el diálogo nativo depende del navegador
—Chrome de Android lo silencia después de varios seguidos, y dentro de un
WebView puede no mostrarse nunca y devolver un valor por defecto—, así que un
borrado podía salir sin que nadie viera la pregunta. El `ConfirmProvider` se
monta una sola vez en `main.jsx`. El foco arranca en "Cancelar" a propósito.

**Nada puede desbordar el ancho del viewport**: una fila que no entra empuja el
`scrollWidth` de la página, saca de cuadro al header y al footer y deja la app
scrolleando de costado entera. Las filas de pills wrapean (con `flex-wrap` en la
regla base, no dentro del media query) y las tablas anchas van adentro de
`.table-scroll`. Para verificarlo, lo que importa es
`document.documentElement.scrollWidth` contra `clientWidth` en la pantalla real,
no que se vea bien en una captura.

**Mobile**: el breakpoint es 720 px. Los modales van a pantalla completa
(`min-height: 100dvh` — `dvh` y no `vh` porque la barra de direcciones se
esconde al scrollear), con la excepción del diálogo de confirmación. Ojo: en
celular el fondo deja de estar a la vista, así que **todo modal nuevo tiene que
tener su propio botón de Cancelar/Cerrar** — tocar afuera ya no es una salida
posible.

**Tipografía en `rem`/`em`**: no hay un solo `font-size` en px, así que una sola
regla sobre `:root` escala toda la app. Los breakpoints y los `min-width` de las
tablas sí van en px a propósito: al agrandar la letra crece el texto, no se
reacomoda el layout.
