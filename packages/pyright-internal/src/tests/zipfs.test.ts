/*
 * zipfs.test.ts
 *
 * zip/egg file related FS tests.
 */

import * as assert from 'assert';
import * as path from 'path';
import { RealTempFile, createFromRealFileSystem } from '../common/realFileSystem';
import { compareStringsCaseSensitive } from '../common/stringUtils';
import { Uri } from '../common/uri/uri';

function runTests(p: string): void {
    const tempFile = new RealTempFile();
    const zipRoot = Uri.file(path.resolve(path.dirname(module.filename), p), tempFile);
    const fs = createFromRealFileSystem(tempFile);

    test('stat root', () => {
        const stats = fs.statSync(zipRoot);
        assert.strictEqual(stats.isDirectory(), true);
        assert.strictEqual(stats.isFile(), false);
        assert.strictEqual((stats as any).isZipDirectory(), true);
        assert.strictEqual(stats.isSymbolicLink(), false);
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
        const stats = fs.statSync(zipRoot.combinePaths('EGG-INFO'));
        assert.strictEqual(stats.isDirectory(), true);
        assert.strictEqual(stats.isFile(), false);
    });

    test('readdirEntriesSync root', () => {
        const entries = fs.readdirEntriesSync(zipRoot.combinePaths('EGG-INFO'));
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
        const contents = fs.readFileSync(zipRoot.combinePaths('EGG-INFO', 'top_level.txt'), 'utf-8');
        assert.strictEqual(contents.trim(), 'test');
    });

    test('read file async', async () => {
        const contents = await fs.readFileText(zipRoot.combinePaths('EGG-INFO', 'top_level.txt'), 'utf-8');
        assert.strictEqual(contents.trim(), 'test');
    });

    test('unlink fails', async () => {
        expect(() => {
            fs.unlinkSync(zipRoot.combinePaths('EGG-INFO', 'top_level.txt'));
        }).toThrow(/read-only filesystem/);
    });

    test('isInZip', () => {
        assert.strictEqual(fs.isInZip(zipRoot.combinePaths('EGG-INFO', 'top_level.txt')), true);
        assert.strictEqual(fs.isInZip(Uri.file(module.filename, tempFile)), false);
    });

    tempFile.dispose();
}

describe('zip', () => runTests('./samples/zipfs/basic.zip'));
describe('egg', () => runTests('./samples/zipfs/basic.egg'));
describe('jar', () => runTests('./samples/zipfs/basic.jar'));

function runBadTests(p: string): void {
    const tempFile = new RealTempFile();
    const zipRoot = Uri.file(path.resolve(path.dirname(module.filename), p), tempFile);
    const fs = createFromRealFileSystem(tempFile);

    test('stat root', () => {
        const stats = fs.statSync(zipRoot);
        assert.strictEqual(stats.isDirectory(), false);
        assert.strictEqual(stats.isFile(), true);
    });

    test('isInZip', () => {
        assert.strictEqual(fs.isInZip(zipRoot.combinePaths('EGG-INFO', 'top_level.txt')), false);
    });

    tempFile.dispose();
}

describe('corrupt zip', () => runBadTests('./samples/zipfs/bad.zip'));
describe('corrupt egg', () => runBadTests('./samples/zipfs/bad.egg'));
describe('corrupt jar', () => runBadTests('./samples/zipfs/bad.jar'));

describe('corrupt zip with magic', () => runBadTests('./samples/zipfs/corrupt.zip'));
describe('corrupt egg with magic', () => runBadTests('./samples/zipfs/corrupt.egg'));
describe('corrupt jar with magic', () => runBadTests('./samples/zipfs/corrupt.jar'));
