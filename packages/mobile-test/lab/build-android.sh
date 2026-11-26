#!/usr/bin/env bash
set -euo pipefail
: "${ANDROID_HOME:?Set ANDROID_HOME to the Android SDK with platform and build tools 35.0.0}"
: "${JAVA_HOME:?Set JAVA_HOME to JDK 21}"
out="$(mkdir -p "${1:?Pass an output directory}" && cd "$1" && pwd)"
source_dir="$(cd "$(dirname "$0")/android" && pwd)"
tools="$ANDROID_HOME/build-tools/35.0.0"
platform="$ANDROID_HOME/platforms/android-35/android.jar"
work="$(mktemp -d)"
trap 'rm -rf -- "$work"' EXIT
cd "$work"
maven=https://repo.maven.apache.org/maven2
for module in clientlib common; do
  curl -fsS "$maven/com/solanamobile/mobile-wallet-adapter-$module/2.2.1/mobile-wallet-adapter-$module-2.2.1.aar" -o "$module.aar"
done
curl -fsS "$maven/com/neovisionaries/nv-websocket-client/2.14/nv-websocket-client-2.14.jar" -o websocket.jar
cat <<'SUMS' | sha256sum --check
65244c614957a0be24b54891d702e29b87df4bfdfdb07bd598216b2f16489022  clientlib.aar
5753043b43adc0f475434dd0ead347e4b72734da0d7c6508fc5522a4d2f7b785  common.aar
eed0fb6f5ef5db17d087039f1e829cfe827363b2863265258a96f0ed323313b7  websocket.jar
SUMS
unzip -p clientlib.aar classes.jar > clientlib.jar
unzip -p common.aar classes.jar > common.jar
mkdir compiled dex
"$JAVA_HOME/bin/javac" --release 11 -classpath "$platform:clientlib.jar:common.jar:websocket.jar" -d compiled "$source_dir/MainActivity.java"
"$tools/d8" --min-api 33 --lib "$platform" --output dex compiled/app/agus/testfixture/MainActivity.class clientlib.jar common.jar websocket.jar
"$tools/aapt2" link --manifest "$source_dir/AndroidManifest.xml" -I "$platform" --min-sdk-version 33 --target-sdk-version 35 -o unsigned.apk
zip -q -j unsigned.apk dex/classes.dex
"$tools/zipalign" -f 4 unsigned.apk aligned.apk
"$JAVA_HOME/bin/keytool" -genkeypair -alias lab -keystore temporary.p12 -storepass lab-demo-only -keypass lab-demo-only \
  -dname 'CN=AGUS Disposable Lab' -keyalg RSA -keysize 2048 -validity 14 >/dev/null 2>&1
"$tools/apksigner" sign --ks temporary.p12 --ks-pass pass:lab-demo-only --out "$out/agus-mwa-lab.apk" aligned.apk
"$tools/apksigner" verify "$out/agus-mwa-lab.apk"
