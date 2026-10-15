"""Check documentation coverage and reference extraction without needing Sphinx."""
import ast
import importlib.util
import json
from pathlib import Path
import subprocess
import unittest

ROOT = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location('doc_reference', ROOT / 'docs/_ext/reference.py')
reference = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(reference)


class DocumentationTest(unittest.TestCase):
    """Keep production documentation complete and scoped to each procedure."""

    def test_python_modules_classes_and_procedures_have_docstrings(self):
        """Require source documentation for production Python and documentation tooling."""
        paths = [*ROOT.glob('*.py'), *ROOT.joinpath('scripts').glob('*.py'),
                 ROOT / 'docs/conf.py', *ROOT.joinpath('docs/_ext').glob('*.py')]
        for path in paths:
            if 'test' in path.name:
                continue
            tree = ast.parse(path.read_text())
            with self.subTest(module=path.name):
                self.assertTrue(ast.get_docstring(tree))
            for node in ast.walk(tree):
                if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                    with self.subTest(module=path.name, procedure=node.name):
                        self.assertTrue(ast.get_docstring(node))

    def test_browser_modules_and_named_procedures_have_jsdoc(self):
        """Check real JavaScript syntax trees rather than matching function text with regex."""
        for path in [*ROOT.glob('*.js'), *ROOT.joinpath('docs/_ext').glob('*.cjs')]:
            if '.test.' in path.name:
                continue
            inventory = json.loads(subprocess.check_output([
                'node', str(ROOT / 'docs/_ext/js_inventory.cjs'), str(path)], text=True))
            with self.subTest(module=path.name):
                self.assertTrue(inventory['module'])
            for procedure in inventory['functions']:
                with self.subTest(module=path.name, procedure=procedure['name']):
                    self.assertTrue(procedure['doc'])

    def test_nested_control_flow_belongs_to_its_own_procedure(self):
        """Do not attribute a nested helper's guards and iterations to its parent."""
        tree = ast.parse('''def outer(items):
    if items:
        return items
    def nested(values):
        for value in values:
            if value:
                return value
    while items:
        items.pop()
''')
        outer = tree.body[0]
        self.assertEqual([kind for _, kind, _ in reference.control_flow(outer)], ['If', 'While'])
        self.assertEqual([name for name, _ in reference.python_members(tree)], ['outer', 'outer.nested'])


if __name__ == '__main__':
    unittest.main()
