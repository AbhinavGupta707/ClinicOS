"""Offline negative tests for the source build's dependency gate."""
import importlib.util
import pathlib
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("source_build", pathlib.Path(__file__).with_name("verify-source-build.py"))
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)


class DependencyGateTests(unittest.TestCase):
    def test_reactor_keeps_shared_openapi_properties_serial_and_tests_enabled(self):
        dockerfile = pathlib.Path(__file__).with_name("Dockerfile").read_text()
        reactor = next(line for line in dockerfile.splitlines()
                       if line.startswith("RUN mvn") and "-DskipTestsuite" in line)
        self.assertIn(" -T1 ", reactor)
        self.assertNotIn("-DskipTests ", reactor)
        self.assertNotIn("-Dmaven.test.skip", reactor)

    def check(self, netty="4.1.137.Final", bc="1.85", freemarker="2.3.35", omit=None):
        entries = [("io.netty", "netty-handler", netty),
                   ("io.netty", "netty-codec-http2", netty),
                   ("io.netty", "netty-tcnative-classes", "2.0.78.Final"),
                   ("org.freemarker", "freemarker", freemarker),
                   *[("org.bouncycastle", artifact, bc) for artifact in
                     ("bcprov-jdk18on", "bcpkix-jdk18on", "bcutil-jdk18on")]]
        body = "".join(f"<dependency><groupId>{g}</groupId><artifactId>{a}</artifactId><version>{v}</version></dependency>"
                       for g, a, v in entries if a != omit)
        with tempfile.TemporaryDirectory() as directory:
            path = pathlib.Path(directory) / "pom.xml"
            path.write_text(f'<project xmlns="http://maven.apache.org/POM/4.0.0"><dependencyManagement><dependencies>{body}</dependencies></dependencyManagement></project>')
            return gate.check_effective(path)

    def test_aligned_families_allow_separate_tcnative_release_line(self):
        self.assertEqual(len(self.check()), 6)

    def test_stale_netty_rejected(self):
        with self.assertRaisesRegex(SystemExit, "Unaligned Netty"):
            self.check(netty="4.1.136.Final")

    def test_stale_bc_companions_rejected(self):
        with self.assertRaisesRegex(SystemExit, "Unaligned BC"):
            self.check(bc="1.84")

    def test_missing_companion_rejected(self):
        with self.assertRaisesRegex(SystemExit, "Missing managed artifact: bcutil"):
            self.check(omit="bcutil-jdk18on")

    def test_stale_freemarker_rejected(self):
        with self.assertRaisesRegex(SystemExit, "Unexpected FreeMarker version"):
            self.check(freemarker="2.3.32")

    def test_missing_freemarker_rejected(self):
        with self.assertRaisesRegex(SystemExit, "Missing managed artifact: freemarker"):
            self.check(omit="freemarker")

    def test_only_one_patched_freemarker_runtime_allowed(self):
        patched = pathlib.Path("org.freemarker.freemarker-2.3.35.jar")
        stale = pathlib.Path("org.freemarker.freemarker-2.3.32.jar")
        unrelated = pathlib.Path("org.keycloak.keycloak-core-26.7.4.jar")
        gate.check_freemarker_runtime([patched, unrelated])
        for jars in ([unrelated], [stale], [patched, stale], [patched, patched]):
            with self.subTest(jars=jars), self.assertRaisesRegex(SystemExit, "exactly one patched FreeMarker"):
                gate.check_freemarker_runtime(jars)


if __name__ == "__main__":
    unittest.main()
