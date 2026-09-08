# Contributing

Use the pinned Node version in `.node-version`, pnpm from `packageManager`, and Rust from `rust-toolchain.toml`. Initialize the pinned source dependency with `git submodule update --init`; do not install or build its workspace.

```sh
pnpm install --frozen-lockfile
cargo install wasm-bindgen-cli --version 0.2.128 --locked
pnpm exec playwright install --with-deps chromium firefox webkit
pnpm check
```

`pnpm check` is the complete local and release gate: formatting, syntax lint, Rust format/clippy/tests, generated contract verification, unit tests, production build, browser/tool/Worker type checking, type-aware lint, three-browser tests, and an isolated installed-package consumer. Type-aware checks run after build so package declarations exist.

For a small change, start with `pnpm format:check`, `pnpm lint`, and the affected tests. Use `pnpm format` to apply Prettier and `cargo fmt --all` for Rust. Generated contracts, Release Please's changelog, binary samples, and third-party sources are excluded from formatting. Never regenerate reference images just to make a test pass.

[Oxlint type-aware checks](https://oxc.rs/docs/guide/usage/linter/type-aware.html) support the project's TypeScript 7 toolchain. We select correctness and Promise rules, not every available style rule. Explain necessary suppressions locally. Browser library types exclude Node globals; tests and build tools have separate configurations.

CI runs a fast `quality` job before the full `verify` job. Both are required for main-branch pull requests. Focused tests fail in CI. Workflow validation also runs `go run github.com/rhysd/actionlint/cmd/actionlint@v1.7.12`; Go is available on the GitHub-hosted runner and is only needed locally when editing workflows.

Use a Conventional Commit PR title and squash merge. Keep formatting-only changes in a separate commit from semantic changes. Review the diff, generated declarations, relevant diagnostics and test evidence before merging. Repository rules require a PR and passing checks, block force pushes/deletion, and allow no bypass; a single maintainer is not required to approve their own PR.

Dependabot groups minor/patch updates and leaves major upgrades separate. Update Cargo's `wasm-bindgen` and the CLI version in the setup action and this guide together; a mismatched ABI must not be worked around. Upstream submodule updates require the source-adapter tests and the complete browser/package gate.

See [AGENTS.md](AGENTS.md) for architecture constraints, [testing](docs/testing.md) for evidence standards, and [releasing](docs/releasing.md) for publication and recovery. Real producer corpus expansion and long-running fuzz/performance campaigns are separate work from the per-PR gate.
