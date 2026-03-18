---
name: cron_scheduler
version: 0.1.0
description: "Gestione dei cron job di Live/Crew (creazione, modifica, elenco, rimozione) integrata con scheduler e UI"
tools:
  - name: job.list
    description: "Elenca i job pianificati di un live o di una crew"
    input:
      type: object
      properties:
        liveId:
          type: string
          description: "ID del live target. Se omesso usa il live corrente"
        crewId:
          type: string
          description: "ID della crew target"
  - name: job.create
    description: "Crea un nuovo job cron nel sistema scheduler"
    input:
      type: object
      properties:
        liveId:
          type: string
          description: "ID del live target. Se omesso usa il live corrente"
        crewId:
          type: string
          description: "ID della crew target"
        name:
          type: string
          description: "Nome del job"
        cronExpr:
          type: string
          description: "Espressione cron valida (es: 0 9 * * *)"
        prompt:
          type: string
          description: "Prompt da eseguire al trigger del job"
        startDate:
          type: string
          description: "Inizio validita (ISO), opzionale"
        endDate:
          type: string
          description: "Fine validita (ISO), opzionale"
      required: [cronExpr, prompt]
  - name: job.update
    description: "Modifica un job esistente (cron, prompt, nome, date, enabled)"
    input:
      type: object
      properties:
        id:
          type: string
          description: "ID del job"
        liveId:
          type: string
          description: "ID del live target. Se omesso usa il live corrente"
        crewId:
          type: string
          description: "ID della crew target"
        name:
          type: string
        cronExpr:
          type: string
        prompt:
          type: string
        startDate:
          type: string
          description: "Nuova data inizio (stringa vuota per rimuovere)"
        endDate:
          type: string
          description: "Nuova data fine (stringa vuota per rimuovere)"
        enabled:
          type: boolean
      required: [id]
  - name: job.delete
    description: "Elimina un job esistente"
    input:
      type: object
      properties:
        id:
          type: string
          description: "ID del job"
        liveId:
          type: string
          description: "ID del live target. Se omesso usa il live corrente"
        crewId:
          type: string
          description: "ID della crew target"
      required: [id]
---

# Regole d'uso
- Usa questa skill quando l'utente chiede di pianificare, aggiornare, disattivare o eliminare job cron.
- Prima di creare o modificare, valida sempre che `cronExpr` sia un'espressione cron valida.
- Preferisci `job.update` invece di cancellare/ricreare quando l'utente chiede una modifica.
- Dopo ogni operazione di scrittura (`job.create`, `job.update`, `job.delete`), conferma l'ID job restituito.
- I job creati con questa skill sono gli stessi visibili/modificabili nella UI Jobs di 9Lives.
