# Engineering constraints

- Use English in code, documentation, samples, commits and user-facing UI.
- Keep this a standalone read-only RTF project. Do not add application-specific integrations or a multi-format platform.
- Research the relevant RTF 1.9.1 rule and record page references before changing parser behavior. Separate normative behavior from application compatibility observations.
- Parse raw bytes. Preserve group scope, destination behavior, binary boundaries, font codepages and Unicode fallback counts. No whole-file UTF-8 decoding or regex parser.
- Rust owns semantic defaults, scope inheritance and explicit resets. Generate TypeScript model declarations from Rust; verify generated declarations in CI. Never maintain duplicate handwritten wire types.
- TypeScript layout uses points. PPI, DPR and zoom belong only to paint. Paint consumes retained positions and sizes and must not measure text, break lines or paginate.
- Semantic models and layout results must remain structured-cloneable values without DOM nodes, Canvas contexts, WASM pointers or image resources.
- Share exactly the same font configuration between measurement and paint. Font changes must invalidate layout explicitly.
- Core must remain framework-free and must not automatically fetch third-party fonts, images, OLE data or conversion services. Never execute objects or fields.
- Define ownership for every Worker, bitmap, font and canvas. Destroy is idempotent. Late asynchronous results must be disposed. Abort must terminate synchronous parsing work through Worker termination.
- Enforce input, nesting, token, text, image and page/output-pixel bounds. Malformed input must fail predictably without panic or unbounded allocation.
- Diagnose unsupported content with machine-readable codes and context. Do not silently downgrade content and advertise full support.
- Keep package boundaries proportional to actual responsibilities. Initially use one Rust parser crate, one browser library and one independent example.
- Verify native Rust, pure layout, browser behavior, production resource loading and a packed-package consumer. Use meaningful assertions on content and geometry.
- Self-rendered snapshots catch regressions only. Fidelity claims need specification assertions or independently generated reference outputs with version/font provenance. Never blindly update snapshots.
- Update README, roadmap and support matrix when behavior changes. Label proposals clearly. Do not claim unsupported or untested behavior as verified.
- Reused code needs its license, source path, fixed upstream commit, local change record and focused tests. No uncommitted submodule patches or runtime dependency on a developer checkout.
- Keep upstream source unmodified in its pinned submodule. Put RTF policy in the local adapter; test upstream updates through the complete package/browser gate. Never install or build the upstream workspace as part of this project's build.
- Prefer standard Cargo, pnpm, npm, GitHub CLI and Release Please commands to custom orchestration. Project build/release Node code must be TypeScript and included in type checking; historical isolated experiments are not production tooling.
- Use Conventional Commit PR titles and squash merges. Release Please owns npm/workspace versions, changelog, tags and GitHub Releases; normal releases do not require manual version edits or tags. The unpublished Rust crate version is independent.

- Follow CONTRIBUTING.md for format/lint and the shared local/CI/release gate. Never format generated contracts or upstream sources. Keep browser, Worker and Node type environments separate. Focused tests must fail in CI.
