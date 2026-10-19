"""Sphinx configuration for the Predict60 source-derived developer documentation."""
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(Path(__file__).parent / '_ext'))
from reference import generate

generate(ROOT, Path(__file__).parent / '_generated')
project = 'Predict60'
author = 'Predict60 contributors'
extensions = ['sphinx.ext.autosectionlabel']
autosectionlabel_prefix_document = True
html_theme = 'alabaster'
html_title = 'Predict60 code documentation'
exclude_patterns = ['_build', 'node_modules']
