#!/bin/sh
set -e

# migrate deploy y no migrate dev: aplica las migraciones ya generadas, no crea
# ninguna y no pregunta nada. La inicial hay que generarla una vez a mano con
# `npx prisma migrate dev --name init`.
echo "Applying database migrations..."
npx prisma migrate deploy

echo "Starting server..."
exec node src/index.js
