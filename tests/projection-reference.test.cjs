'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { g_szRepositoryRoot } = require('./_load.cjs');

const g_szJsonPath = path.join(g_szRepositoryRoot, 'doc', 'equilateral-chamfered-cube.json');
const g_szScriptPath = path.join(g_szRepositoryRoot, 'tools', 'generate_map_projection.py');

function FindPython() {
  for (const szCommand of ['python3', 'python']) {
    const Result = spawnSync(szCommand, ['--version'], { encoding: 'utf8' });
    if (Result.status === 0) {
      return szCommand;
    }
  }
  return null;
}

test('reference projection JSON has the expected structure', () => {
  const Data = JSON.parse(fs.readFileSync(g_szJsonPath, 'utf8'));
  assert.equal(Data.schema_version, 1);
  assert.equal(Data.solid.vertices.length, 32);
  assert.equal(Data.solid.edges.length, 48);
  assert.equal(Data.solid.faces.length, 18);
  assert.equal(Data.net.vertices.length, 62);
  assert.equal(Data.net.edges.length, 79);
  assert.equal(Data.net.faces.length, 18);
  assert.equal(Data.net.edges.filter((Edge) => Edge.kind === 'fold').length, 17);
  assert.equal(Data.net.edges.filter((Edge) => Edge.kind === 'cut').length, 62);
});

test('committed projection exports are exactly reproducible', (Context) => {
  const szPython = FindPython();
  if (!szPython) {
    Context.skip('Python is not installed');
    return;
  }
  const Result = spawnSync(szPython, [g_szScriptPath, '--labels', '--check'], { encoding: 'utf8' });
  assert.equal(Result.status, 0, Result.stderr || Result.stdout);
});
