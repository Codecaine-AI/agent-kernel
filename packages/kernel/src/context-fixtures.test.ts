import { expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { discoverContextFixtures } from './context-fixtures';

test('context fixtures require session inputs, preserve variables and sort independently of state', () => {
  const root=mkdtempSync(join(tmpdir(),'context-fixtures-'));
  try {
    expect(discoverContextFixtures(root)).toEqual([]);
    const dir=join(root,'context/fixtures');mkdirSync(dir,{recursive:true});
    writeFileSync(join(dir,'B2.json'),JSON.stringify({sessionData:{criterion:'B2'}}));
    writeFileSync(join(dir,'B1.json'),JSON.stringify({label:'B1 catalog',variables:{market:'US'},sessionData:{criterion:'B1'}}));
    writeFileSync(join(dir,'broken.json'),'{');
    writeFileSync(join(dir,'no-session.json'),JSON.stringify({state:{}}));
    writeFileSync(join(dir,'invalid.json'),JSON.stringify({sessionData:[],variables:{}}));
    const fixtures=discoverContextFixtures(root);
    expect(fixtures.map(f=>f.id)).toEqual(['B1','B2']);
    expect(fixtures[0]).toMatchObject({label:'B1 catalog',variables:{market:'US'},sessionData:{criterion:'B1'}});
    expect(fixtures[1]!.label).toBe('B2');
  } finally { rmSync(root,{recursive:true,force:true}); }
});
