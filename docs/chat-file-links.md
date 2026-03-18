# File cliccabili nella chat

## Backend (fatto)

- **Endpoint:** `GET /datasets/files/{filename}`
- I file in `storage/datasets/` sono serviti dall’API; cliccando il link si apre o si scarica il file.

## Frontend (quando ripristini la chat)

Nella lista dei file allegati in chat, **non** mostrare solo il nome del file come testo. Usa un link:

```tsx
// Da app: import { datasetFileUrl } from "../lib/api";
// Se usi path alias @: import { datasetFileUrl } from "@/lib/api";
import { datasetFileUrl } from "../lib/api";

// Per ogni file nella lista del messaggio:
<a
  href={datasetFileUrl(file.name)}
  target="_blank"
  rel="noopener noreferrer"
  className="text-emerald-400 hover:underline"
>
  {file.name}
</a>
```

- `target="_blank"` apre in una nuova scheda.
- Il browser mostrerà il file (es. CSV, JSON) o avvierà il download a seconda del tipo.

Variabile d’ambiente opzionale: `NEXT_PUBLIC_API_URL` (default `http://localhost:8000`).
