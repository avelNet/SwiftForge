#!/usr/bin/env bash
set -euo pipefail

cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
ipa=${1:-dist/SwiftForgeProbe.ipa}
scratch=$(mktemp -d)
trap 'rm -rf -- "$scratch"' EXIT

python3 - "$ipa" "$scratch" <<'PY'
from pathlib import Path
import plistlib
import sys
import zipfile

ipa, scratch = sys.argv[1:]
app_dir = "Payload/SwiftForgeProbe.app/"
with zipfile.ZipFile(ipa) as archive:
    if archive.testzip() is not None:
        raise SystemExit("Invalid IPA archive")
    info = plistlib.loads(archive.read(app_dir + "Info.plist"))
    expected = {
        "CFBundlePackageType": "APPL",
        "CFBundleIdentifier": "dev.swiftforge.iosprobe",
        "CFBundleExecutable": "SwiftForgeProbe",
        "CFBundleSupportedPlatforms": ["iPhoneOS"],
        "MinimumOSVersion": "18.0",
    }
    for key, value in expected.items():
        if info.get(key) != value:
            raise SystemExit(f"Unexpected Info.plist value for {key}: {info.get(key)!r}")
    executable = info["CFBundleExecutable"]
    (Path(scratch) / executable).write_bytes(archive.read(app_dir + executable))
print(f'{info["CFBundleIdentifier"]}: IPA and Info.plist OK')
PY

app=$scratch/SwiftForgeProbe
headers=$("${LLVM_OBJDUMP:-llvm-objdump}" --macho --private-headers "$app")
symbols=$("${LLVM_NM:-llvm-nm}" --defined-only "$app")
printf '%s\n' "$headers" | grep -E 'MH_MAGIC_64 +ARM64 .* EXECUTE'
printf '%s\n' "$headers" | grep -E '^ *platform ios$|^ *minos 18\.0$'
printf '%s\n' "$headers" | grep -qE '^ *platform ios$'
printf '%s\n' "$headers" | grep -qE '^ *minos 18\.0$'
printf '%s\n' "$headers" | grep -q 'LC_MAIN'
if grep -q 'LC_CODE_SIGNATURE' <<< "$headers"; then
    echo "Unexpected signature on the unsigned build" >&2
    exit 1
fi
printf '%s\n' "$symbols" | grep -E ' T _swiftforge_probe_value$'
sha256sum "$ipa"
