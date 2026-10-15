Building and maintaining code docs
==================================

Install the documentation dependencies in your preferred isolated environment::

   python3 -m pip install -r docs/requirements.txt
   npm install --prefix docs

Build HTML, treating warnings as errors::

   python3 -m sphinx -W --keep-going -b html docs docs/_build/html

Open ``docs/_build/html/index.html``. Generated reference pages and rendered HTML
are ignored by Git. The reference extractor uses Python's AST and Acorn for
JavaScript, so it can inspect scripts with hyphenated filenames and nested
helpers without running migrations, binding sockets or starting watchdogs.

Add a module description to every production module, a Python docstring to each
procedure/class, and JSDoc to named browser functions. Explain inputs, timestamp
units, side effects, retry behavior and important failure cases. Comments around
branches and loops should explain the invariant or policy being protected.
Update the architecture page when cross-module behavior changes. Anonymous event
callbacks and comprehensions remain visible in each module's complete source.

The generated branch/iteration reference records conditions rather than claiming
they are exercised. Run the regression suites separately::

   node --test *.test.js
   python3 -m unittest discover -p '*_test.py'
   python3 -m unittest discover -s scripts -p '*_test.py'
