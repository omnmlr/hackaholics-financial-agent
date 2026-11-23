#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 2 ]]; then
  printf 'Usage: %s <subscriptions-checkout> <platform-tools-directory>\n' "$0" >&2
  exit 2
fi

experiment_dir="$(cd "$(dirname "$0")" && pwd -P)"
subscriptions_dir="$(cd "$1" && pwd -P)"
toolchain_dir="$(cd "$2" && pwd -P)"
expected_commit=364a41976c33347d092902443bbec2def9227e75
artifact_dir="$experiment_dir/.artifacts"
target_dir="$artifact_dir/target"
binary="$artifact_dir/subscriptions_program.so"

if [[ "$(git -C "$subscriptions_dir" rev-parse HEAD)" != "$expected_commit" ]] ||
   [[ -n "$(git -C "$subscriptions_dir" status --porcelain --untracked-files=all)" ]]; then
  printf 'A clean Subscriptions checkout at %s is required.\n' "$expected_commit" >&2
  exit 1
fi

rustc_version="$("$toolchain_dir/rust/bin/rustc" --version)"
if [[ "$rustc_version" != 'rustc 1.95.0-dev (1e20dd0d5 '* ]]; then
  printf 'Use verified Anza platform-tools v1.58 (Rust 1.95.0). Found %s.\n' "$rustc_version" >&2
  exit 1
fi

mkdir -p "$artifact_dir"
# Use the same direct SBF compiler target as the repository's escrow build.
# A task-local Cargo cache leaves the user's global toolchain untouched.
(
  cd "$subscriptions_dir"
  env -u AI_API_KEY -u NETLIFY_AUTH_TOKEN \
    RUSTC="$toolchain_dir/rust/bin/rustc" \
    CC="$toolchain_dir/llvm/bin/clang" \
    AR="$toolchain_dir/llvm/bin/llvm-ar" \
    CARGO_HOME="$artifact_dir/cargo" \
    CARGO_TARGET_DIR="$target_dir" \
    RUSTFLAGS="-Zremap-cwd-prefix=" \
    "$toolchain_dir/rust/bin/cargo" build --manifest-path program/Cargo.toml \
      --target sbpf-solana-solana --release --locked --jobs 2
)
"$toolchain_dir/llvm/bin/llvm-objcopy" --strip-all \
  "$target_dir/sbpf-solana-solana/release/subscriptions_program.so" "$binary"

printf '%s\n' "$rustc_version"
(cd "$artifact_dir" && sha256sum subscriptions_program.so > subscriptions_program.sha256 && cat subscriptions_program.sha256)
