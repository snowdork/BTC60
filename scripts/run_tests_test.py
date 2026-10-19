"""Tests for the timestamped unit-test result reporter."""

import importlib.util
import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path

MODULE_PATH = Path(__file__).with_name('run_tests.py')
SPEC = importlib.util.spec_from_file_location('run_tests', MODULE_PATH)
run_tests = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
sys.modules[SPEC.name] = run_tests
SPEC.loader.exec_module(run_tests)


class TestResultReporterTest(unittest.TestCase):
    """Verify stable filenames and summaries for both supported test formats."""

    def test_result_path_contains_timestamp(self):
        now = datetime(2026, 10, 15, 14, 3, 9, 123456, tzinfo=timezone.utc)
        self.assertEqual(
            run_tests.result_path(now),
            Path('/tmp/test_results/test_result_2026-10-15_14-03-09_123456.log'),
        )

    def test_parses_node_test_summary(self):
        output = 'ℹ tests 59\nℹ pass 57\nℹ fail 1\nℹ skipped 1\n'
        self.assertEqual(run_tests.parse_counts(output, 1), (59, 57, 1, 1))

    def test_parses_python_test_summary(self):
        output = 'Ran 40 tests in 1.250s\n\nFAILED (failures=2, errors=1, skipped=3)'
        self.assertEqual(run_tests.parse_counts(output, 1), (40, 34, 3, 3))


if __name__ == '__main__':
    unittest.main()
