// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { parseNexml, serializeNexml } from './nexml';
import type { Project } from '../model/types';

/**
 * A small third-party-style NeXML document: every element uses the `nex`
 * prefix, while the XML Schema-instance namespace uses a different `alt`
 * prefix. Prefixes are semantically irrelevant; the namespace URIs are not.
 */
const PREFIXED_XML = `<?xml version="1.0" encoding="UTF-8"?>
<nex:nexml xmlns:nex="http://www.nexml.org/2009" xmlns:alt="http://www.w3.org/2001/XMLSchema-instance" version="0.9" generator="fixture">
  <nex:otus id="otus1" label="Prefixed fixture">
    <nex:otu id="otu1" label="Alpha &amp; Beta"/>
    <nex:otu id="otu2" label="Gamma"/>
    <nex:meta rel="cladeforge:hypothesis-layers" content='[{"id":"layer1","name":"Imported hypothesis"}]'/>
    <nex:meta rel="cladeforge:provenance" content='{"author":"Fixture author"}'/>
  </nex:otus>
  <nex:characters id="chars1" alt:type="nex:StandardCells" otus="otus1">
    <nex:format>
      <nex:char id="habitat" label="Habitat" states="habitat-states"/>
    </nex:format>
    <nex:states id="habitat-states">
      <nex:state id="marine" symbol="M" label="Marine"/>
      <nex:state id="land" symbol="L" label="Terrestrial"/>
    </nex:states>
    <nex:matrix>
      <nex:row id="row1" otu="otu1"><nex:cell char="habitat" state="marine"/></nex:row>
      <nex:row id="row2" otu="otu2"><nex:cell char="habitat" state="land"/></nex:row>
    </nex:matrix>
  </nex:characters>
  <nex:characters id="chars2" alt:type="nex:ContinuousCells" otus="otus1">
    <nex:format><nex:char id="bodyLength" label="Body length"/></nex:format>
    <nex:matrix>
      <nex:row id="crow1" otu="otu1"><nex:cell char="bodyLength" state="1.25"/></nex:row>
    </nex:matrix>
  </nex:characters>
  <nex:trees id="trees1" otus="otus1">
    <nex:tree id="tree1" label="Prefixed tree">
      <nex:node id="root" label="Root"/>
      <nex:node id="clade" label="Clade"/>
      <nex:node id="tip1" otu="otu1"/>
      <nex:node id="tip2" otu="otu2"/>
      <nex:edge source="root" target="clade" length="0.5">
        <nex:meta rel="cladeforge:events" content='[{"typeId":"key-innovation","target":"branch","label":"Innovation"}]'/>
      </nex:edge>
      <nex:edge source="clade" target="tip1" length="0.25"/>
      <nex:edge source="root" target="tip2" length="0.75"/>
    </nex:tree>
  </nex:trees>
</nex:nexml>`;

// The same valid document expressed with a default namespace. Keep attribute
// values such as alt:type="nex:ContinuousCells" unchanged.
const DEFAULT_NAMESPACE_XML = PREFIXED_XML
  .replace('xmlns:nex="http://www.nexml.org/2009"', 'xmlns="http://www.nexml.org/2009"')
  .replace(/<(\/?)nex:/g, '<$1');

function onlyProject(xml: string): Project {
  const parsed = parseNexml(xml, 'fixture');
  expect(parsed.issues).toEqual([]);
  expect(parsed.projects).toHaveLength(1);
  return parsed.projects[0];
}

function withCompetingTypeAttributes(xsiPrefix: string, otherFirst: boolean): string {
  const xml = PREFIXED_XML.replace(
    'xmlns:alt="http://www.w3.org/2001/XMLSchema-instance"',
    `xmlns:${xsiPrefix}="http://www.w3.org/2001/XMLSchema-instance" xmlns:other="urn:cladeforge:other"`,
  ).replaceAll('alt:type', `${xsiPrefix}:type`);
  const xsiType = `${xsiPrefix}:type="nex:StandardCells"`;
  const otherType = 'other:type="nex:ContinuousCells"';
  return xml.replace(
    xsiType,
    otherFirst ? `${otherType} ${xsiType}` : `${xsiType} ${otherType}`,
  );
}

function withForeignNamespace(xml: string): string {
  return xml.replace(
    'xmlns:alt="http://www.w3.org/2001/XMLSchema-instance"',
    'xmlns:alt="http://www.w3.org/2001/XMLSchema-instance" xmlns:ext="urn:cladeforge:foreign"',
  );
}

function withForeignScientificLookalikes(): string {
  return withForeignNamespace(PREFIXED_XML)
    .replace(
      '  <nex:otus',
      `  <ext:otus id="foreign-otus">
    <ext:otu id="otu1" label="Injected taxon"/>
    <ext:meta rel="cladeforge:hypothesis-layers" content='[{"id":"foreign-layer","name":"Injected layer"}]'/>
    <ext:meta rel="cladeforge:provenance" content='{"author":"Injected author"}'/>
  </ext:otus>
  <nex:otus`,
    )
    .replace(
      '  <nex:trees',
      `  <ext:trees id="foreign-trees">
    <ext:tree id="foreign-tree">
      <ext:node id="foreign-root" label="Injected root"/>
      <ext:node id="foreign-tip" otu="otu1"/>
      <ext:edge source="foreign-root" target="foreign-tip" length="99">
        <ext:meta rel="cladeforge:events" content='[{"typeId":"other","label":"Injected event"}]'/>
      </ext:edge>
    </ext:tree>
  </ext:trees>
  <nex:trees`,
    )
    .replace(
      '      <nex:node id="root" label="Root"/>',
      `      <ext:node id="injected-root" label="Injected nested root"/>
      <ext:node id="injected-tip" otu="otu1"/>
      <ext:edge source="injected-root" target="injected-tip" length="88"/>
      <nex:node id="root" label="Root"/>`,
    );
}

function withForeignScientificReplacements(): string {
  return withForeignNamespace(PREFIXED_XML)
    .replace(
      /<nex:otus[\s\S]*?<\/nex:otus>/,
      `<ext:otus id="foreign-otus">
    <ext:otu id="otu1" label="Injected taxon"/>
    <ext:meta rel="cladeforge:hypothesis-layers" content='[{"id":"foreign-layer","name":"Injected layer"}]'/>
    <ext:meta rel="cladeforge:provenance" content='{"author":"Injected author"}'/>
  </ext:otus>`,
    )
    .replace(
      /<nex:trees[\s\S]*?<\/nex:trees>/,
      `<ext:trees id="foreign-trees">
    <ext:tree id="foreign-tree">
      <ext:node id="foreign-root" label="Injected root"/>
      <ext:node id="foreign-tip" otu="otu1"/>
      <ext:edge source="foreign-root" target="foreign-tip" length="99">
        <ext:meta rel="cladeforge:events" content='[{"typeId":"other","label":"Injected event"}]'/>
      </ext:edge>
    </ext:tree>
  </ext:trees>`,
    );
}

function withForeignMetadataLookalikes(): string {
  return withForeignNamespace(PREFIXED_XML)
    .replace(
      '<nex:meta rel="cladeforge:provenance" content=\'{"author":"Fixture author"}\'/>',
      `<nex:meta rel="cladeforge:provenance" content='{"author":"Fixture author"}'/>
    <ext:meta rel="cladeforge:provenance" content='{"author":"Injected author"}'/>`,
    )
    .replace(
      '<nex:meta rel="cladeforge:hypothesis-layers" content=\'[{"id":"layer1","name":"Imported hypothesis"}]\'/>',
      '<ext:meta rel="cladeforge:hypothesis-layers" content=\'[{"id":"foreign-layer","name":"Injected layer"}]\'/>',
    )
    .replace(
      '<nex:edge source="root" target="clade" length="0.5">',
      `<nex:edge source="root" target="clade" length="0.5">
        <ext:meta rel="cladeforge:events" content='[{"typeId":"other","label":"Injected event"}]'/>`,
    );
}

function scientificSummary(project: Project) {
  const habitat = project.characters.find((c) => c.name === 'Habitat');
  const bodyLength = project.characters.find((c) => c.name === 'Body length');
  const alpha = Object.values(project.nodes).find((n) => n.label === 'Alpha & Beta');
  return {
    rootLabel: project.nodes[project.rootId].label,
    tipLabels: Object.values(project.nodes)
      .filter((n) => n.childrenIds.length === 0)
      .map((n) => n.label)
      .sort(),
    branchLengths: Object.values(project.nodes).map((n) => n.branchLength).filter((n) => n !== undefined).sort(),
    habitatType: habitat?.type,
    habitatStates: habitat?.states.map((s) => s.label).sort(),
    alphaHabitat: habitat
      ? habitat.states.find((s) => s.id === alpha?.charStates?.[habitat.id])?.label
      : undefined,
    bodyLengthType: bodyLength?.type,
    alphaBodyLength: bodyLength ? alpha?.charStates?.[bodyLength.id] : undefined,
    eventLabels: project.events.map((e) => e.label),
    layerNames: project.layers.map((l) => l.name),
    provenanceAuthor: project.provenance?.author,
  };
}

const EXPECTED_SUMMARY = {
  rootLabel: 'Root',
  tipLabels: ['Alpha & Beta', 'Gamma'],
  branchLengths: [0.25, 0.5, 0.75],
  habitatType: 'discrete',
  habitatStates: ['Marine', 'Terrestrial'],
  alphaHabitat: 'Marine',
  bodyLengthType: 'continuous',
  alphaBodyLength: 1.25,
  eventLabels: ['Innovation'],
  layerNames: ['Imported hypothesis'],
  provenanceAuthor: 'Fixture author',
};

describe('NeXML namespace-prefix-independent import (CF-B-008)', () => {
  it('imports a realistic fully prefixed tree, matrices, events and layer metadata', () => {
    expect(scientificSummary(onlyProject(PREFIXED_XML))).toEqual(EXPECTED_SUMMARY);
  });

  it('recognizes xsi:type by local name when its namespace prefix is alt', () => {
    // Element lookup already works in the default-namespace form, isolating the
    // attribute-prefix bug: getAttribute("xsi:type") misses alt:type.
    const project = onlyProject(DEFAULT_NAMESPACE_XML);
    expect(project.characters.find((c) => c.name === 'Body length')?.type).toBe('continuous');
  });

  it('preserves the existing default-namespace import behavior', () => {
    expect(scientificSummary(onlyProject(DEFAULT_NAMESPACE_XML))).toEqual(EXPECTED_SUMMARY);
  });

  it.each([
    { xsiPrefix: 'xsi', otherFirst: true },
    { xsiPrefix: 'xsi', otherFirst: false },
    { xsiPrefix: 'alt', otherFirst: true },
    { xsiPrefix: 'alt', otherFirst: false },
  ])('uses $xsiPrefix:type despite a competing other:type (other first: $otherFirst)', ({ xsiPrefix, otherFirst }) => {
    const summary = scientificSummary(onlyProject(withCompetingTypeAttributes(xsiPrefix, otherFirst)));
    expect(summary.habitatType).toBe('discrete');
    expect(summary.bodyLengthType).toBe('continuous');
    expect(summary.alphaHabitat).toBe('Marine');
    expect(summary.alphaBodyLength).toBe(1.25);
  });

  it('ignores namespaced lookalikes for ordinary unqualified attributes', () => {
    const xml = PREFIXED_XML
      .replace(
        'xmlns:alt="http://www.w3.org/2001/XMLSchema-instance"',
        'xmlns:alt="http://www.w3.org/2001/XMLSchema-instance" xmlns:other="urn:cladeforge:other"',
      )
      .replace(
        '<nex:char id="habitat" label="Habitat" states="habitat-states"/>',
        '<nex:char other:id="foreign" other:label="Foreign" states="habitat-states"/>',
      );
    const project = onlyProject(xml);
    expect(project.characters.map((c) => c.name)).toEqual(['Character 1', 'Body length']);
  });

  it('round-trips the prefixed fixture through export and re-import', () => {
    const imported = onlyProject(PREFIXED_XML);
    const exported = serializeNexml(imported);
    expect(exported).toContain('<nex:nexml');
    expect(scientificSummary(onlyProject(exported))).toEqual(EXPECTED_SUMMARY);
  });

  it('ignores foreign-namespace OTUs, trees, nodes and metadata preceding valid NeXML', () => {
    const project = onlyProject(withForeignScientificLookalikes());
    expect(scientificSummary(project)).toEqual(EXPECTED_SUMMARY);
    expect(Object.values(project.nodes).some((n) => n.label.includes('Injected'))).toBe(false);
  });

  it('does not import taxa, topology or annotations from foreign replacements for OTUs and trees', () => {
    const parsed = parseNexml(withForeignScientificReplacements(), 'foreign replacements');
    expect(parsed.projects).toEqual([]);
    expect(parsed.characters.map((c) => c.name)).toEqual(['Habitat', 'Body length']);
    expect(parsed.issues).toEqual([]);
  });

  it('ignores foreign metadata that precedes or replaces NeXML metadata', () => {
    const project = onlyProject(withForeignMetadataLookalikes());
    const summary = scientificSummary(project);
    expect(summary).toMatchObject({ ...EXPECTED_SUMMARY, layerNames: expect.any(Array) });
    expect(summary.layerNames).toHaveLength(1);
    expect(summary.layerNames[0]).not.toContain('Injected');
    expect(summary.provenanceAuthor).toBe('Fixture author');
  });

  it('still rejects malformed XML through parsererror detection', () => {
    expect(() => parseNexml('<nex:nexml xmlns:nex="http://www.nexml.org/2009"><nex:otus></nex:nexml>', 'broken'))
      .toThrow(/NeXML 解析失败/);
  });
});
