# Release procedure

Releases are prepared by [Release Please](https://github.com/googleapis/release-please-action) and published from GitHub Actions. Maintainers review and merge a generated release pull request; they do not edit versions, write release notes, or create tags by hand.

Release Please fits this repository's single published package: Conventional Commits already describe changes, and a release PR keeps the maintainer's choice of release timing. The earlier tag-triggered workflow automated publication but still required manual version/changelog coordination and custom release scripts. Release Please replaces that preparation logic; it does not replace the package's browser tests or npm OIDC.

## Release contract

- `release-please-config.json` defines one repository-wide Node release. `.release-please-manifest.json` records its current version.
- The root private workspace and the public `packages/rtf-viewer/package.json` move together. The Rust parser crate is an unpublished implementation detail and does not share the npm version.
- Release Please updates `CHANGELOG.md`, both npm version fields, and the manifest in its release pull request. It creates the matching `v<version>` tag and GitHub Release after that pull request is merged.
- The release workflow builds and packs once, tests the exact archive that will be published, and uses npm trusted publishing. Published tags, releases, and package versions are immutable.

Release Please derives semantic versions and changelog entries from [Conventional Commits](https://www.conventionalcommits.org/). Use `fix:` for a patch, `feat:` for a minor release, and a breaking-change marker such as `feat!:` for a major release. Documentation and maintenance commits do not cause a release by default.

## Create a release

1. Land normal changes on `main` with Conventional Commit titles. Keep the README, roadmap, support matrix, compatibility notes, and verification record consistent with the behavior being released.
2. Review the open Release Please pull request. Check its version and changelog claims, and wait for its **Verify** run to pass.
3. Merge the release pull request. The **Release** workflow creates the tag and GitHub Release, verifies the tagged source, and publishes through the `npm` environment.
4. Confirm that the GitHub Release contains `rtf-viewer.tgz`, `SHA256SUMS`, `package-manifest.json`, `package-verification.json`, and `registry-verification.json`. Confirm that the npm version has provenance and the same integrity recorded in the manifest.

The verification job checks that the tag matches the public package version, resolves to the checked-out commit, and is contained in `main`. It then runs the native Rust checks and `pnpm check`. The packed-package Playwright test installs `artifacts/rtf-viewer.tgz` into an isolated production application and writes evidence only after its assertions pass. The publish job receives that archive unchanged.

## Trusted npm publishing

The npm trusted publisher is bound to:

- package `rtf-viewer`;
- repository `rwv/rtf-viewer`;
- workflow filename `release.yml`; and
- GitHub Environment `npm`.

The publish job follows npm's [trusted publishing](https://docs.npmjs.com/trusted-publishers/) requirements: it runs on a GitHub-hosted runner with `id-token: write`, and it uses no npm token. npm automatically records provenance for this public package. Keep the workflow filename and environment name unchanged unless the trusted-publisher configuration is replaced at npm first.

The `npm` environment admits the `main` branch and `v*` tags. Normal releases run from `main`. The workflow checks the registry before publishing: an existing version with the tested integrity is a successful retry, while different bytes fail. Existing GitHub assets are also compared byte for byte and are never overwritten.

Release Please itself runs in the `release-please` GitHub Environment, which is restricted to `main`. Its `RELEASE_PLEASE_TOKEN` secret lets the generated pull request trigger the normal CI workflow. Keep that token limited to the permissions Release Please needs, rotate it according to the maintainer's credential policy, and never pass it to build or publish steps.

## Recover a partial release

Release Please creates the tag and GitHub Release before package verification and npm publication. If a later job fails for an infrastructure reason, select the existing version tag in **Actions → Release → Run workflow**, or use:

```sh
gh workflow run release.yml --ref v1.0.2
```

Replace the example tag with the partial release's tag. The dispatch ref itself selects the source; there is no separate tag input. The workflow requires the checked-out commit to equal the event's `GITHUB_SHA`, which npm uses in its provenance. Dispatching from `main` is rejected before publication. This also prevents a delayed automatic run from attributing a release to a different main-branch commit.

Rerunning the original push workflow does not resume publication because Release Please reports `release_created: false` once the GitHub Release exists. Dispatch from the release tag instead. If the tagged source itself is defective, leave the published tag and assets unchanged and release a new patch version.

`rtf-viewer@1.0.0` was bootstrapped manually. [`v1.0.1`](https://github.com/rwv/rtf-viewer/actions/runs/34192800727) was the first end-to-end GitHub Actions OIDC publication. Historical hashes and registry checks are recorded in [verification](verification.md#v101-github-actions-to-npm).

Tags created before the Release Please migration use their original workflow and archive naming. Use the corresponding historical Actions run for those tags; the new manual recovery path applies to releases created with this workflow.

## Postpublication verification

After publication, `verify-registry` downloads the exact npm version, compares its SHA-512 integrity with the tested archive, installs it into the same isolated production consumer, and runs `npm audit signatures` to verify registry signatures and provenance. It checks declarations, production Worker/WASM URLs, page geometry and bitmap output in Chromium. This job has no OIDC publishing permission and needs neither Rust nor the upstream submodule.

Only successful verification writes `registry-verification.json`. The release retains the first successful report; later retries must match its package identity, integrity and test outcome, while each Actions run retains its own evidence. No published archive is replaced. Registry propagation or signature-service failures fail the job visibly; rerun a failed registry job after transient failures instead of republishing or changing integrity expectations.

To run the same check locally for a version matching the checkout's package version:

```sh
export RTF_REGISTRY_VERSION=1.0.3
export RTF_REGISTRY_INTEGRITY='<sha512 integrity from the release package-manifest.json>'
pnpm test:package
```

Normal `pnpm test:package` without these variables packs the local build. Consumer install/build commands are asynchronous and each has a 60-second hard timeout. Test setup never requests npm login and never executes package install scripts.
