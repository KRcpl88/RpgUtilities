'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { REPOSITORY_ROOT } = require('./_load.cjs');

const JSON_PATH = path.join(REPOSITORY_ROOT, 'doc', 'equilateral-chamfered-cube.json');
const SCRIPT_PATH = path.join(REPOSITORY_ROOT, 'tools', 'generate_map_projection.py');

function findPython() {
  for (const command of ['python3', 'python']) {
    const result = spawnSync(command, ['--version'], { encoding: 'utf8' });
    if (result.status === 0) {
      return command;
    }
  }
  return null;
}

test('reference projection JSON has the expected structure', () => {
  const data = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'));
  assert.equal(data.schema_version, 1);
  assert.equal(data.solid.vertices.length, 32);
  assert.equal(data.solid.edges.length, 48);
  assert.equal(data.solid.faces.length, 18);
  assert.equal(data.net.vertices.length, 62);
  assert.equal(data.net.edges.length, 79);
  assert.equal(data.net.faces.length, 18);
  assert.equal(data.net.edges.filter((edge) => edge.kind === 'fold').length, 17);
  assert.equal(data.net.edges.filter((edge) => edge.kind === 'cut').length, 62);
});

test('committed projection exports are exactly reproducible', (context) => {
  const python = findPython();
  if (!python) {
    context.skip('Python is not installed');
    return;
  }
  const result = spawnSync(python, [SCRIPT_PATH, '--labels', '--check'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
