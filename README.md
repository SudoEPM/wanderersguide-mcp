# Wanderer's Guide MCP Server

An MCP server that exposes [Wanderer's Guide](https://wanderersguide.app) Pathfinder 2e data to Claude.

## Setup

1. Obtain an API key from your Wanderer's Guide account (Developer → API Clients).
2. Create a `.env` file in the project root:
   ```
   WG_API_KEY=your-36-character-uuid-api-key-here
   # Optional: default campaign ID used when campaign_id is not passed to a tool
   WG_CAMPAIGN_ID=your-campaign-id
   ```
3. Install dependencies and build:
   ```
   npm install && npm run build
   ```
4. Add the server to your MCP client configuration pointing to `node dist/index.js`.

## Implemented tools

| Tool | API endpoint(s) | Description |
|---|---|---|
| `search_content` | `POST /search-data` | Full-text search across all PF2e content |
| `find_spell` | `POST /find-spell` | Look up spells by name, ID, trait IDs, or content source |
| `find_feat` | `POST /find-ability-block` | Look up feats, actions, class features, heritages by name, ID, type, traits, or prerequisites |
| `find_item` | `POST /find-item` | Look up equipment, weapons, and treasure by name or ID |
| `find_creature` | `POST /find-creature` | Look up creatures by name or ID |
| `find_ancestry` | `POST /find-ancestry` | Look up ancestries by name or ID |
| `find_background` | `POST /find-background` | Look up backgrounds by name or ID |
| `find_archetype` | `POST /find-archetype` | Look up archetypes by ID, content source, or dedication feat |
| `find_class_archetype` | `POST /find-class-archetype` | Look up class-specific archetypes by ID, class, or content source |
| `find_class` | `POST /find-class` | Look up classes by ID or content source |
| `find_language` | `POST /find-language` | Look up languages by name, ID, or content source |
| `find_trait` | `POST /find-trait` | Look up traits by name or ID — useful to resolve a name to an ID for filters |
| `find_versatile_heritage` | `POST /find-versatile-heritage` | Look up versatile heritages by ID, content source, or parent heritage |
| `find_content_source` | `POST /find-content-source` | Look up books and homebrew packs by ID, group, or flags |
| `find_content_update` | `POST /find-content-update` | Look up community errata submissions by state, user, or date range |
| `find_character` | `POST /find-character` | Retrieve character sheets by ID, user UUID, or campaign ID |
| `find_campaign` | `POST /find-campaign` | Retrieve campaigns by ID, user UUID, or join key |
| `find_encounter` | `POST /find-encounter` | Retrieve encounters by ID or campaign ID |
| `create_encounter` | `POST /create-encounter` | Create a new encounter in a campaign |
| `update_encounter` | `POST /create-encounter` (with `id`) | Update an existing encounter's name, description, or color |
| `delete_encounter` | `POST /delete-content` (`type: encounter`) | Permanently delete an encounter |

> **Note on encounter update/delete:** The API does not expose `/update-encounter` or `/delete-encounter` as standalone endpoints. Updates use the same `/create-encounter` upsert pattern (pass `id` to update), and deletion uses the generic `/delete-content` endpoint with `type: 'encounter'`.

> `find-trait` is also called internally to resolve trait IDs to names in spell and item results.

## Not yet implemented

### Content — create / update

| API endpoint | Description |
|---|---|
| `POST /create-spell` | Insert or update a homebrew spell |
| `POST /create-item` | Insert or update a homebrew item |
| `POST /create-ability-block` | Insert or update a homebrew feat/action/feature |
| `POST /create-ancestry` | Insert or update a homebrew ancestry |
| `POST /create-archetype` | Insert or update a homebrew archetype |
| `POST /create-background` | Insert or update a homebrew background |
| `POST /create-class` | Insert or update a homebrew class |
| `POST /create-class-archetype` | Insert or update a homebrew class archetype |
| `POST /create-content-source` | Create a new homebrew content source |
| `POST /create-content-update` | Submit community errata for review |
| `POST /create-creature` | Insert or update a homebrew creature |
| `POST /create-language` | Insert or update a homebrew language |
| `POST /create-trait` | Insert or update a homebrew trait |
| `POST /create-versatile-heritage` | Insert or update a homebrew versatile heritage |

### Content — delete

| API endpoint | Description |
|---|---|
| `POST /delete-content` | Remove any homebrew content row by ID and type (not yet exposed as a generic tool) |

### Character

| API endpoint | Description |
|---|---|
| `POST /create-character` | Create or update a character sheet |
| `POST /update-character` | Modify specific fields on an existing character |

## Running tests

Integration tests make real API calls and require `WG_API_KEY` to be set in `.env`. Set `WG_CAMPAIGN_ID` as well to exercise the env-var fallback tests:

```
npm test
```
