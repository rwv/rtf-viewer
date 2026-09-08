# Release procedure

Releases are built from a versioned commit on `main`. The package archive is produced once, tested as the exact file that consumers receive, and then passed unchanged to the GitHub Release and optional npm jobs. Do not build separate archives for verification and publication.

## Release contract

- The package version in `packages/rtf-viewer/package.json` is the source of truth. Its Git tag is `v` followed by the exact version, for example `v1.0.0`.
- `CHANGELOG.md` contains a dated section for that version. Release notes come from that section and must describe supported behavior and known boundaries without claiming complete RTF fidelity.
- A release tag must identify a commit contained in `main`. Published tags and archives are immutable; fix a release with a new version rather than moving a tag or replacing its assets.
- `ci.yml` runs the full repository verification for pull requests and pushes to `main`.
- `release.yml` runs for pushed `v*` tags and can also be dispatched manually for an existing version tag. Manual inputs are `tag` and `publish_npm`; npm publication defaults to `false`.

## Prepare and tag

1. Choose the version using semantic versioning. Review the public entry points and the versioning contract in the [README](https://github.com/rwv/rtf-viewer#public-api-and-versioning), along with the current [support matrix](support-matrix.md).
2. Update the package version, lockfile metadata if affected, `CHANGELOG.md`, and any support, roadmap, compatibility, or verification text changed by the release. Do not turn planned features into support claims.
3. Run the local gates:

   ```sh
   cargo fmt --all -- --check
   cargo clippy --locked --workspace --all-targets -- -D warnings
   pnpm check
   ```

4. Open and merge the release change through the normal pull-request path. Wait for `ci.yml` to pass on the pull request and on the resulting `main` commit.
5. Create the version tag on that verified `main` commit and push it:

   ```sh
   git switch main
   git pull --ff-only
   git tag -a v1.0.0 -m "rtf-viewer v1.0.0"
   git push origin v1.0.0
   ```

Replace `v1.0.0` with the prepared version. Confirm the tag target before pushing; do not reuse an existing release tag.

For the first repository upload, push the locally verified `main` branch to the new repository, wait for its first Verify run to pass, and then tag that commit. Later changes use the pull-request path above.

## What the release workflow verifies

The release workflow validates that the requested tag:

- has the `v<semver>` form;
- matches the package version exactly;
- points to a commit contained in `main`; and
- has a matching changelog section.

Its verification job installs the pinned Node, pnpm, Rust, wasm-bindgen, and Chromium toolchain, runs the full repository checks, builds the package, packs it once, and runs the isolated consumer checks against that exact archive. The GitHub Release job receives the verified artifacts and publishes:

- `rtf-viewer-<version>.tgz`;
- `SHA256SUMS` containing the archive digest; and
- `package-manifest.json` and `package-verification.json`.

The version's `CHANGELOG.md` section supplies the release notes. The GitHub archive remains a registry-independent installation fallback.

To rerun an existing tag without requesting npm publication, open **Actions → Release → Run workflow**, enter the exact tag, leave `publish_npm` false, and dispatch it. A rerun may recreate a missing GitHub Release from the same verified archive, but it must not replace artifacts for an already published release with different bytes.

## npm trusted publishing

`rtf-viewer@1.0.0` was created once by npm owner `seedgou` with login and two-factor authentication. The owner published the exact GitHub Release archive whose SHA-256 is `902acb83768fbe3b8aeec845cd0d0cec2bebdc49fa69748b502a4fcc6a55b7d0`; the tag and release assets remain immutable. This bootstrap used no repository or GitHub Actions token and did not receive automatic CI provenance.

All later versions publish through GitHub Actions OIDC. The trusted publisher and GitHub configuration are:

- npm package: `rtf-viewer`;
- GitHub owner/repository: `rwv/rtf-viewer`;
- workflow: `release.yml`;
- GitHub Environment: `npm`;
- environment deployment refs: branch `main` for manual dispatch and tags matching `v*`;
- environment reviewers: none;
- npm direct publishing: allowed;
- repository variable: `NPM_TRUSTED_PUBLISHING=true`.

The `npm trust` configuration command requires npm 11.15 or newer. Maintainers use npm 11.19.1 for publisher configuration without replacing the globally installed CLI:

```sh
npm exec --yes --package=npm@11.19.1 -- npm trust github rtf-viewer \
  --repo rwv/rtf-viewer \
  --file release.yml \
  --env npm \
  --allow-publish \
  --yes \
  --browser=false \
  --registry=https://registry.npmjs.org/
```

The release job can continue using its pinned npm 11.6.2 because it satisfies npm's OIDC publishing minimum.

The npm publish job is a separate GitHub-hosted job assigned to environment `npm`, with repository contents read access and `id-token: write`. It downloads the archive produced by the verification job, verifies its SHA-256 digest and consumer-test report, checks whether that exact version already exists, and publishes the same file. An existing version with the same registry integrity is a successful no-op; conflicting bytes fail the workflow. OIDC publication of a public package from a public repository automatically receives provenance. No npm authentication token belongs in the repository, GitHub environment, repository secrets, workflow logs, or release artifacts. See [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) and [npm publishing requirements](https://docs.npmjs.com/creating-and-publishing-unscoped-public-packages/).

For normal releases, the `NPM_TRUSTED_PUBLISHING` variable lets a pushed `v*` tag proceed automatically after GitHub Release creation. Manual dispatch from `main` still requires an existing version tag and may request publication with `publish_npm: true`; the environment's deployment policy admits only the configured branch and tag patterns.

## Post-release checks

After the workflow completes:

1. Confirm the GitHub Release tag, notes, archive, checksum file, and verification report.
2. Download the archive, verify `SHA256SUMS`, install it in a fresh browser application, and confirm its Worker and WASM requests succeed.
3. If npm publication was requested, confirm the exact version is visible on the registry, has provenance for an OIDC release, and matches the GitHub Release archive before updating the verification record.
4. Record any remote-only failure as a release blocker. Local results in [verification](verification.md) remain local evidence until the corresponding GitHub Actions run passes.
