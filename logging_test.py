import logging
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import p60_logging as logs
import server


class LoggingTest(unittest.TestCase):
    def test_rotation_retention_and_writes_after_manual_rotation(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'server.log'
            with patch.multiple(logs, LOG_DIR=Path(directory), LOG_PATH=path,
                                MAX_BYTES=12, BACKUPS=2):
                for line in ('first', 'second', 'third', 'fourth'):
                    logs.write_or_rotate(line)
                self.assertEqual(path.read_text(), 'fourth\n')
                self.assertEqual(path.with_name('server.log.1').read_text(), 'third\n')
                self.assertEqual(path.with_name('server.log.2').read_text(), 'second\n')
                self.assertFalse(path.with_name('server.log.3').exists())
                logs.write_or_rotate(force=True)
                logs.write_or_rotate('after')
                self.assertEqual(path.read_text(), 'after\n')
                self.assertEqual(path.with_name('server.log.1').read_text(), 'fourth\n')
                self.assertEqual(path.stat().st_mode & 0o777, 0o600)

    def test_normal_filters_get_requests_debug_preserves_them(self):
        handler = object.__new__(server.Handler)
        handler.client_address = ('127.0.0.1', 1234)
        handler.command = 'GET'
        handler.requestline = 'GET /api/coins HTTP/1.1'
        handler.path = '/api/coins'
        with patch.object(server, 'LOG', logging.getLogger('logging-test')):
            with self.assertNoLogs('logging-test', level='INFO'):
                handler.log_request(200)
            with self.assertLogs('logging-test', level='DEBUG') as captured:
                handler.log_request(200)
            self.assertIn('GET /api/coins', captured.output[0])
            handler.command = 'POST'
            handler.path = '/api/login'
            with self.assertLogs('logging-test', level='INFO') as captured:
                handler.log_request(200)
            self.assertIn('User action', captured.output[0])
            handler.command = 'GET'
            with self.assertLogs('logging-test', level='ERROR') as captured:
                handler.log_request(503)
            self.assertIn('HTTP failure', captured.output[0])


if __name__ == '__main__':
    unittest.main()
