#!/usr/bin/env python3
"""Run every unit-test suite and save a colored, timestamped summary log."""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
import time
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import TextIO

ROOT = Path(__file__).resolve().parents[1]
RESULTS_DIRECTORY = Path('/tmp/test_results')
RESET = '\033[0m'
BOLD = '\033[1m'
GREEN = '\033[32m'
RED = '\033[31m'
CYAN = '\033[36m'
YELLOW = '\033[33m'


@dataclass(frozen=True)
class SuiteResult:
    """Store one command's result and parsed test totals."""

    name: str
    command: tuple[str, ...]
    returncode: int
    duration: float
    tests: int = 0
    passed: int = 0
    failed: int = 0
    skipped: int = 0


def result_path(now: datetime | None = None) -> Path:
    """Create a collision-resistant result filename for the current local time."""
    timestamp = (now or datetime.now().astimezone()).strftime('%Y-%m-%d_%H-%M-%S_%f')
    return RESULTS_DIRECTORY / f'test_result_{timestamp}.log'


def parse_counts(output: str, returncode: int) -> tuple[int, int, int, int]:
    """Extract test, pass, failure, and skip counts from Node or unittest output."""
    node_tests = re.search(r'^ℹ tests (\d+)$', output, re.MULTILINE)
    if node_tests:
        tests = int(node_tests.group(1))
        passed_match = re.search(r'^ℹ pass (\d+)$', output, re.MULTILINE)
        failed_match = re.search(r'^ℹ fail (\d+)$', output, re.MULTILINE)
        skipped_match = re.search(r'^ℹ skipped (\d+)$', output, re.MULTILINE)
        return (
            tests,
            int(passed_match.group(1)) if passed_match else 0,
            int(failed_match.group(1)) if failed_match else int(returncode != 0),
            int(skipped_match.group(1)) if skipped_match else 0,
        )
    python_tests = re.search(r'Ran (\d+) tests?', output)
    tests = int(python_tests.group(1)) if python_tests else 0
    failures = sum(int(value) for value in re.findall(r'(?:failures|errors)=(\d+)', output))
    skipped_match = re.search(r'skipped=(\d+)', output)
    skipped = int(skipped_match.group(1)) if skipped_match else 0
    if returncode and not failures:
        failures = 1
    return tests, max(0, tests - failures - skipped), failures, skipped


def write_line(log: TextIO, text: str = '') -> None:
    """Write the same color-preserving line to the terminal and result log."""
    print(text, flush=True)
    print(text, file=log, flush=True)


def run_suite(name: str, command: tuple[str, ...], log: TextIO) -> SuiteResult:
    """Run one suite, streaming its output while retaining it for the summary."""
    write_line(log, f'\n{BOLD}{CYAN}▶ {name}{RESET}')
    write_line(log, f'{CYAN}$ {" ".join(command)}{RESET}')
    started = time.monotonic()
    process = subprocess.Popen(
        command,
        cwd=ROOT,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
    )
    lines = []
    assert process.stdout is not None
    for line in process.stdout:
        clean = line.rstrip('\n')
        lines.append(clean)
        write_line(log, clean)
    returncode = process.wait()
    duration = time.monotonic() - started
    tests, passed, failed, skipped = parse_counts('\n'.join(lines), returncode)
    color, label = (GREEN, 'PASS') if returncode == 0 else (RED, 'FAIL')
    write_line(log, f'{BOLD}{color}{label}{RESET} {name} · {tests} tests · {duration:.2f}s')
    return SuiteResult(name, command, returncode, duration, tests, passed, failed, skipped)


def write_summary(log: TextIO, results: list[SuiteResult], started_at: datetime) -> None:
    """Write a compact per-suite and aggregate result table."""
    total_tests = sum(result.tests for result in results)
    total_passed = sum(result.passed for result in results)
    total_failed = sum(result.failed for result in results)
    total_skipped = sum(result.skipped for result in results)
    duration = sum(result.duration for result in results)
    all_passed = all(result.returncode == 0 for result in results)
    color, label = (GREEN, 'ALL TESTS PASSED') if all_passed else (RED, 'TEST RUN FAILED')
    write_line(log, f'\n{BOLD}{CYAN}════════════ Test summary ════════════{RESET}')
    for result in results:
        suite_color = GREEN if result.returncode == 0 else RED
        suite_label = 'PASS' if result.returncode == 0 else 'FAIL'
        write_line(log, f'{suite_color}{suite_label:4}{RESET}  {result.name:<24} {result.tests:>3} tests  {result.duration:>6.2f}s')
    write_line(log, f'{BOLD}{color}{label}{RESET}')
    write_line(log, f'Tests: {total_tests} · Passed: {GREEN}{total_passed}{RESET} · Failed: {RED}{total_failed}{RESET} · Skipped: {YELLOW}{total_skipped}{RESET}')
    write_line(log, f'Duration: {duration:.2f}s · Started: {started_at.astimezone().isoformat(timespec="seconds")}')


def main() -> int:
    """Run configured suites and return failure when any suite fails."""
    global RESULTS_DIRECTORY
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--results-dir', type=Path, default=RESULTS_DIRECTORY, help=argparse.SUPPRESS)
    args = parser.parse_args()
    RESULTS_DIRECTORY = args.results_dir
    RESULTS_DIRECTORY.mkdir(parents=True, exist_ok=True)
    started_at = datetime.now().astimezone()
    destination = result_path(started_at)
    javascript_tests = tuple(str(path.name) for path in sorted(ROOT.glob('*.test.js')))
    suites = [
        ('JavaScript', ('node', '--test', *javascript_tests)),
        ('Python application', (sys.executable, '-m', 'unittest', 'discover', '-p', '*_test.py')),
        ('Python scripts', (sys.executable, '-m', 'unittest', 'discover', '-s', 'scripts', '-p', '*_test.py')),
    ]
    with destination.open('w', encoding='utf-8') as log:
        write_line(log, f'{BOLD}Predict60 unit-test run{RESET}')
        write_line(log, f'Log: {destination}')
        results = [run_suite(name, command, log) for name, command in suites]
        write_summary(log, results, started_at)
    print(f'\n{CYAN}Saved test log:{RESET} {destination}')
    return 0 if all(result.returncode == 0 for result in results) else 1


if __name__ == '__main__':
    raise SystemExit(main())
