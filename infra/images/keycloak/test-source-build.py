"""Offline negative tests for the source build's dependency gate."""
import importlib.util
import pathlib
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("source_build", pathlib.Path(__file__).with_name("verify-source-build.py"))
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)


class DependencyGateTests(unittest.TestCase):
    def check(self, netty="4.1.137.Final", bc="1.85", omit=None):
        entries = [("io.netty", "netty-handler", netty),
                   ("io.netty", "netty-codec-http2", netty),
                   ("io.netty", "netty-tcnative-classes", "2.0.78.Final"),
                   *[("org.bouncycastle", artifact, bc) for artifact in
                     ("bcprov-jdk18on", "bcpkix-jdk18on", "bcutil-jdk18on")]]
        body = "".join(f"<dependency><groupId>{g}</groupId><artifactId>{a}</artifactId><version>{v}</version></dependency>"
                       for g, a, v in entries if a != omit)
        with tempfile.TemporaryDirectory() as directory:
            path = pathlib.Path(directory) / "pom.xml"
            path.write_text(f'<project xmlns="http://maven.apache.org/POM/4.0.0"><dependencyManagement><dependencies>{body}</dependencies></dependencyManagement></project>')
            return gate.check_effective(path)

    def test_aligned_families_allow_separate_tcnative_release_line(self):
        self.assertEqual(len(self.check()), 5)

    def test_stale_netty_rejected(self):
        with self.assertRaisesRegex(SystemExit, "Unaligned Netty"):
            self.check(netty="4.1.136.Final")

    def test_stale_bc_companions_rejected(self):
        with self.assertRaisesRegex(SystemExit, "Unaligned BC"):
            self.check(bc="1.84")

    def test_missing_companion_rejected(self):
        with self.assertRaisesRegex(SystemExit, "Missing managed artifact: bcutil"):
            self.check(omit="bcutil-jdk18on")


if __name__ == "__main__":
    unittest.main()
