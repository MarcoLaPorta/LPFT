# Agentic Finance Exchange (AFX) — archivio

Il codice operativo della console AFX è stato **unito nel monorepo principale** sotto **`apps/web`** (una sola app Next sulla **porta 3000**).

- **Sviluppo:** dalla root del repo → `cd apps/web`, copia `env.local.template` → `.env.local`, poi `npm install` e `npm run dev`.
- **Prisma:** `apps/web/prisma` — migrazioni: `cd apps/web && npx prisma migrate deploy`.
- **Route utili:** `/exchange`, `/terminal`, `/api/health`, `/api/chat`.

Non avviare una seconda istanza Next dedicata all’AFX. Per l’architettura unificata vedi [`../docs/UNIFIED_EXCHANGE.md`](../docs/UNIFIED_EXCHANGE.md).

---

*Questa cartella può contenere solo riferimenti storici o script di supporto; la fonte di verità per la UI exchange è `apps/web`.*
