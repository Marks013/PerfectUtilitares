"""Retain original license files or a separately reviewed, pinned declaration."""
from pathlib import Path
import re
from typing import Callable

NOTICE_NAME = re.compile(r'(LICENSE|LICENCE|COPYING|NOTICE)([-._][A-Za-z0-9][A-Za-z0-9._-]*)?', re.I)


def preserve_licenses(item: dict, destination: Path, checkout: Path,
                      read_git: Callable[..., bytes]) -> None:
    """Do not turn an absent license into an inferred or invented permission."""
    licenses = []
    rows = read_git(checkout, 'ls-tree', '-z', item['commit']).split(b'\0')
    for row in rows:
        if not row:
            continue
        metadata, name = row.decode('utf-8').split('\t', 1)
        mode, kind, _sha = metadata.split()
        match = NOTICE_NAME.fullmatch(name)
        if not match or kind != 'blob' or mode not in ('100644', '100755'):
            continue
        content = read_git(checkout, 'show', item['commit'] + ':' + name)
        if len(content) > 128 * 1024:
            raise ValueError(f"{item['id']}: unexpected license size")
        folder = destination / 'UPSTREAM-NOTICES'
        folder.mkdir(exist_ok=True)
        (folder / name).write_bytes(content)
        if match.group(1).upper() != 'NOTICE':
            licenses.append(name)
    local_license = any(p.is_file() and (match := NOTICE_NAME.fullmatch(p.name))
                        and match.group(1).upper() != 'NOTICE'
                        for p in destination.rglob('*'))
    if licenses or local_license:
        return
    # Some reviewed skill sources declare their license only in YAML frontmatter.
    # The manifest must opt in, and the SKILL blob/tree is verified before this call.
    declaration = item.get('licenseDeclaration')
    lines = (destination / 'SKILL.md').read_text().splitlines()
    frontmatter = lines[1:lines.index('---', 1)] if lines and lines[0] == '---' and '---' in lines[1:] else []
    fields = [line for line in frontmatter if re.match(r'^license\s*:', line)]
    if declaration != 'MIT' or fields != ['license: MIT']:
        raise ValueError(f"{item['id']}: no reviewed upstream license found; manual review required")
    folder = destination / 'UPSTREAM-NOTICES'
    folder.mkdir(exist_ok=True)
    (folder / 'LICENSE-DECLARATION.txt').write_text(
        'Pinned upstream license declaration, not a substitute for upstream terms.\n'
        f"Source: https://github.com/{item['repo']}/blob/{item['commit']}/{item['path']}/SKILL.md\n"
        'Verbatim frontmatter: license: MIT\n'
        'This revision has no separate license file. No license text was invented.\n')
