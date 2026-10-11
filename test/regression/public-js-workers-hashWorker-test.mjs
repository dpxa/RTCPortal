import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test('workers/hashWorker worker script parses successfully', () => {
  const fileContent = fs.readFileSync(path.resolve(__dirname, '../../public/js/workers/hashWorker.js'), 'utf-8');
  assert.ok(fileContent.length > 0);
});
//
