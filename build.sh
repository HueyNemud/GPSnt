#!/bin/bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Builds the GPS'nt Android app with a map embedded, locally (no cloud service).
#
#   ./build.sh [--map MAP_FOLDER] [--dev]
#
#   --map DIR   map folder (image + map.config.json, see docs/map-packs.md). Default: maps/demo
#   --dev       development build (expo-dev-client): install it once, then `npm run dev` in app/
#               and scan the QR code to load the JavaScript live. Without it: standalone release
#               build, JavaScript embedded, works without network.
#
# The APK is copied to dist/. If a phone is connected over USB (USB debugging on), it is installed.

set -euo pipefail
cd "$(dirname "$0")"

MODE=release
MAP=maps/demo
while [ $# -gt 0 ]; do
    case "$1" in
        --dev) MODE=debug ;;
        --map) MAP="${2:?--map needs a folder}"; shift ;;
        -h|--help) sed -n '3,14p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
        *) echo "Unknown option: $1 (see ./build.sh --help)" >&2; exit 1 ;;
    esac
    shift
done

echo "🚀 Building GPS'nt ($MODE) with map $MAP"

# Gradle 8.13 does not support recent JDKs (e.g. 25): use a JDK 17 when available
JAVA_MAJOR=$(java -version 2>&1 | head -1 | sed -E 's/.*version "([0-9]+).*/\1/' || true)
if [ -z "${JAVA_HOME:-}" ] || [ "${JAVA_MAJOR:-0}" -gt 21 ]; then
    for candidate in /usr/lib/jvm/java-17-openjdk-amd64 /usr/lib/jvm/openjdk-17 /usr/lib/jvm/temurin-17-jdk-amd64 "$HOME/android-studio/jbr"; do
        if [ -x "$candidate/bin/java" ]; then
            export JAVA_HOME="$candidate"
            export PATH="$JAVA_HOME/bin:$PATH"
            break
        fi
    done
fi
echo "☕ JAVA_HOME=${JAVA_HOME:-<system java>}"

# 1. Map pack (skipped when already up to date)
echo "🗺️  Map pack..."
PYTHONPATH=mapkit python3 -m gpsnt_mapkit build "$MAP" --out app/map-pack

# 2. Android app
cd app
if [ ! -d node_modules ]; then
    echo "📦 Installing dependencies..."
    npm ci
fi

echo "🔧 Generating the Android project..."
rm -rf android/.gradle android/app/build
npx expo prebuild --platform android --clean

# Expo's prebuild sometimes produces a broken Gradle wrapper: reinstall the official 8.13 one
# (the version Expo SDK 54 expects)
cd android
rm -f gradle/wrapper/gradle-wrapper.jar gradle/wrapper/gradle-wrapper.properties gradlew gradlew.bat
curl -fsSL https://raw.githubusercontent.com/gradle/gradle/v8.13.0/gradle/wrapper/gradle-wrapper.jar -o gradle/wrapper/gradle-wrapper.jar
curl -fsSL https://raw.githubusercontent.com/gradle/gradle/v8.13.0/gradlew -o gradlew
curl -fsSL https://raw.githubusercontent.com/gradle/gradle/v8.13.0/gradlew.bat -o gradlew.bat
chmod +x gradlew
cat > gradle/wrapper/gradle-wrapper.properties << 'PROPS'
distributionBase=GRADLE_USER_HOME
distributionPath=wrapper/dists
distributionUrl=https\://services.gradle.org/distributions/gradle-8.13-bin.zip
networkTimeout=10000
validateDistributionUrl=true
zipStoreBase=GRADLE_USER_HOME
zipStorePath=wrapper/dists
PROPS

echo "🔨 Building the APK (this takes a few minutes)..."
if [ "$MODE" == debug ]; then
    ./gradlew assembleDebug --no-daemon
    APK_PATH=app/build/outputs/apk/debug/app-debug.apk
else
    ./gradlew assembleRelease --no-daemon
    APK_PATH=app/build/outputs/apk/release/app-release.apk
fi
cd ../..

# 3. Stable location outside app/android (regenerated on every build)
VERSION=$(node -p "require('./app/app.json').expo.version")
MAP_ID=$(node -p "require('./app/map-pack/map.json').id")
if [ "$MODE" == debug ]; then NAME="gpsnt-dev.apk"; else NAME="gpsnt-$VERSION-$MAP_ID.apk"; fi
mkdir -p dist
cp "app/android/$APK_PATH" "dist/$NAME"
echo ""
echo "✅ dist/$NAME"

if command -v adb >/dev/null && adb devices | grep -qw "device$"; then
    echo "📲 Installing on the connected phone..."
    adb install -r "dist/$NAME" && echo "✅ Installed"
else
    echo "📲 No phone connected. Copy dist/$NAME to the phone and open it to install."
fi

if [ "$MODE" == debug ]; then
    echo ""
    echo "▶️  Then: cd app && npm run dev   (or npm run dev:tunnel), and scan the QR code with the phone."
fi
