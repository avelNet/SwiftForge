#!/usr/bin/env bash
set -euo pipefail

cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
if [[ ${1:-} == --interactive ]]; then
    shift
    executable=SwiftForgeCounter
    bundle_id=dev.swiftforge.counter
    swift_symbol=swiftforge_increment
else
    executable=SwiftForgeProbe
    bundle_id=dev.swiftforge.iosprobe
    swift_symbol=swiftforge_probe_value
fi
ipa=${1:-dist/$executable.ipa}
scratch=$(mktemp -d)
trap 'rm -rf -- "$scratch"' EXIT

python3 - "$ipa" "$scratch" "$executable" "$bundle_id" <<'PY'
from pathlib import Path
import plistlib
import sys
import zipfile

ipa, scratch, executable, bundle_id = sys.argv[1:]
app_dir = f"Payload/{executable}.app/"
with zipfile.ZipFile(ipa) as archive:
    if archive.testzip() is not None:
        raise SystemExit("Invalid IPA archive")
    info = plistlib.loads(archive.read(app_dir + "Info.plist"))
    expected = {
        "CFBundlePackageType": "APPL",
        "CFBundleIdentifier": bundle_id,
        "CFBundleExecutable": executable,
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

app=$scratch/$executable
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
printf '%s\n' "$symbols" | grep -E " T _${swift_symbol}\$"
sha256sum "$ipa"
