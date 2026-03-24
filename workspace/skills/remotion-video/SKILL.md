---
name: remotion-video
version: 0.1.0
description: "Creazione e rendering di video Remotion nel progetto locale configurato. Usa questa skill quando un agent deve progettare, scrivere o aggiornare composizioni React/Remotion, gestire asset del video e renderizzare un output mp4 tramite il workspace Remotion."
tools:
  - name: remotion.getProjectState
    description: "Legge lo stato del progetto Remotion, i file chiave e la struttura corrente prima di modificare o renderizzare"
    input:
      type: object
      properties: {}
  - name: remotion.saveFiles
    description: "Crea o aggiorna uno o piu file nel progetto Remotion"
    input:
      type: object
      properties:
        files:
          type: array
          items:
            type: object
            properties:
              path: { type: string, description: "Path relativo nel progetto Remotion, per esempio src/PromoVideo.tsx" }
              content: { type: string, description: "Contenuto UTF-8 del file" }
            required: [path, content]
      required: [files]
  - name: remotion.listCompositions
    description: "Elenca le composizioni Remotion disponibili tramite CLI locale"
    input:
      type: object
      properties: {}
  - name: remotion.renderVideo
    description: "Renderizza una composizione Remotion in un file video"
    input:
      type: object
      properties:
        compositionId: { type: string, description: "ID della composition Remotion da renderizzare" }
        outputFile: { type: string, description: "Path relativo di output nel progetto, opzionale" }
        props: { type: object, description: "Props serializzabili passate alla composition" }
        codec: { type: string, description: "Codec opzionale, ad esempio h264" }
        imageFormat: { type: string, description: "Formato immagine opzionale, ad esempio jpeg o png" }
        overwrite: { type: boolean, description: "Se true sovrascrive l'output esistente" }
      required: [compositionId]
---

# Regole d’uso
- Prima di toccare il progetto usa `remotion.getProjectState` o `remotion.listCompositions` per capire entrypoint, composition ID e file gia presenti.
- Lavora nel progetto Remotion configurato dal sistema: crea o aggiorna file in `src/` per componenti e composizioni, usa `public/` per asset statici e salva gli output renderizzati in `renders/` salvo richiesta diversa.
- Ogni video deve avere una `Composition` registrata nel root con `id`, `durationInFrames`, `fps`, `width` e `height` espliciti. Se introduci una nuova composition, aggiorna anche `src/Root.tsx`.
- Mantieni i video parametrizzabili: preferisci props serializzabili, `defaultProps` e schema Zod quando il video deve essere riutilizzato con varianti di testo, colori, immagini, audio o CTA.
- Ragiona sempre in frame. Per orchestrare scene usa `Sequence`, `useCurrentFrame`, `interpolate` e `spring`; evita timing impliciti o dipendenti dal clock reale.
- Per testi e grafiche privilegia layout semplici, leggibili e robusti al resize. Evita dipendenze da misure DOM fragili se non strettamente necessarie.
- Per immagini, video e audio usa componenti Remotion dedicati e mantieni un timing esplicito: trim, volume, transizioni e sovrapposizioni devono essere controllati in frame.
- Quando il task richiede sottotitoli, voiceover, transizioni o audio-reactive effects, costruisci una timeline chiara per scene e overlay invece di accumulare logica dispersa nello stesso componente.
- Se il task richiede un nuovo video da zero, crea almeno: un componente di composition dedicato in `src/`, l'aggiornamento di `src/Root.tsx` e un render di prova con `remotion.renderVideo`.
- Dopo avere salvato i file, esegui sempre un render draft con `remotion.renderVideo` e restituisci il path dell'output insieme ai file modificati.
