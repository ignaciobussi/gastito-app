# Gastitos

Aplicación React con API de Cloudflare Workers y base de datos D1.

## Desarrollo local

1. Ejecutá `npm install`.
2. Ejecutá `npm run db:local` para crear la base D1 local.
3. Ejecutá `npm run dev` y abrí `http://localhost:5173`.

## Publicar gratis en Cloudflare

Si tenías gastos en la versión SQLite anterior, exportalos desde el botón **Exportar JSON** antes de migrar. Tras publicar, usá **Importar JSON** en Gastitos para recuperarlos en D1.

1. Creá una cuenta en Cloudflare y ejecutá `npx wrangler login`.
2. Ejecutá `npx wrangler d1 create gastitos-db`.
3. Copiá el `database_id` que devuelve en `wrangler.jsonc`.
4. Ejecutá `npm run db:remote` para crear las tablas online.
5. Ejecutá `npm run deploy`.

La app quedará publicada en una URL `*.workers.dev` y puede instalarse en el celular desde el navegador.
