"""Exercise distribution builds against isolated fixture files, never the checkout."""
import contextlib
import importlib.util
import io
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location('build_static', Path(__file__).with_name('build-static.py'))
build = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(build)


class StaticBuildTest(unittest.TestCase):
    def test_build_copies_public_files_and_artwork_only_and_refreshes_edits(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            for name in ('index.html', 'welcome.css', 'community.js', 'server.py', 'oilpriceapi.key', 'unit.test.js'):
                (root / name).write_text(name)
            for folder_name in ('coins', 'previews', 'backgrounds'):
                assets = root / 'assets' / folder_name
                assets.mkdir(parents=True)
                (assets / 'image.svg').write_bytes(b'artwork')
                (assets / 'README.md').write_text('generation notes')
            (root / 'assets' / 'fonts').mkdir()
            (root / 'assets' / 'fonts' / 'test.woff2').write_bytes(b'font')
            (root / 'data').mkdir()
            (root / 'data' / 'accounts.sqlite3').write_bytes(b'private')
            public_assets = {'assets/fonts/test.woff2', 'assets/previews/image.svg', 'assets/backgrounds/image.svg'}
            with patch.object(build, 'PUBLIC_ASSETS', public_assets), patch.object(build, 'ROOT', root), patch.object(build, 'PUBLIC_FILES', {'index.html', 'welcome.css', 'community.js'}), contextlib.redirect_stdout(io.StringIO()):
                build.main()
                (root / 'dist' / 'obsolete.js').write_text('old build')
                (root / 'dist' / 'assets' / 'coins' / 'removed.svg').write_text('old icon')
                (root / 'index.html').write_text('updated page')
                build.main()
            dist = root / 'dist'
            self.assertEqual((dist / 'index.html').read_text(), 'updated page')
            self.assertEqual((dist / 'community.js').read_text(), 'community.js')
            files = {str(p.relative_to(dist)) for p in dist.rglob('*') if p.is_file()}
            self.assertEqual(files, {'index.html', 'welcome.css', 'community.js',
                                    'assets/coins/image.svg', 'assets/previews/image.svg',
                                    'assets/backgrounds/image.svg', 'assets/fonts/test.woff2'})

    def test_missing_source_preserves_previous_build(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / 'dist').mkdir()
            (root / 'dist' / 'index.html').write_text('last successful build')
            with patch.object(build, 'ROOT', root), patch.object(build, 'PUBLIC_FILES', {'missing.html'}), patch.object(build, 'PUBLIC_ASSETS', set()):
                with self.assertRaises(FileNotFoundError):
                    build.main()
            self.assertEqual((root / 'dist' / 'index.html').read_text(), 'last successful build')

    def test_public_manifest_contains_no_backend_or_test_files(self):
        for name in build.PUBLIC_FILES:
            with self.subTest(name=name):
                self.assertTrue((build.ROOT / name).is_file())
                self.assertIn(Path(name).suffix, {'.html', '.css', '.js'})
                self.assertNotIn('.test.', name)
                self.assertNotIn('/', name)
        self.assertNotIn('splash.js', build.PUBLIC_FILES)


if __name__ == '__main__':
    unittest.main()
