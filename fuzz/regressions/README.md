# Minimized fuzz regressions

Every input that ever made the parser panic, hang, or emit unusable geometry belongs here, in
its minimized form, as a `.rtf` file. `crates/rtf-parser/tests/fuzz.rs` replays all of them in
the fast gate, so a fixed crash cannot come back unnoticed.

To add one after a fuzz run finds a crash:

```sh
cargo +nightly fuzz tmin parse fuzz/artifacts/parse/<crash-file>
cp fuzz/artifacts/parse/minimized-from-<hash> fuzz/regressions/<short-description>.rtf
```

Name the file after the defect, not the hash. The directory is intentionally empty of crashes:
no fuzz run has produced one yet, and an empty directory is an honest record of that.
