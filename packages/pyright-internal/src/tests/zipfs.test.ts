/*
 * zipfs.test.ts
 *
 * zip/egg file related FS tests.
 */

import * as assert from 'assert';
import * as path from 'path';

import { combinePaths } from '../common/pathUtils';
import { createFromRealFileSystem } from '../common/realFileSystem';
import { compareStringsCaseSensitive } from '../common/stringUtils';

function runTests(p: string): void {
    const zipRoot = path.resolve(path.dirname(module.filename), p);
    const fs = createFromRealFileSystem();

    test('stat root', () => {
        const stats = fs.statSync(zipRoot);
        assert.strictEqual(stats.isDirectory(), true);
        assert.strictEqual(stats.isFile(), false);
    });

    test('readdirEntriesSync root', () => {
        const entries = fs.readdirEntriesSync(zipRoot);
        assert.strictEqual(entries.length, 2);

        entries.sort((a, b) => compareStringsCaseSensitive(a.name, b.name));

        assert.strictEqual(entries[0].name, 'EGG-INFO');
        assert.strictEqual(entries[0].isDirectory(), true);
        assert.strictEqual(entries[0].isFile(), false);

        assert.strictEqual(entries[1].name, 'test');
        assert.strictEqual(entries[1].isDirectory(), true);
        assert.strictEqual(entries[1].isFile(), false);
    });

    test('stat EGG-INFO', () => {
        const stats = fs.statSync(combinePaths(zipRoot, 'EGG-INFO'));
        assert.strictEqual(stats.isDirectory(), true);
        assert.strictEqual(stats.isFile(), false);
    });

    test('readdirEntriesSync root', () => {
        const entries = fs.readdirEntriesSync(combinePaths(zipRoot, 'EGG-INFO'));
        assert.strictEqual(entries.length, 5);

        entries.sort((a, b) => compareStringsCaseSensitive(a.name, b.name));

        assert.strictEqual(entries[0].name, 'PKG-INFO');
        assert.strictEqual(entries[0].isDirectory(), false);
        assert.strictEqual(entries[0].isFile(), true);

        assert.strictEqual(entries[1].name, 'SOURCES.txt');
        assert.strictEqual(entries[1].isDirectory(), false);
        assert.strictEqual(entries[1].isFile(), true);

        assert.strictEqual(entries[2].name, 'dependency_links.txt');
        assert.strictEqual(entries[2].isDirectory(), false);
        assert.strictEqual(entries[2].isFile(), true);

        assert.strictEqual(entries[3].name, 'top_level.txt');
        assert.strictEqual(entries[3].isDirectory(), false);
        assert.strictEqual(entries[3].isFile(), true);

        assert.strictEqual(entries[4].name, 'zip-safe');
        assert.strictEqual(entries[4].isDirectory(), false);
        assert.strictEqual(entries[4].isFile(), true);
    });

    test('read file', () => {
        const contents = fs.readFileSync(combinePaths(zipRoot, 'EGG-INFO', 'top_level.txt'), 'utf-8');
        assert.strictEqual(contents.trim(), 'test');
    });

    test('read file async', async () => {
        const contents = await fs.readFileText(combinePaths(zipRoot, 'EGG-INFO', 'top_level.txt'), 'utf-8');
        assert.strictEqual(contents.trim(), 'test');
    });

    test('unlink fails', async () => {
        expect(() => {
            fs.unlinkSync(combinePaths(zipRoot, 'EGG-INFO', 'top_level.txt'));
        }).toThrow(/read-only filesystem/);
    });

    test('isInZipOrEgg', () => {
        assert.strictEqual(fs.isInZipOrEgg(combinePaths(zipRoot, 'EGG-INFO', 'top_level.txt')), true);
        assert.strictEqual(fs.isInZipOrEgg(module.filename), false);
    });
}

describe('zip', () => runTests('./samples/zipfs/basic.zip'));
describe('egg', () => runTests('./samples/zipfs/basic.egg'));

function runBadTests(p: string): void {
    const zipRoot = path.resolve(path.dirname(module.filename), p);
    const fs = createFromRealFileSystem();

    test('stat root', () => {
        const stats = fs.statSync(zipRoot);
        assert.strictEqual(stats.isDirectory(), false);
        assert.strictEqual(stats.isFile(), true);
    });

    test('isInZipOrEgg', () => {
        assert.strictEqual(fs.isInZipOrEgg(combinePaths(zipRoot, 'EGG-INFO', 'top_level.txt')), false);
    });
}

describe('corrupt zip', () => runBadTests('./samples/zipfs/bad.zip'));
describe('corrupt egg', () => runBadTests('./samples/zipfs/bad.egg'));

describe('corrupt zip with magic', () => runBadTests('./samples/zipfs/corrupt.zip'));
describe('corrupt egg with magic', () => runBadTests('./samples/zipfs/corrupt.egg'));
