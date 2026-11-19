#!/usr/bin/env python3
"""Install pinned agent references without changing application packages or host hooks."""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import selectors
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.request
import urllib.parse
import uuid

HERE = Path(__file__).resolve().parent
AGENTS = {'codex': '.agents/skills', 'claude': '.claude/skills', 'cursor': '.cursor/skills'}
HEX = re.compile(r'^[a-f0-9]{40}$')
MAX_BYTES = 40 * 1024 * 1024
STATE = '.agent-toolkit'


class KitError(RuntimeError):
    """A bounded, actionable installation failure."""


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def git_blob(data: bytes) -> str:
    return hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest()


def safe_relative(value: str) -> Path:
    parts = PurePosixPath(value).parts
    if (not parts or value.startswith('/') or '\\' in value or '\0' in value
            or any(p in ('..', '.git') or ':' in p for p in parts)):
        raise KitError('Unsafe relative path')
    return Path(*parts)


def no_symlinks(path: Path, root: Path) -> None:
    for candidate in (path, *path.parents):
        if candidate == root:
            return
        if candidate.is_symlink():
            raise KitError('A managed path contains a symbolic link')
    raise KitError('Managed path is outside the selected project')


def manifest() -> dict:
    data = json.loads((HERE / 'manifest.lock.json').read_text())
    if data.get('schema') != 1 or len(data.get('skills', [])) != 8:
        raise KitError('Invalid manifest schema or skill count')
    names = set()
    for item in data['skills']:
        name = item['id']
        if not re.fullmatch(r'[a-z][a-z0-9-]{1,63}', name) or name in names:
            raise KitError('Invalid or duplicate skill name')
        names.add(name)
        if not re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', item['repo']):
            raise KitError('Invalid upstream repository')
        safe_relative(item['path'])
        if not all(HEX.fullmatch(item[k]) for k in ('commit', 'skill_blob', 'tree')):
            raise KitError('Unpinned upstream reference')
    runtime = data['runtime']
    if (runtime['id'] != 'context-mode' or not re.fullmatch(r'\d+\.\d+\.\d+', runtime['version'])
            or not re.fullmatch(r'[a-f0-9]{64}', runtime['sha256'])
            or runtime['url'] != f"https://github.com/mksglu/context-mode/releases/download/v{runtime['version']}/context-mode.tar.gz"):
        raise KitError('Invalid Context-Mode release pin')
    return data


def extract_checked(raw: bytes, destination: Path) -> None:
    """Extract regular files only, without tarfile.extractall or upstream executables."""
    if len(raw) > MAX_BYTES:
        raise KitError('Archive exceeds compressed limit')
    total, seen = 0, set()
    with tarfile.open(fileobj=io.BytesIO(raw), mode='r:*') as archive:
        for index, member in enumerate(archive):
            if index >= 1500:
                raise KitError('Too many archive entries')
            if member.isdir() and member.name in ('.', './'):
                continue
            rel = safe_relative(member.name)
            if rel.as_posix() in seen:
                raise KitError('Duplicate archive path')
            seen.add(rel.as_posix())
            if not member.isdir() and not member.isfile():
                raise KitError('Links and special archive entries are not allowed')
            if member.size < 0 or member.size > 5 * 1024 * 1024:
                raise KitError('Archive member exceeds limit')
            total += member.size
            if total > MAX_BYTES:
                raise KitError('Archive exceeds expanded limit')
            target = destination / rel
            if member.isdir():
                target.mkdir(parents=True, exist_ok=True)
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            stream = archive.extractfile(member)
            if stream is None:
                raise KitError('Archive entry has no content')
            with target.open('xb') as output:
                shutil.copyfileobj(stream, output)
            target.chmod(0o644)


def git(directory: Path, *args: str) -> bytes:
    env = {k: v for k, v in os.environ.items() if not k.startswith('GIT_')}
    env.update(GIT_TERMINAL_PROMPT='0', GIT_CONFIG_NOSYSTEM='1',
               GIT_CONFIG_GLOBAL=os.devnull, GIT_LFS_SKIP_SMUDGE='1')
    result = subprocess.run(['git', '-c', 'core.hooksPath=' + os.devnull,
                             '-c', 'credential.helper=', '-c', 'protocol.file.allow=never',
                             '-C', str(directory), *args], env=env,
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                            timeout=150, check=False)
    if result.returncode:
        raise KitError('Git source retrieval failed; no credentials or hooks were used')
    return result.stdout


def fetch_skill(item: dict, destination: Path) -> None:
    with tempfile.TemporaryDirectory(prefix='pu-skill-') as temp:
        checkout = Path(temp)
        git(checkout, 'init', '--bare', '--quiet', '--template=')
        git(checkout, 'fetch', '--quiet', '--depth=1', '--no-tags',
            'https://github.com/' + item['repo'] + '.git', item['commit'])
        if git(checkout, 'rev-parse', 'FETCH_HEAD^{commit}').decode().strip() != item['commit']:
            raise KitError('Commit verification failed')
        if git(checkout, 'rev-parse', item['commit'] + ':' + item['path']).decode().strip() != item['tree']:
            raise KitError('Skill tree differs from its reviewed pin')
        extract_checked(git(checkout, 'archive', '--format=tar',
                            item['commit'] + ':' + item['path']), destination)
        skill = destination / 'SKILL.md'
        if not skill.is_file() or git_blob(skill.read_bytes()) != item['skill_blob']:
            raise KitError('SKILL.md integrity verification failed')
        # Carry the repository's license/notice in addition to any per-skill license.
        names = git(checkout, 'ls-tree', '--name-only', item['commit']).decode().splitlines()
        notices = [n for n in names if re.fullmatch(r'(LICENSE|COPYING|NOTICE)(\.[A-Za-z]+)?', n, re.I)]
        for name in notices:
            content = git(checkout, 'show', item['commit'] + ':' + name)
            if len(content) > 128 * 1024:
                raise KitError('Unexpected license size')
            folder = destination / 'UPSTREAM-NOTICES'
            folder.mkdir(exist_ok=True)
            (folder / name).write_bytes(content)
        if not notices and not any('LICENSE' in p.name.upper() for p in destination.rglob('*')):
            raise KitError('No upstream license found; manual review required')


class ReleaseRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        parsed = urllib.parse.urlparse(newurl)
        if parsed.scheme != 'https' or parsed.hostname not in (
                'github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com'):
            raise KitError('Unexpected release redirect')
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def fetch_runtime(item: dict, destination: Path) -> None:
    opener = urllib.request.build_opener(ReleaseRedirect())
    request = urllib.request.Request(item['url'], headers={'User-Agent': 'PerfectUtilitares-AgentKit/1'})
    with opener.open(request, timeout=60) as response:
        raw = response.read(MAX_BYTES + 1)
    if len(raw) > MAX_BYTES or sha256(raw) != item['sha256']:
        raise KitError('Context-Mode archive SHA-256 mismatch')
    extract_checked(raw, destination)
    if not (destination / 'package.json').is_file():
        children = list(destination.iterdir())
        if len(children) != 1 or not children[0].is_dir():
            raise KitError('Unexpected release layout')
        nested = children[0]
        for child in list(nested.iterdir()):
            child.rename(destination / child.name)
        nested.rmdir()
    package = json.loads((destination / 'package.json').read_text())
    if (package.get('name') != 'context-mode' or package.get('version') != item['version']
            or package.get('dependencies') or package.get('scripts')
            or not (destination / 'server.mjs').is_file()):
        raise KitError('Unexpected runtime package; refusing dependency/lifecycle execution')


def inventory(project: Path, roots: list[str]) -> dict[str, str]:
    result = {}
    for rel in roots:
        base = project / safe_relative(rel)
        no_symlinks(base, project)
        if not base.is_dir():
            raise KitError('An installed directory is missing')
        for file in sorted(base.rglob('*')):
            no_symlinks(file, project)
            if file.is_file():
                result[file.relative_to(project).as_posix()] = sha256(file.read_bytes())
            elif not file.is_dir():
                raise KitError('Unexpected installed object')
    return result


def verify(project: Path) -> dict:
    record = project / STATE / 'receipt.json'
    no_symlinks(record, project)
    data = json.loads(record.read_text())
    allowed = tuple(AGENTS.values()) + (STATE + '/runtime', STATE + '/config')
    if not all(any(p.startswith(a + '/') for a in allowed) for p in data['roots']):
        raise KitError('Invalid receipt paths')
    if inventory(project, data['roots']) != data['files']:
        raise KitError('Installed files changed; preserve local edits before updating')
    return data


def install(project: Path, data: dict, agent: str, update: bool, skills_only: bool) -> dict:
    if not project.is_dir() or not (project / 'AGENTS.md').is_file():
        raise KitError('Select a project root containing AGENTS.md')
    state = project / STATE
    no_symlinks(state, project)
    state.mkdir(exist_ok=True)
    lock = state / '.install-lock'
    with lock.open('x'):
        pass
    try:
        # Keep downloaded code, local receipts and backup snapshots out of Git.
        ignore = state / '.gitignore'
        no_symlinks(ignore, project)
        no_symlinks(state / 'receipt.new.json', project)
        if not ignore.exists():
            ignore.write_text('*\n')
        old = verify(project) if (state / 'receipt.json').exists() else None
        if old and not update:
            same = (old['manifest_sha256'] == sha256((HERE / 'manifest.lock.json').read_bytes())
                    and old['agent'] == agent and old['runtime'] == (not skills_only))
            if same:
                return old
            raise KitError('Already installed with different settings; use update after review')
        if old and (old['agent'] != agent or old['runtime'] == skills_only):
            raise KitError('Keep the existing agent/runtime selection for an in-place update')
        ids = [r['id'] for r in data['skills']] + ['docker-compose', 'context-mode']
        skill_root = AGENTS[agent]
        roots = [f'{skill_root}/pu-{key}' for key in ids]
        if not skills_only:
            roots.append(STATE + '/runtime/context-mode')
        roots.append(STATE + '/config/templates')
        for rel in roots:
            target = project / rel
            no_symlinks(target, project)
            if target.exists() and (not old or rel not in old['roots']):
                raise KitError('An unmanaged destination exists; nothing will be overwritten')
        with tempfile.TemporaryDirectory(prefix='stage-', dir=state) as temp:
            stage = Path(temp)
            for item in data['skills']:
                dest = stage / skill_root / ('pu-' + item['id'])
                shutil.copytree(HERE / 'profiles' / ('pu-' + item['id']), dest)
                fetch_skill(item, dest / 'references' / 'upstream')
            for key in ('docker-compose', 'context-mode'):
                shutil.copytree(HERE / 'profiles' / ('pu-' + key), stage / skill_root / ('pu-' + key))
            for key in ids:
                (stage / skill_root / ('pu-' + key) / '.gitignore').write_text('*\n')
            if not skills_only:
                fetch_runtime(data['runtime'], stage / STATE / 'runtime' / 'context-mode')
            config = stage / STATE / 'config/templates'
            config.mkdir(parents=True)
            server = str(project / STATE / 'runtime/context-mode/server.mjs')
            (config / 'context-mode.mcp.example.json').write_text(json.dumps({
                'mcpServers': {'context-mode': {'command': 'node', 'args': [server]}}}, indent=2) + '\n')
            (config / 'context-mode.codex.example.toml').write_text(
                '[mcp_servers.context-mode]\ncommand = "node"\nargs = [' + json.dumps(server) + ']\n')
            (config / 'STATUS.txt').write_text(
                'Templates only. No host configuration or hook trust was changed.\n'
                + ('Runtime downloaded.\n' if not skills_only else 'Runtime NOT installed.\n'))
            staged_files = inventory(stage, roots)
            backup = state / 'backups' / uuid.uuid4().hex
            no_symlinks(backup, project)
            changed = []
            if old:
                backup.mkdir(parents=True)
                shutil.copyfile(state / 'receipt.json', backup / 'receipt.json')
            try:
                for rel in roots:
                    target = project / rel
                    target.parent.mkdir(parents=True, exist_ok=True)
                    previous = backup / rel
                    existed = target.exists()
                    if existed:
                        previous.parent.mkdir(parents=True, exist_ok=True)
                        target.rename(previous)
                    changed.append((target, previous, existed))
                    (stage / rel).rename(target)
                receipt = {'schema': 1, 'agent': agent, 'runtime': not skills_only,
                           'manifest_sha256': sha256((HERE / 'manifest.lock.json').read_bytes()),
                           'roots': roots, 'files': staged_files, 'profiles': len(ids),
                           'installed_at_utc': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}
                draft = state / 'receipt.new.json'
                draft.write_text(json.dumps(receipt, indent=2, ensure_ascii=False) + '\n')
                os.replace(draft, state / 'receipt.json')
            except BaseException:
                for target, previous, existed in reversed(changed):
                    if target.is_dir():
                        shutil.rmtree(target)
                    if existed:
                        previous.rename(target)
                raise
        return verify(project)
    finally:
        lock.unlink()


def node_supported(version: str) -> bool:
    match = re.fullmatch(r'v?(\d+)\.(\d+)\.(\d+)', version.strip())
    return bool(match and tuple(map(int, match.groups())) >= (24, 15, 0))


def smoke_runtime(project: Path) -> list[str]:
    record = verify(project)
    if not record['runtime']:
        raise KitError('Runtime was not installed')
    node = shutil.which('node')
    if not node or not node_supported(subprocess.check_output([node, '--version'], text=True, timeout=5)):
        raise KitError('Context-Mode requires Node >=24.15.0; application Node was not changed')
    server = project / STATE / 'runtime/context-mode/server.mjs'
    with tempfile.TemporaryDirectory(prefix='pu-mcp-smoke-') as temp:
        env = {'PATH': os.environ.get('PATH', ''), 'HOME': temp,
               'XDG_CONFIG_HOME': temp, 'XDG_CACHE_HOME': temp, 'TMPDIR': temp}
        with tempfile.TemporaryFile() as errors:
            process = subprocess.Popen([node, str(server)], cwd=temp, env=env,
                                       stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=errors)
            selector = selectors.DefaultSelector()
            buffer = b''
            try:
                selector.register(process.stdout, selectors.EVENT_READ)
                def request(payload: dict, identifier: int) -> dict:
                    nonlocal buffer
                    process.stdin.write(json.dumps(payload).encode() + b'\n')
                    process.stdin.flush()
                    until = time.monotonic() + 20
                    while time.monotonic() < until:
                        while b'\n' in buffer:
                            line, buffer = buffer.split(b'\n', 1)
                            answer = json.loads(line)
                            if answer.get('id') == identifier:
                                if 'error' in answer:
                                    raise KitError('MCP returned an error')
                                return answer['result']
                        if selector.select(timeout=0.5):
                            chunk = os.read(process.stdout.fileno(), 65536)
                            if not chunk:
                                raise KitError('MCP server ended before replying')
                            buffer += chunk
                            if len(buffer) > 2 * 1024 * 1024:
                                raise KitError('MCP response exceeded the smoke limit')
                    raise KitError('MCP handshake timed out')
                request({'jsonrpc':'2.0','id':1,'method':'initialize', 'params':{
                    'protocolVersion':'2025-03-26','capabilities':{},
                    'clientInfo':{'name':'pu-toolkit-smoke','version':'1'}}}, 1)
                process.stdin.write(b'{"jsonrpc":"2.0","method":"notifications/initialized"}\n')
                process.stdin.flush()
                result = request({'jsonrpc':'2.0','id':2,'method':'tools/list','params':{}}, 2)
                names = sorted(tool['name'] for tool in result['tools'])
                if not {'ctx_execute', 'ctx_search'} <= set(names):
                    raise KitError('Expected Context-Mode tools are missing')
                return names
            finally:
                selector.close()
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=5)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=('plan', 'install', 'update', 'verify', 'smoke'))
    parser.add_argument('--project', type=Path, default=Path.cwd())
    parser.add_argument('--agent', choices=AGENTS, default='codex')
    parser.add_argument('--skills-only', action='store_true')
    args = parser.parse_args()
    try:
        data, project = manifest(), args.project.resolve()
        if args.command == 'plan':
            print(json.dumps(data, indent=2, ensure_ascii=False))
        elif args.command in ('install', 'update'):
            result = install(project, data, args.agent, args.command == 'update', args.skills_only)
            print(json.dumps({'profiles_installed': result['profiles'], 'runtime_downloaded': result['runtime'],
                              'host_mcp_registered': False, 'hooks_trusted': False}, ensure_ascii=False))
        elif args.command == 'verify':
            result = verify(project)
            print(json.dumps({'integrity': 'passed', 'profiles': result['profiles'], 'runtime': result['runtime']}))
        else:
            print(json.dumps({'isolated_mcp_smoke': 'passed', 'tools': smoke_runtime(project)}))
        return 0
    except (KitError, OSError, ValueError, KeyError, subprocess.SubprocessError, tarfile.TarError) as exc:
        print(f'Agent toolkit: {exc}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
