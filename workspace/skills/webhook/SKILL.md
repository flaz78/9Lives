---
name: webhook
version: 0.2.0
description: "Invocazione di webhook HTTP configurati nei Connectors. Usa questa skill quando l'utente chiede di inviare o leggere dati tramite endpoint esterni usando webhook preconfigurati."
tools:
  - name: webhook.call
    description: "Chiama un webhook configurato nei Connectors"
    input:
      type: object
      properties:
        webhookId: { type: string, description: "ID del webhook configurato" }
        body:
          description: "Payload opzionale. Se omesso viene usato il bodyTemplate del webhook (se configurato). Se bodyTemplate e body sono oggetti JSON, vengono uniti con priorita' ai campi di body."
        headers:
          type: object
          description: "Header aggiuntivi opzionali"
      required: [webhookId]
---

# Regole d'uso
- Usa solo webhook gia' configurati nei Connectors.
- Scegli `webhookId` tra quelli consentiti per il Live corrente.
- Se il Live ha una allowlist webhook configurata, non tentare webhook non presenti nella lista.
- Metodo HTTP, URL e API key vengono presi dal connettore.
- `body` e' opzionale:
  - se manca, viene usato `bodyTemplate` del connettore (se presente)
  - se entrambi sono oggetti JSON, `body` sovrascrive i campi omonimi del template
- L'API key viene inviata automaticamente nell'header `x-api-key`.
- Usa questo tool solo quando l'utente richiede esplicitamente un'azione verso un sistema esterno via webhook.
