---
name: spotify
version: 0.1.0
description: "Accesso alle API Spotify Web API per interrogare il catalogo pubblico: ricerca di brani, artisti, album e playlist, e recupero dettagli per ID. Usa questa skill quando l'utente chiede informazioni su contenuti Spotify o vuole cercare musica nel catalogo Spotify."
tools:
  - name: spotify.search
    description: "Cerca contenuti nel catalogo pubblico Spotify"
    input:
      type: object
      properties:
        query: { type: string, description: "Testo da cercare" }
        type:
          type: string
          description: "Tipo di contenuto"
          enum: [track, artist, album, playlist]
          default: track
        limit:
          type: number
          description: "Numero massimo di risultati (1-20)"
          default: 5
      required: [query]

  - name: spotify.getTrack
    description: "Recupera i dettagli di una traccia Spotify tramite ID"
    input:
      type: object
      properties:
        trackId: { type: string, description: "ID della traccia Spotify" }
      required: [trackId]

  - name: spotify.getArtist
    description: "Recupera i dettagli di un artista Spotify tramite ID"
    input:
      type: object
      properties:
        artistId: { type: string, description: "ID dell'artista Spotify" }
      required: [artistId]

  - name: spotify.getAlbum
    description: "Recupera i dettagli di un album Spotify tramite ID"
    input:
      type: object
      properties:
        albumId: { type: string, description: "ID dell'album Spotify" }
      required: [albumId]
---

# Regole d'uso
- Usa questa skill per interrogare il catalogo pubblico Spotify, non per operazioni sull'account utente.
- Prima usa `spotify.search` per trovare l'ID corretto, poi `spotify.getTrack`, `spotify.getArtist` o `spotify.getAlbum` se servono dettagli.
- Questa integrazione usa il flusso `client_credentials`, quindi non puo' leggere librerie personali, playlist private o playback dell'utente.
- Credenziali richieste nelle secrets: `spotify.client_id` e `spotify.client_secret`.
- Se l'API restituisce errore di autorizzazione, segnala all'utente che deve configurare o correggere le credenziali Spotify dell'app.
