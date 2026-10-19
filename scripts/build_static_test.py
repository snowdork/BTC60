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
                (assets / 'image.webp').write_bytes(b'artwork')
                (assets / 'README.md').write_text('generation notes')
            (root / 'data').mkdir()
            (root / 'data' / 'accounts.sqlite3').write_bytes(b'private')
            with patch.object(build, 'ROOT', root), patch.object(build, 'PUBLIC_FILES', {'index.html', 'welcome.css', 'community.js'}), contextlib.redirect_stdout(io.StringIO()):
                build.main()
                (root / 'index.html').write_text('updated page')
                build.main()
            dist = root / 'dist'
            self.assertEqual((dist / 'index.html').read_text(), 'updated page')
            self.assertEqual((dist / 'community.js').read_text(), 'community.js')
            files = {str(p.relative_to(dist)) for p in dist.rglob('*') if p.is_file()}
            self.assertEqual(files, {'index.html', 'welcome.css', 'community.js',
                                    'assets/coins/image.webp', 'assets/previews/image.webp',
                                    'assets/backgrounds/image.webp'})

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
