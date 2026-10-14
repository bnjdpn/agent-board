#!/usr/bin/env python3
"""Install a deterministic Studio wake-up. Never removes a hold or launches an app."""
import argparse
import json
import os
from pathlib import Path
import plistlib
import shutil
import subprocess

p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--install',action='store_true')
a=p.parse_args()
repo=Path(__file__).resolve().parents[1]
home=Path.home()
root=home/'Library/Application Support/agent-board/studio-runtime'
plist=home/'Library/LaunchAgents/dev.agentboard.studio-wakeup.plist'
node=shutil.which('node')
controller=home/'.local/bin/studio'
if not node or not controller.is_file(): raise SystemExit('node and installed studio controller are required')
source=repo/'packages/core/dist/runtime.js'
if not source.is_file(): raise SystemExit('Run npm run build first')
program='''import { readFile, writeFile, rename } from 'node:fs/promises';
import { wakeRuntime } from './runtime.js';
const root = new URL('.', import.meta.url);
const latch = new URL('attention.json', root);
try { await readFile(latch); process.exit(0); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
let receipt;
try {
 const config = JSON.parse(await readFile(new URL('config.json', root), 'utf8'));
 receipt = { at: new Date().toISOString(), ...await wakeRuntime(config) };
} catch (error) { receipt = { at: new Date().toISOString(), state: 'error', reason: error.message }; await writeFile(latch, JSON.stringify(receipt), { mode: 0o600 }); process.exitCode = 1; }
const target = new URL('heartbeat.json', root);
const temp = new URL('heartbeat.' + process.pid + '.tmp', root);
await writeFile(temp, JSON.stringify(receipt, null, 2) + '\\n', { mode: 0o600 });
await rename(temp, target);
'''
manifest={'Label':'dev.agentboard.studio-wakeup','ProgramArguments':[node,str(root/'wake.mjs')], 'StartInterval':60,'RunAtLoad':True,'ProcessType':'Background','EnvironmentVariables':{'PATH':os.environ.get('PATH','/usr/bin:/bin')},'StandardErrorPath':str(root/'stderr.log')}
print(json.dumps({'root':str(root),'plist':str(plist),'interval_seconds':60,'controller':str(controller),'install':a.install},indent=2))
if not a.install: raise SystemExit(0)
if plist.exists(): raise SystemExit('Existing service: inspect and unload explicitly before replacing')
root.mkdir(parents=True,exist_ok=True)
if (root/'wake.mjs').exists(): raise SystemExit('Existing runtime: inspect before replacing')
shutil.copy2(source,root/'runtime.js')
(root/'package.json').write_text('{"type":"module"}\n')
(root/'wake.mjs').write_text(program)
(root/'config.json').write_text(json.dumps({'controller':{'kind':'studio','command':str(controller)}})+'\n')
plist.parent.mkdir(parents=True,exist_ok=True)
plist.write_bytes(plistlib.dumps(manifest))
subprocess.run(['plutil','-lint',str(plist)],check=True)
subprocess.run(['launchctl','bootstrap',f'gui/{os.getuid()}',str(plist)],check=True)
print('Installed. Inspect heartbeat.json; no hold was changed.')
