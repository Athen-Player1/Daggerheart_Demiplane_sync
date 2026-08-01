# Demiplane Daggerheart Importer

Foundry VTT addon module for importing a Demiplane Daggerheart character sheet URL into the Foundryborne `daggerheart` system.

## Current MVP features

- Adds a scene-controls import button for GMs.
- Imports from a Demiplane URL by scraping the public Next.js page payload.
- Creates a Foundryborne `character` actor.
- Stores the Demiplane source URL/id on the actor flags.
- Adds an **Update from Demiplane** button to imported character sheets.
- Re-fetches the URL and refreshes the actor name, portrait, level summary, and imported items.
- Matches selected class/subclass/ancestry/community/domain/equipment against Foundryborne compendium packs by name.
- Creates clearly-labelled placeholder loot items when no compendium match is found.

## Important CORS note

Foundry modules run in the browser. If Demiplane does not allow the Foundry origin to fetch the character page directly, browsers will block the request with CORS. The module includes a world setting named **CORS proxy URL template**. Set it to a trusted proxy template containing `{url}`, for example a local proxy you control:

```text
http://127.0.0.1:8787/?url={url}
```

Blank means "fetch Demiplane directly".

## Console API

```js
await DemiplaneDaggerheartImporter.importFromUrl('https://app.demiplane.com/nexus/daggerheart/character-sheet/<uuid>')
await DemiplaneDaggerheartImporter.updateActorFromSavedUrl(actor)
```
