#!/usr/bin/env node
'use strict';

// Publish the neuropile package from the repository root.
//
// The repo root holds the `talos` Next.js app, whose package.json is a
// different package entirely. Running `npm publish` from the root would try
// to publish that app instead, so this script always changes into cpp/ first.
//
//   node scripts/publish-neuropile.js            # publish as latest
//   node scripts/publish-neuropile.js --tag next # publish under another tag
//   node scripts/publish-neuropile.js --dry-run  # preview only

const { spawnSync } = require('node:child_process');
const path = require('node:path');

const packageDir = path.join(__dirname, '..', 'cpp');

const args = ['publish'];
for (const arg of process.argv.slice(2)) {
  if (arg === '--dry-run') {
    args.push('--dry-run');
  } else {
    args.push(arg);
  }
}

const result = spawnSync('npm', args, {
  cwd: packageDir,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

if (result.error) {
  console.error(`\nFailed to run npm publish: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status === null ? 1 : result.status);
