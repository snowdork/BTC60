Building and maintaining code docs
==================================

Install the documentation dependencies in your preferred isolated environment::

   python3 -m pip install -r doc/requirements.txt
   npm install --prefix doc

Build HTML, treating warnings as errors::

   python3 -m sphinx -W --keep-going -b html doc doc/_build/html

Open ``doc/_build/html/index.html``. Generated reference pages and rendered HTML
are ignored by Git. The reference extractor uses Python's AST and Acorn for
JavaScript, so it can inspect scripts with hyphenated filenames and nested
helpers without running migrations, binding sockets or starting watchdogs.

Add a module description to every production module, a Python docstring to each
procedure/class, and JSDoc to named browser functions. Explain inputs, timestamp
units, side effects, retry behavior and important failure cases. Comments around
branches and loops should explain the invariant or policy being protected.
Update the architecture page when cross-module behavior changes. Anonymous event
callbacks and comprehensions remain visible in each module's complete source.

Keep segment state and viewport styles together in the final segment section
of ``src/frontend/responsive.css``. Shared arrow geometry belongs in
``styles.css``. Do not edit ``dist/`` directly; rebuild it from source after
changes. Reuse indexed segment nodes and update only changed values in the live
refresh path. Add behavior tests for freshness, pending/completed states and
exact-minute benchmark recovery; avoid tests that merely repeat CSS declarations.

The generated branch/iteration reference records conditions rather than claiming
they are exercised. Run the regression suites separately::

   python3 scripts/run_tests.py

The runner executes all three unit-test suites and writes a colored result log
to ``/tmp/test_results/test_result_<date_time>.log``. Read saved logs with
``less -R`` to display their PASS/FAIL colors.

For Docker startup, persistence, crash recovery, and restore checks, see the
`test guide <TEST_GUIDE.md>`_. These require a Docker-capable host and are separate
from the mocked regression suites.
