"""POLY-98 B1 (seceng build review): the production hidden prompt clears echo with TCSAFLUSH, so type-ahead sent before the prompt is dropped, not taken as the secret."""
import sys
import unittest
from unittest import mock

from base import ctx_class


class FakeTermios(object):
    TCSANOW, TCSADRAIN, TCSAFLUSH, ECHO = 0, 1, 2, 8

    def __init__(self):
        self.sets = []
        self.old = [0, 0, 0, 0xFF, 0, 0, []]

    def tcgetattr(self, fd):
        return list(self.old)

    def tcsetattr(self, fd, when, attrs):
        self.sets.append((when, list(attrs)))


class FakeStdin(object):
    def fileno(self):
        return 0

    def readline(self):
        return "latevalue\n"


class HiddenPrompt(unittest.TestCase):
    def production(self):
        ctx_class()
        from lib.ctx import production
        return production()

    def test_echo_off_uses_tcsaflush_and_the_restore_uses_tcsadrain(self):
        t = FakeTermios()
        with mock.patch.dict(sys.modules, {"termios": t}), mock.patch.object(sys, "stdin", FakeStdin()), mock.patch.object(sys, "stderr", mock.MagicMock()):
            value = self.production().getpass("resend_api_key (input hidden): ")
        self.assertEqual(value, "latevalue")
        self.assertEqual(len(t.sets), 2)
        (clear_when, clear_attrs), (restore_when, restore_attrs) = t.sets
        self.assertEqual(clear_when, t.TCSAFLUSH)
        self.assertEqual(clear_attrs[3] & t.ECHO, 0)
        self.assertEqual(restore_when, t.TCSADRAIN)
        self.assertEqual(restore_attrs, t.old)

    def test_the_restore_also_happens_when_the_read_fails(self):
        t = FakeTermios()

        class Boom(FakeStdin):
            def readline(self):
                raise KeyboardInterrupt()

        with mock.patch.dict(sys.modules, {"termios": t}), mock.patch.object(sys, "stdin", Boom()), mock.patch.object(sys, "stderr", mock.MagicMock()):
            with self.assertRaises(KeyboardInterrupt):
                self.production().getpass("x: ")
        self.assertEqual([w for w, _ in t.sets], [t.TCSAFLUSH, t.TCSADRAIN])


if __name__ == "__main__":
    unittest.main()
