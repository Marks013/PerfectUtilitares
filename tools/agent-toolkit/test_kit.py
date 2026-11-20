"""Offline installer tests use synthetic payloads, not claims of upstream execution."""
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest.mock import patch
import kit

REAL_FETCH_RUNTIME = kit.fetch_runtime
REAL_FETCH_SKILL = kit.fetch_skill


def archive(entries):
    out = io.BytesIO()
    with tarfile.open(fileobj=out, mode='w') as tar:
        for name, content, kind in entries:
            entry = tarfile.TarInfo(name)
            entry.type = kind
            entry.size = len(content) if kind == tarfile.REGTYPE else 0
            entry.linkname = '/outside' if kind in (tarfile.SYMTYPE, tarfile.LNKTYPE) else ''
            tar.addfile(entry, io.BytesIO(content) if entry.size else None)
    return out.getvalue()


def fake_skill(item, dest):
    dest.mkdir(parents=True)
    (dest / 'SKILL.md').write_text('Synthetic skill ' + item['id'])
    (dest / 'LICENSE').write_text('Synthetic test license')


def fake_runtime(item, dest):
    dest.mkdir(parents=True)
    (dest / 'package.json').write_text(json.dumps({'name':'context-mode','version':item['version']}))
    (dest / 'server.mjs').write_text('// Synthetic, not an executable MCP fixture.\n')


class ToolkitTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / 'AGENTS.md').write_text('Preserve project data.\n')
        (self.root / 'web').mkdir()
        (self.root / 'web/package-lock.json').write_text('synthetic-unchanged-lock')
        self.data = kit.manifest()
        self.fetch = patch.object(kit, 'fetch_skill', side_effect=fake_skill).start()
        patch.object(kit, 'fetch_runtime', side_effect=fake_runtime).start()
        self.addCleanup(patch.stopall)

    def install(self, update=False, skills_only=False):
        return kit.install(self.root, self.data, 'codex', update, skills_only)

    def test_ten_reviewed_capabilities_and_valid_profiles(self):
        self.assertEqual(len(self.data['skills']) + 2, 10)
        self.assertEqual(self.data['selection_count'], 10)
        self.assertEqual(len(list((kit.HERE / 'profiles').glob('*/SKILL.md'))), 10)
        for row in self.data['skills']:
            self.assertRegex(row['tree'], kit.HEX)
            self.assertRegex(row['commit'], kit.HEX)

    def test_safe_archive_and_regular_permissions(self):
        raw = archive([('refs/readme.md', b'hello', tarfile.REGTYPE)])
        kit.extract_checked(raw, self.root / 'extract')
        self.assertEqual((self.root / 'extract/refs/readme.md').read_bytes(), b'hello')
        self.assertEqual((self.root / 'extract/refs/readme.md').stat().st_mode & 0o777, 0o644)

    def test_path_traversal_and_absolute_paths_rejected(self):
        for path in ('../bad','/tmp/bad','a/../../bad','..\\bad','C:/bad','.git/config'):
            with self.subTest(path=path), self.assertRaises(kit.KitError):
                kit.extract_checked(archive([(path, b'x', tarfile.REGTYPE)]), self.root/'extract')

    def test_links_and_special_members_rejected(self):
        for kind in (tarfile.SYMTYPE, tarfile.LNKTYPE, tarfile.FIFOTYPE, tarfile.CHRTYPE):
            with self.subTest(kind=kind), self.assertRaises(kit.KitError):
                kit.extract_checked(archive([('link', b'', kind)]), self.root/'extract')

    def test_duplicate_archive_entries_rejected(self):
        with self.assertRaises(kit.KitError):
            kit.extract_checked(archive([('x',b'1',tarfile.REGTYPE),('./x',b'2',tarfile.REGTYPE)]), self.root/'extract')

    def test_archive_limits_rejected_before_extraction(self):
        with patch.object(kit, 'MAX_BYTES', 10), self.assertRaises(kit.KitError):
            kit.extract_checked(b'x'*11, self.root/'extract')

    def test_install_integrity_without_host_or_application_changes(self):
        result = self.install()
        self.assertEqual(result['profiles'], 10)
        self.assertTrue(result['runtime'])
        self.assertEqual(kit.verify(self.root), result)
        self.assertEqual((self.root/'AGENTS.md').read_text(), 'Preserve project data.\n')
        self.assertEqual((self.root/'web/package-lock.json').read_text(), 'synthetic-unchanged-lock')
        self.assertFalse((self.root/'.codex').exists())
        self.assertFalse((self.root/'.mcp.json').exists())
        self.assertFalse((self.root/'.claude/settings.json').exists())

    def test_repeat_install_is_idempotent_and_does_not_download(self):
        before = self.install()
        self.fetch.reset_mock()
        self.assertEqual(self.install(), before)
        self.fetch.assert_not_called()

    def test_update_preserves_backup_and_old_receipt(self):
        before = self.install()
        self.install(update=True)
        backups = list((self.root/kit.STATE/'backups').iterdir())
        self.assertEqual(len(backups), 1)
        saved = json.loads((backups[0]/'receipt.json').read_text())
        self.assertEqual(saved, before)
        self.assertTrue((backups[0]/'.agents/skills/pu-caveman/SKILL.md').is_file())

    def test_manual_edit_blocks_update(self):
        self.install()
        target = self.root/'.agents/skills/pu-caveman/SKILL.md'
        target.write_text('User modification')
        with self.assertRaises(kit.KitError):
            self.install(update=True)
        self.assertEqual(target.read_text(), 'User modification')

    def test_unmanaged_existing_skill_is_preserved(self):
        target = self.root/'.agents/skills/pu-typescript'
        target.mkdir(parents=True)
        (target/'SKILL.md').write_text('User skill')
        with self.assertRaises(kit.KitError):
            self.install()
        self.assertEqual((target/'SKILL.md').read_text(), 'User skill')
        self.assertFalse((self.root/'.agents/skills/pu-caveman').exists())

    def test_failed_download_has_no_partial_installed_profiles(self):
        self.fetch.side_effect = [None, kit.KitError('Synthetic network failure')]
        with self.assertRaises(kit.KitError):
            self.install()
        self.assertFalse((self.root/'.agents').exists())
        self.assertFalse((self.root/kit.STATE/'receipt.json').exists())
        self.assertFalse((self.root/kit.STATE/'.install-lock').exists())

    def test_symlinked_skill_parent_is_refused(self):
        outside = self.root/'outside'
        outside.mkdir()
        (self.root/'.agents').symlink_to(outside, target_is_directory=True)
        with self.assertRaises(kit.KitError):
            self.install()
        self.assertEqual(list(outside.iterdir()), [])

    def test_symlinked_state_is_refused(self):
        outside = self.root/'outside'
        outside.mkdir()
        (self.root/kit.STATE).symlink_to(outside, target_is_directory=True)
        with self.assertRaises(kit.KitError):
            self.install()
        self.assertEqual(list(outside.iterdir()), [])

    def test_receipt_commit_failure_restores_previous_install(self):
        before = self.install()
        with patch.object(kit.os, 'replace', side_effect=OSError('Synthetic disk failure')):
            with self.assertRaises(OSError):
                self.install(update=True)
        self.assertEqual(kit.verify(self.root), before)

    def test_missing_install_file_is_detected(self):
        self.install()
        (self.root/'.agents/skills/pu-caveman/SKILL.md').unlink()
        with self.assertRaises(kit.KitError):
            kit.verify(self.root)

    def test_node_version_gate(self):
        for version in ('v22.16.0','v24.14.9','not-node','24.15.0-malformed'):
            self.assertFalse(kit.node_supported(version), version)
        for version in ('v24.15.0','24.19.0','v26.0.0'):
            self.assertTrue(kit.node_supported(version), version)

    def test_skills_only_is_not_reported_as_runtime_install(self):
        result = self.install(skills_only=True)
        self.assertEqual(result['profiles'], 10)
        self.assertFalse(result['runtime'])
        with self.assertRaises(kit.KitError):
            kit.smoke_runtime(self.root)

    def test_concurrent_install_lock_is_not_deleted(self):
        state = self.root/kit.STATE
        state.mkdir()
        (state/'.install-lock').write_text('Existing lock')
        with self.assertRaises(FileExistsError):
            self.install()
        self.assertEqual((state/'.install-lock').read_text(), 'Existing lock')

    def test_update_does_not_switch_agent_or_runtime_implicitly(self):
        self.install()
        with self.assertRaises(kit.KitError):
            kit.install(self.root, self.data, 'claude', True, False)
        with self.assertRaises(kit.KitError):
            self.install(update=True, skills_only=True)

    def test_runtime_checksum_failure_never_extracts_code(self):
        from unittest.mock import MagicMock
        response = MagicMock()
        response.__enter__.return_value.read.return_value = b'not-the-pinned-release'
        opener = MagicMock()
        opener.open.return_value = response
        with patch.object(kit.urllib.request, 'build_opener', return_value=opener):
            with self.assertRaises(kit.KitError):
                REAL_FETCH_RUNTIME(self.data['runtime'], self.root/'runtime')
        self.assertFalse((self.root/'runtime').exists())

    def test_subtree_mismatch_never_extracts_skill(self):
        item = self.data['skills'][0]
        answers = [b'', b'', (item['commit']+'\n').encode(), b'0'*40+b'\n']
        with patch.object(kit, 'git', side_effect=answers):
            with self.assertRaises(kit.KitError):
                REAL_FETCH_SKILL(item, self.root/'untrusted')
        self.assertFalse((self.root/'untrusted').exists())

    def test_symlinked_backup_parent_is_refused(self):
        self.install()
        outside = self.root/'outside'
        outside.mkdir()
        (self.root/kit.STATE/'backups').symlink_to(outside, target_is_directory=True)
        with self.assertRaises(kit.KitError):
            self.install(update=True)
        self.assertEqual(list(outside.iterdir()), [])

    def test_git_blob_formula_is_not_plain_sha1(self):
        import hashlib
        self.assertEqual(kit.git_blob(b''), 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391')
        self.assertNotEqual(kit.git_blob(b'hello'), hashlib.sha1(b'hello').hexdigest())


if __name__ == '__main__':
    unittest.main()
