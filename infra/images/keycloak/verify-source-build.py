#!/usr/bin/env python3
"""Fail closed on dependency misalignment; retain source/build provenance."""
import hashlib
import json
import pathlib
import sys
import xml.etree.ElementTree as ET

NETTY = "4.1.137.Final"
BC = "1.85"
NS = {"m": "http://maven.apache.org/POM/4.0.0"}
BOMS = {
    "io/netty/netty-bom/4.1.137.Final/netty-bom-4.1.137.Final.pom":
        "50db8f9559f674a5d9c66f27f3154145928b570c45b4ca119338d33cf0f4ed04",
    "org/bouncycastle/bc-jdk18on-bom/1.85/bc-jdk18on-bom-1.85.pom":
        "d9628899e9fcb11a0751e7f2f0d42785ab729d1bb69831b9c63c3b1d05c3357b",
}


def sha(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def require(condition, message):
    if not condition:
        raise SystemExit(message)


def check_effective(path):
    root = ET.parse(path).getroot()
    checked = {}
    for dep in root.findall("m:dependencyManagement/m:dependencies/m:dependency", NS):
        group = dep.findtext("m:groupId", namespaces=NS)
        artifact = dep.findtext("m:artifactId", namespaces=NS)
        version = dep.findtext("m:version", namespaces=NS)
        if group == "io.netty" and not artifact.startswith("netty-tcnative"):
            require(version == NETTY, f"Unaligned Netty artifact: {artifact}:{version}")
            checked[artifact] = version
        if group == "org.bouncycastle" and artifact.endswith("-jdk18on"):
            require(version == BC, f"Unaligned BC artifact: {artifact}:{version}")
            checked[artifact] = version
    for artifact in ("netty-handler", "netty-codec-http2", "bcprov-jdk18on", "bcpkix-jdk18on", "bcutil-jdk18on"):
        require(artifact in checked, f"Missing managed artifact: {artifact}")
    return checked


def main():
    mode, source_arg, output_arg = sys.argv[1:]
    source, output = pathlib.Path(source_arg), pathlib.Path(output_arg)
    managed = check_effective(output / "effective-pom.xml")
    for relative, expected in BOMS.items():
        actual = sha(pathlib.Path.home() / ".m2/repository" / relative)
        require(actual == expected, f"Unexpected upstream BOM checksum: {relative}")
    if mode == "effective":
        print(f"Verified {len(managed)} aligned managed artifacts and both BOM checksums")
        return
    require(mode == "distribution", "Unknown verification mode")
    distribution = output / "keycloak"
    jars = sorted((distribution / "lib").rglob("*.jar"))
    require(bool(jars), "Missing built distribution libraries")
    libraries = []
    for jar in jars:
        name = jar.name
        if name.startswith("io.netty.") and "netty-tcnative" not in name:
            require(f"-{NETTY}" in name, f"Unexpected runtime Netty artifact: {name}")
        if name.startswith("org.bouncycastle.") and "-jdk18on-" in name:
            require(name.endswith(f"-{BC}.jar"), f"Unexpected runtime BC artifact: {name}")
        libraries.append({"path": str(jar.relative_to(distribution)), "sha256": sha(jar)})
    for artifact, version in (("netty-handler", NETTY), ("bcprov-jdk18on", BC), ("bcpkix-jdk18on", BC), ("bcutil-jdk18on", BC)):
        require(any(p.name.endswith(f".{artifact}-{version}.jar") for p in jars), f"Missing runtime dependency: {artifact}")
    reports = sorted(source.glob("**/target/surefire-reports/TEST-*.xml"))
    tests = failures = errors = skipped = 0
    for report in reports:
        suite = ET.parse(report).getroot()
        tests += int(suite.get("tests", 0))
        failures += int(suite.get("failures", 0))
        errors += int(suite.get("errors", 0))
        skipped += int(suite.get("skipped", 0))
    require(tests > skipped and failures == errors == 0, "No successful upstream unit test evidence")
    archives = list((source / "quarkus/dist/target").glob("keycloak-*.tar.gz"))
    require(len(archives) == 1, "Expected one distribution archive")
    manifest = {
        "distribution": "ClinicOS security rebuild of Keycloak 26.7.4; not an official upstream binary",
        "sourceRevision": "aa9fe3fba0c6cd5770f19a49378c55f4378cf544",
        "sourceArchiveSha256": "07b284252100d825df27fb2145bc26c9c7430726502218e0c5cfbf3bebe94c1b",
        "patchSha256": sha(pathlib.Path("/build/security-boms.patch")),
        "distributionSha256": sha(archives[0]),
        "bomChecksums": BOMS,
        "managedDependencies": managed,
        "unitTests": {"tests": tests, "failures": failures, "errors": errors, "skipped": skipped},
        "libraries": libraries,
    }
    (output / "source-build.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"Verified source distribution: {len(jars)} libraries; {tests} upstream unit tests ({skipped} skipped)")


if __name__ == "__main__":
    main()
