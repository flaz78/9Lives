---
name: blender_skill
version: 0.4.0
description: "Automazione Blender per 9Lives in due modalita: batch headless e live bridge realtime tramite addon Blender locale. Supporta modellazione base, materiali, luci, camere, render e import/export."
tools:
  - name: blender.checkAvailability
    description: "Verifica se Blender e il runtime Python batch sono disponibili"
    input:
      type: object
      properties: {}
  - name: blender.buildScene
    description: "Genera una scena completa in modalita batch/headless a partire da un JSON strutturato"
    input:
      type: object
      properties:
        scene_name: { type: string }
        project_path: { type: string }
        save_path: { type: string }
        reset_first: { type: boolean }
        objects:
          type: array
          items:
            type: object
            properties:
              type: { type: string, enum: [cube, sphere, cylinder, plane, cone, torus, text] }
              name: { type: string }
              text: { type: string }
              location: { type: array, items: { type: number } }
              rotation: { type: array, items: { type: number } }
              scale: { type: array, items: { type: number } }
              dimensions: { type: array, items: { type: number } }
              material: { type: object }
            required: [type, name]
        lights:
          type: array
          items:
            type: object
            properties:
              type: { type: string, enum: [point, sun, area, spot] }
              name: { type: string }
              location: { type: array, items: { type: number } }
              rotation: { type: array, items: { type: number } }
              color: { type: array, items: { type: number } }
              energy: { type: number }
            required: [type, name]
        camera: { type: object }
        render: { type: object }
  - name: blender.liveStatus
    description: "Verifica lo stato del bridge live esposto dall'addon Blender locale"
    input:
      type: object
      properties: {}
  - name: blender.liveSceneState
    description: "Legge stato scena, selezione e camera dalla sessione Blender live"
    input:
      type: object
      properties: {}
  - name: blender.liveBuildScene
    description: "Costruisce una scena strutturata dentro una sessione Blender GUI gia aperta"
    input:
      type: object
      properties:
        project_path: { type: string }
        save_path: { type: string }
        scene_name: { type: string }
        reset_first: { type: boolean }
        objects:
          type: array
          items:
            type: object
            properties:
              type: { type: string, enum: [cube, sphere, cylinder, plane, cone, torus, text] }
              name: { type: string }
              text: { type: string }
              location: { type: array, items: { type: number } }
              rotation: { type: array, items: { type: number } }
              scale: { type: array, items: { type: number } }
              dimensions: { type: array, items: { type: number } }
              material: { type: object }
            required: [type, name]
        lights:
          type: array
          items:
            type: object
            properties:
              type: { type: string, enum: [point, sun, area, spot] }
              name: { type: string }
              location: { type: array, items: { type: number } }
              rotation: { type: array, items: { type: number } }
              color: { type: array, items: { type: number } }
              energy: { type: number }
            required: [type, name]
        camera: { type: object }
        render: { type: object }
  - name: blender.liveCreateObject
    description: "Crea un oggetto base 3D nella sessione live. Usalo per costruire forme complesse combinando piu primitive come cube, cylinder, plane, sphere, cone, torus e text"
    input:
      type: object
      properties:
        project_path: { type: string }
        save_path: { type: string }
        object:
          type: object
          properties:
            type: { type: string, enum: [cube, sphere, cylinder, plane, cone, torus, text] }
            name: { type: string }
            text: { type: string }
            location: { type: array, items: { type: number } }
            rotation: { type: array, items: { type: number } }
            scale: { type: array, items: { type: number } }
            dimensions: { type: array, items: { type: number } }
            material: { type: object }
          required: [type, name]
      required: [object]
  - name: blender.liveModifyObject
    description: "Modifica un oggetto esistente nella sessione live con operazioni move, rotate, scale, delete, duplicate, rename, set_origin o parent"
    input:
      type: object
      properties:
        project_path: { type: string }
        save_path: { type: string }
        operation_data:
          type: object
          properties:
            target_name: { type: string }
            operation: { type: string, enum: [move, rotate, scale, delete, duplicate, rename, set_origin, parent] }
            location: { type: array, items: { type: number } }
            rotation: { type: array, items: { type: number } }
            scale: { type: array, items: { type: number } }
            new_name: { type: string }
            parent_name: { type: string }
            origin_mode: { type: string }
          required: [target_name, operation]
      required: [operation_data]
  - name: blender.liveAssignMaterial
    description: "Assegna un materiale base a un oggetto nella sessione live"
    input:
      type: object
      properties:
        project_path: { type: string }
        save_path: { type: string }
        object_name: { type: string }
        material:
          type: object
          properties:
            base_color: { type: array, items: { type: number } }
            metallic: { type: number }
            roughness: { type: number }
            transmission: { type: number }
            emission_color: { type: array, items: { type: number } }
            emission_strength: { type: number }
            ior: { type: number }
      required: [object_name, material]
  - name: blender.liveCreateLight
    description: "Crea una luce point, sun, area o spot nella sessione live"
    input:
      type: object
      properties:
        project_path: { type: string }
        save_path: { type: string }
        light:
          type: object
          properties:
            type: { type: string, enum: [point, sun, area, spot] }
            name: { type: string }
            location: { type: array, items: { type: number } }
            rotation: { type: array, items: { type: number } }
            color: { type: array, items: { type: number } }
            energy: { type: number }
          required: [type, name]
      required: [light]
  - name: blender.liveCreateCamera
    description: "Crea e posiziona una camera nella sessione live"
    input:
      type: object
      properties:
        project_path: { type: string }
        save_path: { type: string }
        camera:
          type: object
          properties:
            name: { type: string }
            location: { type: array, items: { type: number } }
            rotation: { type: array, items: { type: number } }
            lens: { type: number }
            set_active: { type: boolean }
      required: [camera]
  - name: blender.liveRenderStill
    description: "Renderizza un'immagine dalla sessione Blender live"
    input:
      type: object
      properties:
        project_path: { type: string }
        save_path: { type: string }
        render:
          type: object
          properties:
            engine: { type: string, enum: [EEVEE, BLENDER_EEVEE, CYCLES] }
            resolution_x: { type: number }
            resolution_y: { type: number }
            samples: { type: number }
            transparent_background: { type: boolean }
            background_color: { type: array, items: { type: number } }
            output_path: { type: string }
          required: [output_path]
      required: [render]
  - name: blender.liveImportAsset
    description: "Importa OBJ o GLTF/GLB nella sessione Blender live"
    input:
      type: object
      properties:
        project_path: { type: string }
        save_path: { type: string }
        input_path: { type: string }
        format: { type: string, enum: [obj, glb, gltf] }
      required: [input_path]
  - name: blender.liveExportAsset
    description: "Esporta la scena live in OBJ, GLTF/GLB o FBX"
    input:
      type: object
      properties:
        project_path: { type: string }
        output_path: { type: string }
        format: { type: string, enum: [obj, glb, gltf, fbx] }
      required: [output_path]
  - name: blender.liveSelectObjects
    description: "Seleziona uno o piu oggetti nella sessione Blender live"
    input:
      type: object
      properties:
        object_names: { type: array, items: { type: string } }
      required: [object_names]
  - name: blender.liveViewportPreview
    description: "Salva una preview viewport PNG dalla sessione Blender live"
    input:
      type: object
      properties:
        output_path: { type: string }
      required: [output_path]
  - name: blender.liveExecute
    description: "Tool avanzato generico per eseguire azioni realtime whitelistate sul bridge Blender live quando non esiste un tool piu specifico"
    input:
      type: object
      properties:
        action: { type: string }
        payload: { type: object }
        timeout_ms: { type: number }
      required: [action]
---

# Regole d'uso
- Usa la modalita `blender.*` batch quando devi eseguire job headless, render deterministici o pipeline senza GUI.
- Usa la modalita `blender.live*` quando Blender gira sulla macchina locale con addon `9Lives Live Bridge` attivo e serve interazione realtime.
- Per modellazione 3D di oggetti complessi usa una strategia compositiva: crea piu primitive con `blender.liveCreateObject`, poi rifiniscile con `blender.liveModifyObject`, assegna materiali con `blender.liveAssignMaterial` e infine aggiungi luci/camera/render.
- Una poltrona, una sedia o un tavolo non richiedono mesh custom: costruiscili come insieme di seduta, schienale, braccioli, gambe e cuscini usando cube, cylinder, plane e torus con scale/rotation/location diverse.
- Usa `blender.liveBuildScene` quando hai gia una descrizione JSON strutturata di tutti gli oggetti da creare in un colpo solo.
- Usa `blender.liveExecute` solo come fallback avanzato quando il bridge supporta gia un'azione whitelistata ma non esiste ancora un tool dedicato piu leggibile.
- Prima di usare i tool live esegui `blender.liveStatus` per verificare bridge, token e scena raggiungibile.
- Tutte le azioni live sono whitelistate e serializzate sul main thread di Blender; non usare input arbitrari o codice Python libero.
- Mantieni `BLENDER_LIVE_BASE_URL` e `BLENDER_LIVE_TOKEN` configurati nel gateway quando il bridge Blender gira fuori dal container 9Lives.
