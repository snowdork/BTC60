"""Generate Sphinx domain references by reading ASTs, never importing app code."""
import ast
import json
from pathlib import Path
import subprocess


def control_flow(node):
    """List a procedure's own branches and loops, excluding nested procedures."""
    result = []
    def walk(current):
        """Visit this scope while leaving nested helpers to their own reference entries."""
        if current is not node and isinstance(current, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            return
        if isinstance(current, (ast.If, ast.For, ast.AsyncFor, ast.While)):
            if isinstance(current, (ast.For, ast.AsyncFor)):
                expression = f'{ast.unparse(current.target)} in {ast.unparse(current.iter)}'
            else:
                expression = ast.unparse(current.test)
            result.append((current.lineno, type(current).__name__, expression))
        for child in ast.iter_child_nodes(current):
            walk(child)
    walk(node)
    return result


def python_members(tree, prefix=''):
    """Yield qualified Python procedures and classes, including nested helpers."""
    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            name = prefix + node.name
            yield name, node
            yield from python_members(node, name + '.')


def generate(root, destination):
    """Create module pages, procedure docs, control-flow references, and source views."""
    destination.mkdir(parents=True, exist_ok=True)
    pages = []
    paths = sorted([*root.glob('*.py'), *root.glob('*.js'), *root.joinpath('scripts').glob('*.py'), root / 'doc/conf.py', *root.joinpath('doc/_ext').glob('*.py'), *root.joinpath('doc/_ext').glob('*.cjs')])
    for path in paths:
        relative = path.relative_to(root).as_posix()
        slug = relative.replace('/', '_').replace('.', '_')
        title = relative
        page = [title, '=' * len(title), '']
        source = path.read_text()
        is_test = '_test.py' in path.name or '.test.js' in path.name
        if path.suffix == '.py':
            tree = ast.parse(source)
            page += [(ast.get_docstring(tree) or ('Regression tests for ' + path.stem.replace('_test', '').replace('_', ' ') + '.' if is_test else 'Command-line application module.')), '']
            for name, node in python_members(tree):
                is_class = isinstance(node, ast.ClassDef)
                args = '' if is_class else '(' + ast.unparse(node.args) + ')'
                page += [f'.. py:{"class" if is_class else "function"}:: {slug}.{name}{args}', '']
                doc = ast.get_docstring(node)
                if not doc and is_test:
                    doc = 'Verify ' + node.name.removeprefix('test_').replace('_', ' ') + '.'
                page += ['   ' + line for line in (doc or 'See the implementation below.').splitlines()] + ['']
                flow = control_flow(node) if not is_class else []
                if flow:
                    page += ['   Branches and iteration:', '']
                    for line, kind, expression in flow:
                        page += [f'   * Line {line}, {kind}:', '', '     .. code-block:: python', '', '        '+expression.replace('\n',' '), '']
        else:
            data = json.loads(subprocess.check_output(['node', str(Path(__file__).with_name('js_inventory.cjs')), str(path)], text=True))
            page += [data['module'] or ('Browser regression tests.' if is_test else 'Browser application module.'), '']
            for index, function in enumerate(data['functions']):
                # Module-local helpers can share names; source lines disambiguate them.
                page += [f'.. js:function:: {slug}.{function["name"]}({function["params"]})', '   :no-index:', '', '   '+(function['doc'] or 'See the implementation below.'), '', f'   Defined at source line {function["line"]}.', '']
                if function['flow']:
                    page += ['   Branches and iteration:', '']
                    for branch in function['flow']:
                        page += [f'   * Line {branch["line"]}, {branch["kind"]}:', '', '     .. code-block:: javascript', '', '        '+branch['expression'], '']
        source_title = 'Complete implementation'
        page += [source_title, '-'*len(source_title), '', f'.. literalinclude:: /../{relative}', f'   :language: {"python" if path.suffix == ".py" else "javascript"}', '   :linenos:', '']
        (destination / (slug + '.rst')).write_text('\n'.join(page))
        pages.append(slug)
    (destination / 'index.rst').write_text('Module and procedure reference\n==============================\n\nGenerated from source at build time. Times are UTC; Python timestamps are seconds\nunless stated otherwise, while browser chart timestamps are milliseconds.\n\n.. toctree::\n   :maxdepth: 1\n\n'+''.join('   '+page+'\n' for page in pages))
