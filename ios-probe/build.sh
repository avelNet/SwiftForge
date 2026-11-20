#!/usr/bin/env bash
set -euo pipefail

cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
build=$PWD/.build
app=$build/Payload/SwiftForgeProbe.app
mkdir -p "$app" dist
rm -f dist/SwiftForgeProbe.ipa

"${SWIFTC:-swiftc}" -target arm64-apple-ios18.0 -wmo -Osize \
    -enable-experimental-feature Embedded -no-allocations -Xfrontend -disable-stack-protector \
    -parse-as-library -emit-object Probe.swift -o "$build/Probe.o"
"${CLANG:-clang}" -target arm64-apple-ios18.0 -fobjc-arc -Wall -Wextra -Werror \
    -c main.m -o "$build/main.o"
"${LD64:-ld64.lld}" -arch arm64 -platform_version ios 18.0 18.0 -no_adhoc_codesign \
    -o "$app/SwiftForgeProbe" "$build/main.o" "$build/Probe.o" \
    -L "$PWD/stubs" -lSystem -lobjc "$PWD/stubs/UIKit.tbd" "$PWD/stubs/Foundation.tbd"

python3 - "$app" <<'PY'
import pathlib
import plistlib
import sys
import zipfile

app = pathlib.Path(sys.argv[1])
info = {
    "CFBundleDevelopmentRegion": "en",
    "CFBundleDisplayName": "SwiftForge Probe",
    "CFBundleExecutable": "SwiftForgeProbe",
    "CFBundleIdentifier": "dev.swiftforge.iosprobe",
    "CFBundleInfoDictionaryVersion": "6.0",
    "CFBundleName": "SwiftForgeProbe",
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
with zipfile.ZipFile("dist/SwiftForgeProbe.ipa", "w", zipfile.ZIP_DEFLATED) as ipa:
    for name in ("Info.plist", info["CFBundleExecutable"]):
        ipa.write(app / name, f"Payload/{app.name}/{name}")
print("dist/SwiftForgeProbe.ipa (unsigned)")
PY
