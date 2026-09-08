# Upstream package reuse probe

This source-only experiment exercises two supported browser APIs:
`DocxDocument` from `@silurus/ooxml/docx` and `WMFJS.Renderer` from `rtf.js`.
It intentionally contains no third-party sample documents or generated output.

Run `pnpm install`, `pnpm build`, and `pnpm preview` in this directory, then
select local DOCX and WMF files. The exact measured run and its result are in
`docs/reuse-evaluation.md`.

The handwritten `rtf-js.d.ts` records only the API used by this probe. The npm
package ships declarations, but its directory-valued `types` entry and
extensionless declaration imports are not reliably resolved by current strict
bundler-mode TypeScript configurations.
