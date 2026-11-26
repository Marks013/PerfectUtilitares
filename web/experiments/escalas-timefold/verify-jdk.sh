#!/bin/sh
# APT verifies archive signatures and package hashes. Bind audit to actual files.
set -eu
export LC_ALL=C
fail() { printf 'JDK_VERIFY_FAILED:%s\n' "$1" >&2; exit 1; }
mode="$1"
version='21.0.13.1+2-1~24.04.1'
arch=$(dpkg --print-architecture)
case "$arch" in arm64|amd64) ;; *) exit 1 ;; esac
home="/usr/lib/jvm/java-21-openjdk-$arch"
test "$(readlink -f "$JAVA_HOME")" = "$home" || fail JAVA_HOME
test "$(readlink -f "$(command -v java)")" = "$home/bin/java" || fail JAVA_PATH
case "$mode" in
  runtime) packages='openjdk-21-jre-headless'; test ! -e "$home/bin/javac" || fail RUNTIME_COMPILER ;;
  build) packages='openjdk-21-jre-headless openjdk-21-jdk-headless'; test -x "$home/bin/javac" || fail BUILD_COMPILER ;;
  *) exit 1 ;;
esac
installed=$(dpkg-query -W -f='${Status}\t${Package}\n' 'openjdk-*' | awk '$1=="install" && $2=="ok" && $3=="installed" {print $4}' | sort)
expected=$(printf '%s\n' $packages | sort)
test "$installed" = "$expected" || fail PACKAGE_SET
for pkg in $packages; do
  actual=$(dpkg-query -W -f='${Version}' "$pkg")
  test "$actual" = "$version" || fail PACKAGE_VERSION
  test "$(dpkg-query -W -f='${Architecture}' "$pkg")" = "$arch" || fail PACKAGE_ARCH
  test "$(dpkg-query -W -f='${source:Package}' "$pkg")" = openjdk-21 || fail PACKAGE_SOURCE
  test "$(dpkg-query -W -f='${Status}' "$pkg")" = 'install ok installed' || fail PACKAGE_STATUS
  verification=$(dpkg --verify "$pkg") || fail DPKG_VERIFY_COMMAND
  if [ -n "$verification" ]; then
    # Only paths of the installed public distribution packages, never payload.
    printf '%s\n' "$verification" >&2
    fail DPKG_FILE_INTEGRITY
  fi
  printf 'PACKAGE\t%s\t%s\t%s\topenjdk-21\tinstall ok installed\n' "$pkg" "$actual" "$arch"
done
file_evidence() {
  kind="$1"; file="$2"; pkg="$3"
  test -f "$file" || fail FILE_MISSING
  test "$(readlink -f "$file")" = "$file" || fail FILE_SYMLINK
  owner=$(dpkg-query -S "$file")
  test "$owner" = "$pkg:$arch: $file" || test "$owner" = "$pkg: $file" || fail FILE_OWNER
  digest=$(sha256sum "$file" | cut -d' ' -f1)
  printf 'FILE\t%s\t%s\t%s\t%s\n' "$kind" "$file" "$pkg" "$digest"
}
file_evidence java "$home/bin/java" openjdk-21-jre-headless
file_evidence libjvm "$home/lib/server/libjvm.so" openjdk-21-jre-headless
file_evidence modules "$home/lib/modules" openjdk-21-jre-headless
if [ "$mode" = build ]; then
  test "$(readlink -f "$(command -v javac)")" = "$home/bin/javac"
  file_evidence javac "$home/bin/javac" openjdk-21-jdk-headless
fi
printf 'VERIFIED\t%s\t%s\n' "$mode" "$arch"
