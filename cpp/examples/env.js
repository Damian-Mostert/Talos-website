'use strict';

// Reads an environment variable, preferring the current NEUROPILE_* name and
// falling back to the legacy TALOS_* name so older scripts keep working.
function env(name, fallback) {
  const value = process.env[`NEUROPILE_${name}`] ?? process.env[`TALOS_${name}`];
  return value === undefined ? fallback : value;
}

module.exports = { env };
