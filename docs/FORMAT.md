# CladeForge Project File Format (.cladeforge.json)

Machine-readable companion to MANUAL §14. One envelope, explicit versions, and
an ordered migration path — a third party can produce or consume this file
without reading the source.

## Envelope

```json
{
  "app": "CladeForge",
  "version": "0.2.0",
  "project": { … }
}
```

- `version` — the schema version the document was last validated against.
  A `0.1.0` file migrates forward (see below); a NEWER version opens on a
  best-effort basis and says so in the load report.
- Unknown top-level keys are PRESERVED verbatim and written back on save.
- A bare project object (no envelope) is accepted too.

## Schema version ↔ application version matrix

| schema | written by | migration |
|---|---|---|
| 0.1.0 | ≤ 0.1.x | upgraded to 0.2.0 on load (all new fields backfill with defaults) |
| 0.2.0 | ≥ 0.2.0 | current |

`PROJECT_VERSION` lives in `src/model/types.ts`; the application version is
injected from `package.json` at build time (`__APP_VERSION__`) and stamped into
every saved file as `project.appVersion`.

## Project fields (0.2.0)

| field | type | meaning |
|---|---|---|
| `nodes` | `Record<id, TreeNode>` | adjacency map; see TreeNode below |
| `rootId` | id | root of the tree |
| `customEdges` | array | user-drawn reticulation/association lines (DRAWING ANNOTATIONS — they never enter parsimony/Mk/DTL computation); each may carry `kind: 'hgt' \| 'hybridization' \| 'symbiosis' \| 'recombination' \| 'association'` and `note` |
| `layout` | object | mode/type/orientation/hGap/vGap + `timeUnit`, `timeAxisLength` (px; independent of topology), `timeScale: 'linear'|'sqrt'|'log'`, `timeLogOrigin`, `secondTimeUnit`, `supportThreshold`, `collapseBelowThreshold`, `labelLod` |
| `canvas` | object | width/height/background (explicit colour, never a CSS variable) |
| `defaults` | object | node/branch/edge style defaults + branch gradient |
| `characters` | array | traits; discrete carry ordered `states` (id/label/color) + optional `costMatrix` (Infinity forbids a transition), `model: 'unordered'|'wagner'|'dollo'|'custom'`, `weight` |
| `events` | array | evolutionary events; `typeId` keys the catalogue (built-ins + `customEventTypes`), per-event marker overrides optional |
| `layers` / `activeLayerId` / `layerStore` | — | hypothesis layers; each layer may carry `statement`, `prediction`, `status`, `evidence[]`, `author`, `createdAt/updatedAt`; the non-active snapshots live in `layerStore` |
| `environmentalEvents` | array | dated context bands on the time axis |
| `calibrationPoints` | array | fossil constraint notes `{nodeId, minAge, maxAge, source?}` — annotation + validation, NOT a dating computation |
| `geneTrees` | array | embedded gene trees for DTL; `assumptions` keyed by gene node id |
| `reconCosts` | object | DTL cost vector `{dup, transfer, loss}` |
| `reconOptions` | object | `{freeRoot? (default false), rootTransferCost?, tiePriority?, }` |
| `customEventTypes` | array | user-defined event ontology (`CustomEventType`) |
| `analysisResults` | array | retained analysis runs `{id, kind, fingerprint, method, params, version, createdAt, payload, pinned?}` |
| `provenance` | object | `{topologySource?, lengthSource?, dateSource?, traitSource?, methodsNote?, createdUtc?, modifiedUtc?}` |
| `sourcePath` | string | absolute path of the last open/save (desktop build only) |
| `savedAt` / `savedRevision` / `modifiedAt` / `appVersion` | — | save bookkeeping |

## TreeNode (0.2.0)

```json
{
  "id": "…", "label": "…", "parentId": "…" | null, "childrenIds": ["…"],
  "branchLength": 0.5,
  "support": 95, "supportKind": "bootstrap", "supportScale": "percent",
  "age": 12.0, "ageMin": 10.1, "ageMax": 14.9, "ageSource": "fossil", "ageCitation": "…",
  "position": {"x":0,"y":0}, "pinned": false, "collapsed": false,
  "style": {…}, "branchStyle": {…},
  "charStates": { "<characterId>": "s0" | 3.2 | ["s0","s1"] },
  "charMeta": { "<characterId>": {"confidence":"high","support":"…","accession":"…","doi":"…"} },
  "hypothesisNote": "…",
  "annotations": { "host": "human", "country": "CN", "date": "2024-01-31" }
}
```

- `charStates` value is a single state id (string), a number (continuous), or
  an ARRAY of state ids — a polymorphic / partially-observed set, scored by
  parsimony as the cheapest member and by Mk as the union of member likelihoods.
- `supportScale` is declared at import (0–1 fraction vs 0–100 percent); a value
  of `1` means **1%** under the percent convention and **100%** under the
  fraction convention — consumers MUST read the scale.

## Minimal file

```json
{
  "app": "CladeForge",
  "version": "0.2.0",
  "project": {
    "id": "demo",
    "name": "Minimal",
    "version": "0.2.0",
    "rootId": "r",
    "nodes": {
      "r": {"id": "r", "label": "root", "parentId": null, "childrenIds": ["a", "b"]},
      "a": {"id": "a", "label": "Alpha", "parentId": "r", "childrenIds": []},
      "b": {"id": "b", "label": "Beta", "parentId": "r", "childrenIds": []}
    },
    "customEdges": [],
    "layout": {"mode": "auto", "type": "rectangular-cladogram", "orientation": "LR", "hGap": 150, "vGap": 46},
    "canvas": {"width": 1600, "height": 1000, "background": "#ffffff"},
    "characters": [],
    "events": [],
    "layers": [{"id": "L1", "name": "Hypothesis 1"}],
    "activeLayerId": "L1",
    "layerStore": {},
    "environmentalEvents": [],
    "calibrationPoints": []
  }
}
```

Copy the JSON above into `minimal.cladeforge.json` and open it — that is the
whole format for a two-tip tree.

## JSON Schema

A machine-readable JSON Schema for the envelope is planned as
`schemas/project-0.2.0.schema.json`; the authoritative field reference until
then is this document plus `src/model/types.ts` (single source of truth).
