# SPDX-License-Identifier: MIT
"""Exercise Proton's real optional-helper updater without importing its launcher."""
import ast
import errno
import io
import os
from pathlib import Path
import shutil
import stat
import tempfile
from types import SimpleNamespace
import unittest

source = Path(__file__).resolve().parents[1] / 'proton'
tree = ast.parse(source.read_text())
compat = next(node for node in tree.body if isinstance(node, ast.ClassDef) and node.name == 'CompatData')
method = next(node for node in compat.body if isinstance(node, ast.FunctionDef) and node.name == 'copy_native_text_entry')
setup = next(node for node in compat.body if isinstance(node, ast.FunctionDef) and node.name == 'setup_prefix')
assert any(isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr == 'copy_native_text_entry' for node in ast.walk(setup))
functions = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name in ('try_copy', 'file_exists')]
namespace = dict(os=os, shutil=shutil, stat=stat, errno=errno, copyfile=shutil.copyfile, log=lambda *_: None)
exec(compile(ast.Module(body=functions + [method], type_ignores=[]), str(source), 'exec'), namespace)


class ExistingPrefix(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='native entry prefix ')
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.default = self.root / 'runtime default prefix'
        self.prefix = self.root / 'existing game prefix'
        for folder in ('system32', 'syswow64'):
            (self.prefix / 'drive_c/windows' / folder).mkdir(parents=True)
        self.source = self.default / 'drive_c/windows/system32/nexus-text-entry.py'
        self.source.parent.mkdir(parents=True)
        self.save = self.prefix / 'save.dat'
        self.save.write_bytes(b'unchanged-user-data')
        self.tracking = io.StringIO()
        namespace['g_proton'] = SimpleNamespace(default_pfx_dir=str(self.default))
        self.context = SimpleNamespace(prefix_dir=str(self.prefix))

    def sync(self):
        namespace['copy_native_text_entry'](self.context, self.tracking)
        self.assertEqual(self.save.read_bytes(), b'unchanged-user-data')

    def test_old_runtime_without_helper_leaves_existing_prefix_untouched(self):
        before = sorted(str(p.relative_to(self.prefix)) for p in self.prefix.rglob('*'))
        self.sync()
        self.assertEqual(before, sorted(str(p.relative_to(self.prefix)) for p in self.prefix.rglob('*')))
        self.assertEqual(self.tracking.getvalue(), '')

    def test_existing_x64_and_wow64_prefixes_receive_and_refresh_exact_helper(self):
        for directory in ('system32', 'syswow64'):
            source = self.default / 'drive_c/windows' / directory
            source.mkdir(parents=True, exist_ok=True)
            (source / 'nexus-text-entry.py').write_bytes(b'first SDK helper\n')
            (source / 'nexus-text-entry-host.exe').write_bytes(b'MZ ' + directory.encode())
        self.sync()
        for directory in ('system32', 'syswow64'):
            for name in ('nexus-text-entry.py', 'nexus-text-entry-host.exe'):
                self.assertEqual((self.prefix / 'drive_c/windows' / directory / name).read_bytes(),
                                 (self.default / 'drive_c/windows' / directory / name).read_bytes())
        self.assertEqual(len(self.tracking.getvalue().splitlines()), 4)
        for directory in ('system32', 'syswow64'):
            (self.default / 'drive_c/windows' / directory / self.source.name).write_bytes(b'updated SDK helper\n')
        self.sync()
        for directory in ('system32', 'syswow64'):
            self.assertEqual((self.prefix / 'drive_c/windows' / directory / self.source.name).read_bytes(), b'updated SDK helper\n')
        self.assertEqual(len(self.tracking.getvalue().splitlines()), 4)

    def test_single_architecture_prefix_does_not_gain_a_fake_windows_directory(self):
        shutil.rmtree(self.prefix / 'drive_c/windows/syswow64')
        self.source.write_bytes(b'helper\n')
        self.sync()
        self.assertFalse((self.prefix / 'drive_c/windows/syswow64').exists())
        self.assertEqual(len(self.tracking.getvalue().splitlines()), 1)


if __name__ == '__main__':
    unittest.main()
