#!/usr/bin/env bash
# Build the Windows x64 installer (NSIS) and the portable zip.
#
#   scripts/package-windows.sh            # on Windows (Git Bash) or any host that can build natively
#   TILT_WIN_CROSS=1 scripts/package-windows.sh   # on Linux/macOS: cross-compile with cargo-xwin
#
# Needs: node 22, rust (+ target x86_64-pc-windows-msvc for cross builds), python3, curl, 7z,
#        makensis (cross builds only; apt install nsis), cargo-xwin (cross builds only).
# Output: dist-windows/ (installer, portable zip, SHA256SUMS, manifest). Nothing is signed: see the notes printed
# at the end. No ROM, Workbench or other proprietary media is ever included; the build fails if any is found.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ver="${AMIBERRY_VERSION:-8.4.0}"
cache="${TILT_CACHE:-$root/target/win-package-cache}"
out="${OUT:-$root/dist-windows}"
desk="$root/apps/desktop"
res="$desk/src-tauri/resources"
target="x86_64-pc-windows-msvc"

log() { printf '\n==> %s\n' "$*"; }

# ---------------------------------------------------------------- 1. the emulator engine (checksum verified)
log "Amiberry $ver portable build (checksum verified)"
base="https://github.com/BlitterStudio/amiberry/releases/download/v${ver}"
zipname="amiberry-v${ver}-windows-x64-portable.zip"
mkdir -p "$cache"
[ -f "$cache/$zipname" ] || curl -fsSL -o "$cache/$zipname" "$base/$zipname"
curl -fsSL -o "$cache/SHA256SUMS" "$base/SHA256SUMS"
want="$(grep " $zipname\$" "$cache/SHA256SUMS" | cut -d' ' -f1)"
[ -n "$want" ] || { echo "no checksum published for $zipname" >&2; exit 1; }
got="$(sha256sum "$cache/$zipname" | cut -d' ' -f1)"
[ "$want" = "$got" ] || { echo "CHECKSUM MISMATCH for $zipname: want $want got $got" >&2; exit 1; }
echo "$zipname sha256 $got"

rm -rf "$cache/engine-src"
# keep the tracked placeholder README.txt in each resource folder; clear everything else
mkdir -p "$cache/engine-src" "$res/engine"
find "$res/engine" -mindepth 1 ! -name README.txt -delete
python3 -m zipfile -e "$cache/$zipname" "$cache/engine-src"
cp -R "$cache"/engine-src/*/. "$res/engine/"
# Settings go to per-user folders, not next to the installed program.
rm -f "$res/engine/amiberry.portable"
# Never ship ROMs, even the open-source AROS ones: users import their own.
rm -rf "$res/engine/roms"
# WHDLoad/JST and boot data belong to Amiberry's whdboot feature, which TiLT does not use; not redistributing
# third-party Amiga binaries keeps the licensing surface to Amiberry's own files.
rm -rf "$res/engine/whdboot"
cat > "$res/engine/BUNDLED.txt" <<'TXT'
Amiberry (GPL-3.0), unmodified build from the official release. TiLT starts it with a generated configuration.
Removed from the official package: roms/ (AROS ROMs), whdboot/ (WHDLoad and boot data). See ../notices/.
TXT
python3 "$root/scripts/check-no-proprietary.py" "$res/engine"

# ---------------------------------------------------------------- 2. notices and source offer
log "Notices"
mkdir -p "$res/notices"
find "$res/notices" -mindepth 1 ! -name README.txt -delete
cp "$root/LICENSE" "$res/notices/LICENSE.txt"
cp "$root/docs/amiga-studio/licensing.md" "$res/notices/THIRD_PARTY_LICENSES.md"
commit="$(git -C "$root" rev-parse HEAD 2>/dev/null || echo unknown)"
cat > "$res/notices/SOURCE_OFFER.txt" <<TXT
TiLT and the bundled Amiberry are free software under the GNU General Public License, version 3 (or later).

Corresponding source code
  TiLT      https://github.com/airostudio/TiLT   (commit ${commit})
  Amiberry  https://github.com/BlitterStudio/amiberry/tree/v${ver}   (unmodified; ${zipname}, sha256 ${got})

If those links ever stop working, write to the project and the source for the exact version you received will be
provided. Rust and JavaScript libraries compiled into TiLT carry their own licences, listed in THIRD_PARTY_LICENSES.md
(the generated per-crate notice text is not yet produced: see docs/amiga-studio/RELEASE_READINESS.md).

No Kickstart ROMs, Workbench disks, games or copy programs are included. Provide your own.
TXT

# ---------------------------------------------------------------- 3. build
log "Front end + installer"
cd "$desk"
[ -d node_modules ] || npm ci
if [ "${TILT_WIN_CROSS:-0}" = 1 ]; then
  command -v makensis >/dev/null || { echo "cross builds need makensis (apt install nsis)" >&2; exit 1; }
  cargo xwin --version >/dev/null 2>&1 || { echo "cross builds need cargo-xwin (cargo install cargo-xwin)" >&2; exit 1; }
  npx tauri build --runner cargo-xwin --target "$target" --bundles nsis
  exe="$desk/src-tauri/target/$target/release/tilt-desktop.exe"
  bundle="$desk/src-tauri/target/$target/release/bundle/nsis"
else
  npx tauri build --bundles nsis
  exe="$desk/src-tauri/target/release/tilt-desktop.exe"
  bundle="$desk/src-tauri/target/release/bundle/nsis"
fi
[ -f "$exe" ] || { echo "build did not produce $exe" >&2; exit 1; }

# ---------------------------------------------------------------- 4. collect, portable zip, verify
log "Collect"
rm -rf "$out"; mkdir -p "$out"
installer="$(ls "$bundle"/*.exe | head -1)"
cp "$installer" "$out/"
python3 "$root/scripts/make-portable-zip.py" "$exe" "$res" "$out/TiLT-portable-win64.zip"
python3 "$root/scripts/verify-windows-package.py" "$out"
echo
echo "Built:"; ls -l "$out"
cat <<'TXT'

NOT SIGNED. Windows SmartScreen will warn on first run until the installer is Authenticode-signed (or builds
reputation). The installer and the program have never been run on Windows by this build: see RELEASE_READINESS.md.
TXT
