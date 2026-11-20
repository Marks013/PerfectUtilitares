"""License checks use pinned synthetic sources and never infer missing grants."""
from pathlib import Path
import tempfile
import unittest

from source_licenses import preserve_licenses


class SourceLicenseTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.skill = self.root / 'skill'
        self.skill.mkdir()
        self.item = {'id': 'synthetic', 'repo': 'example/skills', 'commit': 'a' * 40,
                     'path': 'skills/example'}
        self.notices = {}
        self.entries = []

    def git(self, _checkout, *args):
        if args[0] == 'ls-tree':
            return b''.join(f'{mode} {kind} {"b" * 40}\t{name}\0'.encode()
                            for mode, kind, name in self.entries)
        return self.notices[args[1].split(':', 1)[1]]

    def check(self, text='---\nname: example\n---\n'):
        (self.skill / 'SKILL.md').write_text(text)
        preserve_licenses(self.item, self.skill, self.root, self.git)

    def test_hyphenated_root_license_and_notice_are_preserved_verbatim(self):
        self.entries = [('100644', 'blob', 'LICENSE-MIT'), ('100644', 'blob', 'NOTICE')]
        self.notices = {'LICENSE-MIT': b'Original terms', 'NOTICE': b'Original attribution'}
        self.check()
        for name, content in self.notices.items():
            self.assertEqual((self.skill / 'UPSTREAM-NOTICES' / name).read_bytes(), content)

    def test_explicit_reviewed_declaration_requires_matching_frontmatter(self):
        self.item['licenseDeclaration'] = 'MIT'
        self.check('---\nname: example\nlicense: MIT\n---\nBody.\n')
        notice = (self.skill / 'UPSTREAM-NOTICES/LICENSE-DECLARATION.txt').read_text()
        self.assertIn('license: MIT', notice)
        self.assertIn(self.item['commit'], notice)
        self.assertIn('not a substitute', notice)

    def test_missing_declaration_is_not_guessed_from_markdown(self):
        with self.assertRaisesRegex(ValueError, 'synthetic'):
            self.check('---\nname: example\nlicense: MIT\n---\n')

    def test_mismatch_duplicate_and_non_frontmatter_license_are_rejected(self):
        self.item['licenseDeclaration'] = 'MIT'
        for text in ('---\nlicense: Apache-2.0\n---\n', '---\nlicense: MIT\nlicense: MIT\n---\n',
                     '---\nname: example\n---\nlicense: MIT\n', 'license: MIT\n'):
            with self.subTest(text=text), self.assertRaises(ValueError):
                self.check(text)

    def test_notice_or_directory_does_not_supply_a_license(self):
        self.entries = [('100644', 'blob', 'NOTICE'), ('040000', 'tree', 'LICENSE')]
        self.notices = {'NOTICE': b'Attribution only'}
        with self.assertRaises(ValueError):
            self.check()

    def test_skill_local_license_is_retained(self):
        (self.skill / 'LICENSE.txt').write_text('Upstream local terms')
        self.check()
        self.assertEqual((self.skill / 'LICENSE.txt').read_text(), 'Upstream local terms')

    def test_link_is_not_followed_and_unknown_declaration_is_rejected(self):
        self.entries = [('120000', 'blob', 'LICENSE')]
        self.item['licenseDeclaration'] = 'invented'
        with self.assertRaises(ValueError):
            self.check('---\nlicense: invented\n---\n')


if __name__ == '__main__':
    unittest.main()
