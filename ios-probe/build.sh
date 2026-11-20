#!/usr/bin/env bash
set -euo pipefail

cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
case "${1:-probe}" in
    probe)
        executable=SwiftForgeProbe
        display_name="SwiftForge Probe"
        bundle_id=dev.swiftforge.iosprobe
        swift_source=Probe.swift
        objc_source=main.m
        ;;
    interactive)
        executable=SwiftForgeCounter
        display_name="SwiftForge Counter"
        bundle_id=dev.swiftforge.counter
        swift_source=interactive/Counter.swift
        objc_source=interactive/main.m
        ;;
    *)
        printf 'Usage: %s [probe|interactive]\n' "$0" >&2
        exit 2
        ;;
esac

mkdir -p dist
rm -f "dist/$executable.ipa"
build=$(mktemp -d)
trap 'rm -rf -- "$build"' EXIT
app=$build/Payload/$executable.app
mkdir -p "$app"

"${SWIFTC:-swiftc}" -target arm64-apple-ios18.0 -wmo -Osize \
    -enable-experimental-feature Embedded -no-allocations -Xfrontend -disable-stack-protector \
    -parse-as-library -emit-object "$swift_source" -o "$build/Probe.o"
"${CLANG:-clang}" -target arm64-apple-ios18.0 -fobjc-arc -Wall -Wextra -Werror \
    -c "$objc_source" -o "$build/main.o"
"${LD64:-ld64.lld}" -arch arm64 -platform_version ios 18.0 18.0 -no_adhoc_codesign \
    -o "$app/$executable" "$build/main.o" "$build/Probe.o" \
    -L "$PWD/stubs" -lSystem -lobjc "$PWD/stubs/UIKit.tbd" "$PWD/stubs/Foundation.tbd"

python3 - "$app" "$executable" "$display_name" "$bundle_id" <<'PY'
import pathlib
import plistlib
import sys
import zipfile

app_path, executable, display_name, bundle_id = sys.argv[1:]
app = pathlib.Path(app_path)
info = {
    "CFBundleDevelopmentRegion": "en",
    "CFBundleDisplayName": display_name,
    "CFBundleExecutable": executable,
    "CFBundleIdentifier": bundle_id,
    "CFBundleInfoDictionaryVersion": "6.0",
    "CFBundleName": executable,
    "CFBundlePackageType": "APPL",
    "CFBundleShortVersionString": "1.0",
    "CFBundleSupportedPlatforms": ["iPhoneOS"],
    "CFBundleVersion": "1",
    "LSRequiresIPhoneOS": True,
    "MinimumOSVersion": "18.0",
    "UIDeviceFamily": [1],
    "UILaunchScreen": {},
}
with (app / "Info.plist").open("wb") as stream:
    plistlib.dump(info, stream)
archive = pathlib.Path("dist") / (executable + ".ipa")
with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as ipa:
    for name in ("Info.plist", info["CFBundleExecutable"]):
        ipa.write(app / name, f"Payload/{app.name}/{name}")
print(f"{archive} (unsigned)")
PY
