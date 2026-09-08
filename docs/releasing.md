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

The version's `CHANGELOG.md` section supplies the release notes. The initial GitHub archive is also the installation fallback while the npm package is unavailable.

To rerun an existing tag without requesting npm publication, open **Actions → Release → Run workflow**, enter the exact tag, leave `publish_npm` false, and dispatch it. A rerun may recreate a missing GitHub Release from the same verified archive, but it must not replace artifacts for an already published release with different bytes.

## npm trusted publishing

npm publication is disabled until the package and trusted publisher are configured. The release workflow may enter its npm job only when repository variable `NPM_TRUSTED_PUBLISHING` is `true` or a maintainer explicitly dispatches an existing tag with `publish_npm` set to `true`. Leave both paths disabled during initial GitHub-only releases.

The first `rtf-viewer` package must be bootstrapped by an npm owner with login and two-factor authentication. Use the already verified GitHub Release archive for that one-time creation, verify it with `SHA256SUMS`, and do not rebuild it locally:

```sh
npm install --global npm@11.6.2 --ignore-scripts
sha256sum --check SHA256SUMS
npm login --registry=https://registry.npmjs.org/
npm publish ./rtf-viewer-1.0.0.tgz --access public --tag latest --ignore-scripts
```

Complete the account's second-factor prompt when npm requests it. No npm automation token is needed in the repository or GitHub Actions secrets.

After the npm package exists:

1. Configure npm trusted publishing for `rwv/rtf-viewer` and workflow file `release.yml`. Leave the environment field empty because this workflow does not declare one. Explicitly allow direct `npm publish` for this publisher; new configurations otherwise allow staged publishing only.
2. Confirm the npm package requires two-factor authentication or trusted publishing for releases.
3. Set the repository variable `NPM_TRUSTED_PUBLISHING` to `true` only after the OIDC relationship is active.
4. Use the next unpublished version tag for the first OIDC publication. A manual `publish_npm: true` dispatch is only appropriate for a tag whose version is not already present on npm. A rerun of a version that was bootstrapped directly must verify the matching registry archive and skip publication rather than trying to replace it.

The npm publish job remains a separate GitHub-hosted job with repository contents read access and `id-token: write`. It uses Node 24 and npm 11.6.2, downloads the archive produced by the verification job, verifies its SHA-256 digest, and publishes that same file. OIDC publication of a public package from a public repository automatically receives provenance. The one-time local bootstrap does not receive that automatic CI provenance. See [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) and [npm publishing requirements](https://docs.npmjs.com/creating-and-publishing-unscoped-public-packages/).

## Post-release checks

After the workflow completes:

1. Confirm the GitHub Release tag, notes, archive, checksum file, and verification report.
2. Download the archive, verify `SHA256SUMS`, install it in a fresh browser application, and confirm its Worker and WASM requests succeed.
3. If npm publication was requested, confirm the exact version is visible on the registry and that its archive digest matches the release artifact before changing the README's npm-availability wording.
4. Record any remote-only failure as a release blocker. Local results in [verification](verification.md) remain local evidence until the corresponding GitHub Actions run passes.
