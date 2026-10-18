# Duetto

Una chat condivisa: scegli un nickname, copia il link del salotto e invialo alla seconda persona. I messaggi vengono salvati su Turso e si aggiornano ogni due secondi.

## Avvio locale

1. Copia `.env.example` in `.env.local` e inserisci `TURSO_DATABASE_URL` e `TURSO_AUTH_TOKEN`.
2. Installa le dipendenze con `npm install`.
3. Avvia con `npm run dev` e apri [http://localhost:3000](http://localhost:3000).

Il nickname `ale0095` e `silvia0088` sono disponibili come scelte rapide. Il primo accesso crea automaticamente un link di stanza; invia quel link all'altra persona. Chi apre il link vede la stessa conversazione.

## GitHub e Vercel

Collega il repository GitHub a un progetto Vercel. Imposta `TURSO_DATABASE_URL` e `TURSO_AUTH_TOKEN` nelle variabili d'ambiente Vercel per Production e Preview. Ogni push sul branch di produzione pubblicherà il sito. Il database e gli indici vengono inizializzati al primo messaggio o caricamento della chat.

## Limiti della versione iniziale

L'accesso usa un nickname senza password: il nickname non prova l'identità di chi lo usa e chiunque abbia il link della stanza può leggerne e scriverne i messaggi. La stanza non limita ancora l'accesso a due sessioni. La chat usa aggiornamenti periodici, non connessioni in tempo reale.
