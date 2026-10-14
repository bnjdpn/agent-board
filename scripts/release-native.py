#!/usr/bin/env python3
"""Build and sign a native update; publish only with --publish after review."""
import argparse
import base64
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
REPO = 'bnjdpn/agent-board'
CHANNEL = 'studio-control-updates'


def run(args, **kwargs):
    return subprocess.run(args, cwd=ROOT, check=True, text=True, **kwargs)


def api(path, payload=None, missing=False):
    args = ['gh', 'api', path]
    if payload is not None:
        args += ['--method', 'POST' if path.endswith('/git/refs') else 'PUT', '--input', '-']
    result = subprocess.run(args, input=json.dumps(payload) if payload is not None else None,
                            cwd=ROOT, capture_output=True, text=True)
    if result.returncode:
        if missing and 'HTTP 404' in result.stderr:
            return None
        raise RuntimeError(result.stderr)
    return json.loads(result.stdout)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--publish', action='store_true')
    args = parser.parse_args()
    config = json.loads((ROOT / 'native/StudioControl/release.json').read_text())
    version = config['version']
    tag = 'studio-control-v' + version
    sha = run(['git', 'rev-parse', 'HEAD'], capture_output=True).stdout.strip()
    if args.publish:
        if run(['git', 'status', '--porcelain'], capture_output=True).stdout.strip():
            raise RuntimeError('Commit and review the complete source before publishing')
        api('repos/' + REPO)  # Distinguish inaccessible repository from absent release.
        remote = api(f'repos/{REPO}/commits/{sha}')
        if remote['sha'] != sha:
            raise RuntimeError('Push the reviewed commit before publishing')
        if api(f'repos/{REPO}/releases/tags/{tag}', missing=True) is not None:
            raise RuntimeError('Release already exists: inspect it; no automatic replay or replacement')
    run([str(ROOT / 'scripts/build-native.sh')])
    tools = ROOT / 'native/StudioControl/.build/artifacts/sparkle/Sparkle/bin'
    public = run([str(tools / 'generate_keys'), '--account', 'studio-control', '-p'], capture_output=True).stdout.strip()
    if public != config['publicKey']:
        raise RuntimeError('Signing key does not match the embedded public key')
    staging = ROOT / 'native/out/releases'
    staging.mkdir(parents=True, exist_ok=True)
    output = Path(tempfile.mkdtemp(prefix=tag + '-', dir=staging))
    archive = output / ('Studio-Control-' + version + '-arm64.zip')
    run(['ditto', '-c', '-k', '--sequesterRsrc', '--keepParent', str(ROOT / 'native/out/Studio Control.app'), str(archive)])
    run([str(tools / 'generate_appcast'), '--account', 'studio-control', '--maximum-deltas', '0',
         '--download-url-prefix', f'https://github.com/{REPO}/releases/download/{tag}/',
         '-o', str(output / 'appcast.xml'), str(output)])
    manifest = output / 'build.json'
    manifest.write_text(json.dumps({'version': version, 'build': config['build'], 'commit': sha,
                                   'sha256': hashlib.sha256(archive.read_bytes()).hexdigest()}, indent=2) + '\n')
    notes = output / 'release-notes.md'
    notes.write_text(f'Studio Control {version} pour macOS Apple Silicon.\n\n'
                     'Interface native, board Kanban, journaux des missions et mises à jour signées Sparkle. '
                     'La mise à jour de l’interface ne change pas les pauses ni les jobs du contrôleur Studio.\n\n'
                     f'Source : `{sha}`. Build `{config["build"]}`.\n')
    if not args.publish:
        print('Signed release staged at ' + str(output))
        return
    # Assets are prepared before visibility; a failure stops without replaying a release.
    run(['gh', 'release', 'create', tag, str(archive), str(output / 'appcast.xml'), str(manifest),
         '--repo', REPO, '--target', sha, '--draft', '--title', 'Studio Control ' + version,
         '--notes-file', str(notes)])
    run(['gh', 'release', 'edit', tag, '--repo', REPO, '--draft=false', '--latest=false'])
    ref = api(f'repos/{REPO}/git/ref/heads/{CHANNEL}', missing=True)
    if ref is None:
        api(f'repos/{REPO}/git/refs', {'ref': 'refs/heads/' + CHANNEL, 'sha': sha})
    current = api(f'repos/{REPO}/contents/appcast.xml?ref={CHANNEL}', missing=True)
    payload = {'message': 'Publish Studio Control ' + version, 'branch': CHANNEL,
               'content': base64.b64encode((output / 'appcast.xml').read_bytes()).decode()}
    if current:
        payload['sha'] = current['sha']
    api(f'repos/{REPO}/contents/appcast.xml', payload)
    print(f'Published https://github.com/{REPO}/releases/tag/{tag}')


if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, subprocess.CalledProcessError) as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1)
