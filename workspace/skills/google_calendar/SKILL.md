---
name: google_calendar
version: 0.2.0
description: "Gestione Calendario Google tramite CalDAV con App Password"
tools:
  - name: google_calendar.listEvents
    description: "Elenca gli eventi del Google Calendar in un intervallo di date"
    input:
      type: object
      properties:
        startDateTime: { type: string, description: "Data/ora di inizio ISO 8601 (default: oggi)" }
        endDateTime:   { type: string, description: "Data/ora di fine ISO 8601 (default: +7 giorni)" }
        maxResults:    { type: number, description: "Numero massimo di eventi (default: 25)", default: 25 }

  - name: google_calendar.createEvent
    description: "Crea un nuovo evento nel Google Calendar"
    input:
      type: object
      properties:
        summary:       { type: string, description: "Titolo dell'evento" }
        startDateTime: { type: string, description: "Data/ora di inizio ISO 8601" }
        endDateTime:   { type: string, description: "Data/ora di fine ISO 8601" }
        description:   { type: string, description: "Descrizione (opzionale)" }
        location:      { type: string, description: "Luogo (opzionale)" }
      required: [summary, startDateTime, endDateTime]

  - name: google_calendar.updateEvent
    description: "Aggiorna un evento esistente nel Google Calendar"
    input:
      type: object
      properties:
        eventId:       { type: string, description: "ID dell'evento (URL CalDAV da listEvents)" }
        summary:       { type: string, description: "Nuovo titolo (opzionale)" }
        startDateTime: { type: string, description: "Nuova data/ora di inizio ISO 8601 (opzionale)" }
        endDateTime:   { type: string, description: "Nuova data/ora di fine ISO 8601 (opzionale)" }
        description:   { type: string, description: "Nuova descrizione (opzionale)" }
        location:      { type: string, description: "Nuovo luogo (opzionale)" }
      required: [eventId]

  - name: google_calendar.deleteEvent
    description: "Elimina un evento dal Google Calendar"
    input:
      type: object
      properties:
        eventId: { type: string, description: "ID dell'evento da eliminare (URL CalDAV da listEvents)" }
      required: [eventId]

  - name: google_calendar.findFreeSlots
    description: "Trova le fasce orarie libere nel Google Calendar rispettando gli orari lavorativi"
    input:
      type: object
      properties:
        startDateTime:       { type: string, description: "Data/ora di inizio ricerca ISO 8601 (default: domani)" }
        endDateTime:         { type: string, description: "Data/ora di fine ricerca ISO 8601 (default: +7 giorni)" }
        slotDurationMinutes: { type: number, description: "Durata minima slot in minuti (default: 30)", default: 30 }
        workdayStartHour:    { type: number, description: "Ora inizio giornata lavorativa locale (default: 9)", default: 9 }
        workdayEndHour:      { type: number, description: "Ora fine giornata lavorativa locale (default: 18)", default: 18 }
        timeZone:            { type: string, description: "Fuso orario (default: Europe/Rome)", default: "Europe/Rome" }
---

# Regole d'uso
- Usa sempre il formato ISO 8601 per le date (es: '2024-01-15T09:00:00').
- Prima di creare un evento, verifica la disponibilita con `findFreeSlots`.
- Per aggiornare o eliminare un evento, usa prima `listEvents` per ottenere l'ID.
- Verifica sempre con l'utente prima di eliminare eventi: l'operazione e irreversibile.
- Il fuso orario di default e Europe/Rome.
- Credenziali: usa le stesse del connettore Gmail (`google.email` + `google.app_password`) — configurabili in Connectors.
