---
name: chat_memory
version: 0.1.0
description: "Gestione della memoria conversazionale del live corrente. Usa questa skill quando l'utente chiede di azzerare, cancellare, resettare o dimenticare il contesto delle ultime conversazioni della sessione attiva."
tools:
  - name: chat.clearMemory
    description: "Cancella la memoria conversazionale della sessione corrente del live attivo"
    input:
      type: object
      properties:
        confirm:
          type: boolean
          description: "Imposta true solo se l'utente ha chiesto esplicitamente di cancellare la memoria"
      required: [confirm]
---

# Regole d'uso
- Usa `chat.clearMemory` solo quando l'utente chiede in modo esplicito di cancellare, resettare o azzerare la memoria o il contesto.
- Prima di chiamare il tool, verifica che la richiesta sia inequivocabile.
- Passa sempre `confirm: true` quando la richiesta e' esplicita.
- Dopo il reset, informa l'utente che il contesto precedente della sessione corrente e' stato eliminato.
