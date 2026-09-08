import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Corpus, readCorpus, validateCorpus } from './corpus.ts';

type Mutable<T> = { -readonly [Key in keyof T]: Mutable<T[Key]> };
const corpus = readCorpus();
const clone = () => JSON.parse(JSON.stringify(corpus)) as Mutable<Corpus>;

/** A root with the manifest's real-document names present, so only the mutation is reported. */
function scratchRoot(paths: readonly string[]): string {
  const root = mkdtempSync(join(tmpdir(), 'corpus-'));
  for (const path of paths) {
    const parts = path.split('/');
    mkdirSync(join(root, ...parts.slice(0, -1)), { recursive: true });
    writeFileSync(join(root, path), path);
  }
  mkdirSync(join(root, 'fixtures/real'), { recursive: true });
  return root;
}

describe('producer corpus manifest', () => {
  it('matches the files committed to the repository', () => {
    expect(validateCorpus(corpus)).toEqual([]);
  });
  it('records provenance, references and classified deltas for every document', () => {
    expect(corpus.documents.length).toBeGreaterThan(0);
    for (const document of corpus.documents) {
      expect(document.artifacts.filter((artifact) => artifact.kind === 'document')).toHaveLength(1);
      expect(
        document.artifacts.some((artifact) => ['pdf', 'text', 'image'].includes(artifact.kind)),
      ).toBe(true);
      expect(document.producer.generator).toContain(document.producer.version);
      for (const delta of document.deltas)
        expect(['parse', 'font', 'layout', 'paint']).toContain(delta.classification);
    }
  });
  it('reports a stale hash', () => {
    const mutated = clone();
    mutated.documents[0].artifacts[1] = {
      ...mutated.documents[0].artifacts[1],
      sha256: '0'.repeat(64),
    };
    expect(validateCorpus(mutated).join('\n')).toMatch(/SHA-256 is [0-9a-f]{64}, the manifest/);
  });
  it('reports a missing file', () => {
    const mutated = clone();
    mutated.documents[0].artifacts[1] = {
      ...mutated.documents[0].artifacts[1],
      path: 'fixtures/real/not-here.rtf',
    };
    expect(validateCorpus(mutated).join('\n')).toContain('the file is missing');
  });
  it('reports an unclassified delta and an unknown classification', () => {
    const mutated = clone();
    mutated.documents[0].deltas[0] = {
      ...mutated.documents[0].deltas[0],
      classification: 'cosmetic' as never,
      measured: '  ',
    };
    const problems = validateCorpus(mutated).join('\n');
    expect(problems).toContain('classification must be one of parse, font, layout, paint');
    expect(problems).toContain('no measurement is recorded');
  });
  it('reports missing producer provenance', () => {
    const mutated = clone();
    mutated.documents[0] = {
      ...mutated.documents[0],
      producer: { ...mutated.documents[0].producer, version: '', packages: [] },
      fonts: [],
    };
    const problems = validateCorpus(mutated).join('\n');
    expect(problems).toContain('producer.version is empty');
    expect(problems).toContain('no producer packages are recorded');
    expect(problems).toContain('no fonts are recorded');
  });
  it('reports a producer document that nobody described', () => {
    const listed = corpus.documents.flatMap((document) =>
      document.artifacts.map((artifact) => artifact.path),
    );
    const root = scratchRoot(listed);
    writeFileSync(join(root, 'fixtures/real/undocumented.rtf'), '{\\rtf1}');
    const problems = validateCorpus(corpus, root).join('\n');
    expect(problems).toContain('fixtures/real/undocumented.rtf: this producer document is not in');
  });
});
