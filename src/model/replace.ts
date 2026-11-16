// AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md.
// Global find & replace over a document's TEXTUAL fields (2026-11-15 OP-02).
//
// Scope is deliberately narrow and checkable: node names / hypothesis notes,
// evolutionary-event labels & notes, character names & state labels, hypothesis
// layers, and gene-tree names. Topology, styles, ages and state ASSIGNMENTS are
// never rewritten by a text substitution — a rename that silently moved a
// state assignment would change what the science says without changing any
// visible label.
//
// Every function here is pure: `collectReplacements` produces a preview the
// dialog renders BEFORE anything is committed, and `applyReplacements`
// re-verifies each old value against the live draft, so a preview computed a
// moment earlier cannot overwrite an edit made in between.

import type { Project } from './types';

export type ReplaceField =
  | 'nodeName'
  | 'hypothesisNote'
  | 'eventLabel'
  | 'eventNote'
  | 'characterName'
  | 'stateLabel'
  | 'layerName'
  | 'layerStatement'
  | 'layerPrediction'
  | 'geneTreeName';

export interface ReplaceOptions {
  find: string;
  replace: string;
  fields: ReplaceField[];
  caseSensitive: boolean;
}

export interface Replacement {
  field: ReplaceField;
  /** Node / event / character / layer / gene-tree id the replacement lands on. */
  id: string;
  /** For `stateLabel`, the owning character id. */
  parentId?: string;
  oldValue: string;
  newValue: string;
}

function matches(haystack: string, needle: string, caseSensitive: boolean): boolean {
  return caseSensitive ? haystack.includes(needle) : haystack.toLowerCase().includes(needle.toLowerCase());
}

function substitute(value: string, find: string, replace: string, caseSensitive: boolean): string {
  if (caseSensitive) return value.split(find).join(replace);
  // Escape the needle so it is treated literally, then rebuild with a global
  // case-insensitive regex.
  const escaped = find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return value.replace(new RegExp(escaped, 'gi'), replace);
}

/** Human-readable target description for the preview list. */
export function replaceFieldLabel(field: ReplaceField, project: Project, rep: Replacement): string {
  switch (field) {
    case 'nodeName':
      return project.nodes[rep.id]?.label || rep.id;
    case 'hypothesisNote':
      return project.nodes[rep.id]?.label || rep.id;
    case 'eventLabel':
    case 'eventNote':
      return project.events.find((e) => e.id === rep.id)?.label || project.events.find((e) => e.id === rep.id)?.note || rep.id;
    case 'characterName':
      return project.characters.find((c) => c.id === rep.id)?.name || rep.id;
    case 'stateLabel': {
      const ch = project.characters.find((c) => c.id === rep.parentId);
      const st = ch?.states.find((s) => s.id === rep.id);
      return `${ch?.name ?? '?'} / ${st?.label ?? rep.id}`;
    }
    case 'layerName':
    case 'layerStatement':
    case 'layerPrediction':
      return project.layers.find((l) => l.id === rep.id)?.name || rep.id;
    case 'geneTreeName':
      return project.geneTrees?.find((g) => g.id === rep.id)?.name || rep.id;
    default:
      return rep.id;
  }
}

/** Collect every textual replacement the options describe. Empty find = none. */
export function collectReplacements(project: Project, options: ReplaceOptions): Replacement[] {
  const { find, replace, fields, caseSensitive } = options;
  if (find === '') return [];
  const out: Replacement[] = [];
  const has = (f: ReplaceField) => fields.includes(f);

  const push = (field: ReplaceField, id: string, oldValue: string, parentId?: string) => {
    if (oldValue === '' || !matches(oldValue, find, caseSensitive)) return;
    const newValue = substitute(oldValue, find, replace, caseSensitive);
    if (newValue === oldValue) return;
    out.push({ field, id, ...(parentId ? { parentId } : {}), oldValue, newValue });
  };

  for (const n of Object.values(project.nodes)) {
    if (has('nodeName')) push('nodeName', n.id, n.label);
    if (has('hypothesisNote') && n.hypothesisNote !== undefined) {
      push('hypothesisNote', n.id, n.hypothesisNote);
    }
  }
  for (const e of project.events) {
    if (has('eventLabel') && e.label !== undefined) push('eventLabel', e.id, e.label);
    if (has('eventNote') && e.note !== undefined) push('eventNote', e.id, e.note);
  }
  for (const c of project.characters) {
    if (has('characterName')) push('characterName', c.id, c.name);
    if (has('stateLabel')) {
      for (const s of c.states) push('stateLabel', s.id, s.label, c.id);
    }
  }
  for (const l of project.layers) {
    if (has('layerName')) push('layerName', l.id, l.name);
    if (has('layerStatement') && l.statement !== undefined) push('layerStatement', l.id, l.statement);
    if (has('layerPrediction') && l.prediction !== undefined) push('layerPrediction', l.id, l.prediction);
  }
  for (const g of project.geneTrees ?? []) {
    if (has('geneTreeName')) push('geneTreeName', g.id, g.name);
  }
  return out;
}

/**
 * Apply collected replacements to a draft, re-checking each old value first.
 * Returns how many replacements actually landed (a stale preview can miss).
 */
export function applyReplacements(project: Project, replacements: Replacement[]): number {
  let applied = 0;
  for (const rep of replacements) {
    switch (rep.field) {
      case 'nodeName': {
        const n = project.nodes[rep.id];
        if (n && n.label === rep.oldValue) {
          n.label = rep.newValue;
          applied += 1;
        }
        break;
      }
      case 'hypothesisNote': {
        const n = project.nodes[rep.id];
        if (n && n.hypothesisNote === rep.oldValue) {
          n.hypothesisNote = rep.newValue;
          applied += 1;
        }
        break;
      }
      case 'eventLabel': {
        const e = project.events.find((x) => x.id === rep.id);
        if (e && e.label === rep.oldValue) {
          e.label = rep.newValue;
          applied += 1;
        }
        break;
      }
      case 'eventNote': {
        const e = project.events.find((x) => x.id === rep.id);
        if (e && e.note === rep.oldValue) {
          e.note = rep.newValue;
          applied += 1;
        }
        break;
      }
      case 'characterName': {
        const c = project.characters.find((x) => x.id === rep.id);
        if (c && c.name === rep.oldValue) {
          c.name = rep.newValue;
          applied += 1;
        }
        break;
      }
      case 'stateLabel': {
        const c = project.characters.find((x) => x.id === rep.parentId);
        const st = c?.states.find((x) => x.id === rep.id);
        if (st && st.label === rep.oldValue) {
          st.label = rep.newValue;
          applied += 1;
        }
        break;
      }
      case 'layerName':
      case 'layerStatement':
      case 'layerPrediction': {
        const l = project.layers.find((x) => x.id === rep.id);
        if (!l) break;
        const key = rep.field === 'layerName' ? 'name' : rep.field === 'layerStatement' ? 'statement' : 'prediction';
        const current = l[key];
        if (typeof current === 'string' && current === rep.oldValue) {
          l[key] = rep.newValue;
          applied += 1;
        }
        break;
      }
      case 'geneTreeName': {
        const g = project.geneTrees?.find((x) => x.id === rep.id);
        if (g && g.name === rep.oldValue) {
          g.name = rep.newValue;
          applied += 1;
        }
        break;
      }
    }
  }
  return applied;
}
