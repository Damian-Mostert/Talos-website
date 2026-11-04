#!/usr/bin/env node
'use strict';

// The native addon is an optimisation, not a hard requirement. If node-gyp
// cannot build it (no compiler, unsupported platform, read-only prefix, ...)
// we still want `npm install` to succeed so the package remains usable through
// the JavaScript fallback engine.
console.warn('');
console.warn('  neuropile: native addon was not built.');
console.warn('  The package will use the JavaScript fallback engine.');
console.warn('  Install a C++17 compiler + Python, then run `npm run build` in this');
console.warn('  package to enable the C++ core.');
console.warn('');
process.exit(0);
