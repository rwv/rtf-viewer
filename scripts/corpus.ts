/**
 * Producer corpus manifest: every real RTF document checked into the repository, how it was
 * produced, which independent references accompany it, and which differences from those
 * references are currently known.
 *
 * Run `node scripts/corpus.ts` to validate the committed manifest against the files on disk.
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

/** What a delta must be fixed in. A font substitution is not a layout bug. */
export type DeltaClassification = 'parse' | 'font' | 'layout' | 'paint';
export type ArtifactKind = 'source' | 'document' | 'pdf' | 'text' | 'image';

export interface CorpusArtifact {
  readonly path: string;
  readonly kind: ArtifactKind;
  readonly sha256: string;
  /** The tool that produced this file, with its version. */
  readonly producedBy: string;
}
export interface CorpusFont {
  readonly family: string;
  readonly package: string;
  readonly path: string;
  readonly sha256: string;
}
export interface CorpusDelta {
  readonly id: string;
  readonly classification: DeltaClassification;
  readonly summary: string;
  /** The measurement that establishes the delta, with units. */
  readonly measured: string;
  readonly status: 'open' | 'accepted';
  readonly issue?: number;
}
export interface CorpusDocument {
  readonly id: string;
  readonly producer: {
    readonly application: string;
    readonly version: string;
    /** The \generator string the document itself carries. */
    readonly generator: string;
    readonly platform: string;
    readonly packages: readonly string[];
  };
  readonly features: readonly string[];
  readonly artifacts: readonly CorpusArtifact[];
  readonly fonts: readonly CorpusFont[];
  readonly commands: readonly string[];
  readonly deltas: readonly CorpusDelta[];
}
export interface Corpus {
  readonly documents: readonly CorpusDocument[];
}

const CLASSIFICATIONS: readonly string[] = ['parse', 'font', 'layout', 'paint'];
const KINDS: readonly string[] = ['source', 'document', 'pdf', 'text', 'image'];
const REFERENCE_KINDS: readonly string[] = ['pdf', 'text', 'image'];
const ID = /^[a-z0-9]+(-[a-z0-9.]+)*$/;
const SHA256 = /^[0-9a-f]{64}$/;

export const MANIFEST_PATH = 'fixtures/corpus.json';
export const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));

export function readCorpus(root: string = repositoryRoot): Corpus {
  return JSON.parse(readFileSync(join(root, MANIFEST_PATH), 'utf8')) as Corpus;
}

function digest(root: string, path: string): string {
  return createHash('sha256')
    .update(readFileSync(join(root, path)))
    .digest('hex');
}

/** Returns one message per problem; an empty array means the manifest matches the repository. */
export function validateCorpus(corpus: Corpus, root: string = repositoryRoot): string[] {
  const problems: string[] = [];
  const complain = (where: string, message: string) => problems.push(`${where}: ${message}`);
  if (!Array.isArray(corpus.documents) || corpus.documents.length === 0) {
    complain(MANIFEST_PATH, 'no documents are listed');
    return problems;
  }
  const seenDocuments = new Set<string>();
  const listedDocumentPaths = new Set<string>();
  for (const document of corpus.documents) {
    const where = `document ${document.id || '(missing id)'}`;
    if (!ID.test(document.id ?? '')) complain(where, 'the id is missing or not lower-case kebab');
    if (seenDocuments.has(document.id)) complain(where, 'the id is used twice');
    seenDocuments.add(document.id);
    for (const [field, value] of Object.entries(document.producer ?? {})) {
      if (field === 'packages') continue;
      if (typeof value !== 'string' || value.trim() === '')
        complain(where, `producer.${field} is empty`);
    }
    for (const field of ['application', 'version', 'generator', 'platform'] as const)
      if (!(field in (document.producer ?? {}))) complain(where, `producer.${field} is missing`);
    if (!document.producer?.packages?.length) complain(where, 'no producer packages are recorded');
    if (!document.features?.length) complain(where, 'no exercised features are recorded');
    if (!document.commands?.length) complain(where, 'no generation commands are recorded');
    if (!document.fonts?.length) complain(where, 'no fonts are recorded');
    const fonts: readonly CorpusFont[] = document.fonts ?? [];
    for (const font of fonts) {
      if (!font.family || !font.package || !font.path)
        complain(where, `font ${font.family || '(unnamed)'} is missing provenance`);
      if (!SHA256.test(font.sha256 ?? ''))
        complain(where, `font ${font.family || '(unnamed)'} has no SHA-256`);
    }

    const artifacts: readonly CorpusArtifact[] = document.artifacts ?? [];
    const kinds = artifacts.map((artifact) => artifact.kind);
    if (kinds.filter((kind) => kind === 'document').length !== 1)
      complain(where, 'exactly one artifact must be the RTF document itself');
    if (!kinds.some((kind) => REFERENCE_KINDS.includes(kind)))
      complain(where, 'no independent reference artifact is recorded');
    for (const artifact of artifacts) {
      const at = `${where} artifact ${artifact.path || '(missing path)'}`;
      if (!KINDS.includes(artifact.kind)) complain(at, `unknown kind ${String(artifact.kind)}`);
      if (!artifact.producedBy?.trim()) complain(at, 'producedBy is empty');
      if (!artifact.path?.startsWith('fixtures/')) {
        complain(at, 'the path must be inside fixtures/');
        continue;
      }
      if (artifact.kind === 'document') listedDocumentPaths.add(artifact.path);
      let actual: string;
      try {
        actual = digest(root, artifact.path);
      } catch {
        complain(at, 'the file is missing');
        continue;
      }
      if (actual !== artifact.sha256)
        complain(at, `SHA-256 is ${actual}, the manifest records ${artifact.sha256}`);
    }

    const seenDeltas = new Set<string>();
    const deltas: readonly CorpusDelta[] = document.deltas ?? [];
    for (const delta of deltas) {
      const at = `${where} delta ${delta.id || '(missing id)'}`;
      if (!ID.test(delta.id ?? '')) complain(at, 'the id is missing or not lower-case kebab');
      if (seenDeltas.has(delta.id)) complain(at, 'the id is used twice');
      seenDeltas.add(delta.id);
      if (!CLASSIFICATIONS.includes(delta.classification))
        complain(
          at,
          `classification must be one of ${CLASSIFICATIONS.join(', ')}, not ${String(delta.classification)}`,
        );
      if (!delta.summary?.trim()) complain(at, 'the summary is empty');
      if (!delta.measured?.trim()) complain(at, 'no measurement is recorded');
      if (delta.status !== 'open' && delta.status !== 'accepted')
        complain(at, `status must be open or accepted, not ${String(delta.status)}`);
    }
  }

  // A producer document without provenance is worse than no document at all.
  for (const name of readdirSync(join(root, 'fixtures/real')).filter((entry) =>
    entry.endsWith('.rtf'),
  )) {
    const path = posix.join('fixtures/real', name);
    if (!listedDocumentPaths.has(path))
      complain(path, 'this producer document is not in the manifest');
  }
  return problems;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const problems = validateCorpus(readCorpus());
  if (problems.length > 0) {
    for (const problem of problems) console.error(problem);
    process.exitCode = 1;
  } else {
    console.log(`${readCorpus().documents.length} corpus documents match the repository.`);
  }
}
