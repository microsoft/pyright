import type { ReadStream } from 'fs';

import { FileSystem, Stats } from '../common/fileSystem';
import { normalizeSlashes } from '../common/pathUtils';
import { Uri } from '../common/uri/uri';
import { UriEx } from '../common/uri/uriUtils';
import {
    createFileSystemMapping,
    createFileSystemMappingState,
    FileSystemMapping,
    FileSystemMappingState,
} from '../fileSystemMapping';
import { PyrightFileSystem } from '../pyrightFileSystem';
import { TestFileSystem } from './harness/vfs/filesystem';

type ExpectedMappingKey =
    | 'existsSync'
    | 'readdirEntriesSync'
    | 'readFileSync'
    | 'statSync'
    | 'realpathSync'
    | 'createReadStream'
    | 'readFile'
    | 'readFileText'
    | 'isMappedUri'
    | 'getOriginalUri'
    | 'getMappedUri'
    | 'mapDirectory';

type Assert<T extends true> = T;
type IsEqual<T, U> = (<V>() => V extends T ? 1 : 2) extends <V>() => V extends U ? 1 : 2 ? true : false;
type MappingKeysAreExact = Assert<IsEqual<keyof FileSystemMapping, ExpectedMappingKey>>;
type MappingSignaturesMatch = Assert<
    {
        [K in keyof FileSystemMapping]: IsEqual<FileSystemMapping[K], FileSystem[K]>;
    }[keyof FileSystemMapping] extends true
        ? true
        : false
>;
type MappingIsNotFileSystem = Assert<FileSystemMapping extends FileSystem ? false : true>;
type MappingStateKeysAreExact = Assert<IsEqual<keyof FileSystemMappingState, 'bind'>>;
type MappingStateBindIsExact = Assert<
    IsEqual<FileSystemMappingState['bind'], (fileSystem: FileSystem) => FileSystemMapping>
>;

test('file system mapping type surface is exact', () => {
    const assertions: [
        MappingKeysAreExact,
        MappingSignaturesMatch,
        MappingIsNotFileSystem,
        MappingStateKeysAreExact,
        MappingStateBindIsExact
    ] = [true, true, true, true, true];
    expect(assertions).toStrictEqual([true, true, true, true, true]);
});

test('mapping state shares registrations while each view uses its own downstream filesystem', () => {
    const publicRoot = UriEx.file(normalizeSlashes('/public/pkg'));
    const originalRoot = UriEx.file(normalizeSlashes('/original/pkg'));
    const publicFile = publicRoot.combinePaths('file.py');
    const originalFile = originalRoot.combinePaths('file.py');
    const firstFs = new TestFileSystem(/* ignoreCase */ false, {
        cwd: normalizeSlashes('/'),
        files: { [originalFile.getFilePath()]: 'first' },
    });
    const secondFs = new TestFileSystem(/* ignoreCase */ false, {
        cwd: normalizeSlashes('/'),
        files: { [originalFile.getFilePath()]: 'second' },
    });
    const state = createFileSystemMappingState();
    const first = state.bind(firstFs);
    const second = state.bind(secondFs);
    const filterCalls: Array<{ uri: Uri; fileSystem: FileSystem }> = [];
    const mapping = first.mapDirectory(publicRoot, originalRoot, (uri, fileSystem) => {
        filterCalls.push({ uri, fileSystem });
        return true;
    });

    expect(first.isMappedUri(publicFile)).toBe(true);
    expect(second.isMappedUri(publicFile)).toBe(true);
    expect(first.readFileSync(publicFile, 'utf8')).toBe('first');
    expect(second.readFileSync(publicFile, 'utf8')).toBe('second');
    expect(filterCalls.some((call) => call.uri.equals(originalFile) && call.fileSystem === firstFs)).toBe(true);
    expect(filterCalls.some((call) => call.uri.equals(originalFile) && call.fileSystem === secondFs)).toBe(true);

    mapping.dispose();
    expect(first.isMappedUri(publicFile)).toBe(false);
    expect(second.isMappedUri(publicFile)).toBe(false);
});

test('mapping state invalidates shared cached misses for sync and async reads when a mapping is added', async () => {
    const publicRoot = UriEx.file(normalizeSlashes('/public/pkg'));
    const originalRoot = UriEx.file(normalizeSlashes('/original/pkg'));
    const publicFile = publicRoot.combinePaths('file.py');
    const originalFile = originalRoot.combinePaths('file.py');
    const fs = new TestFileSystem(/* ignoreCase */ false, {
        cwd: normalizeSlashes('/'),
        files: {
            [publicFile.getFilePath()]: 'public',
            [originalFile.getFilePath()]: 'original',
        },
    });
    const state = createFileSystemMappingState();
    const first = state.bind(fs);
    const second = state.bind(fs);

    expect(first.readFileSync(publicFile, 'utf8')).toBe('public');
    expect((await second.readFile(publicFile)).toString()).toBe('public');
    await expect(second.readFileText(publicFile, 'utf8')).resolves.toBe('public');

    first.mapDirectory(publicRoot, originalRoot);

    expect(second.readFileSync(publicFile, 'utf8')).toBe('original');
    expect((await first.readFile(publicFile)).toString()).toBe('original');
    await expect(first.readFileText(publicFile, 'utf8')).resolves.toBe('original');
});

test('mapping state preserves replacement and stale-handle disposal across bound views', () => {
    const publicRoot = UriEx.file(normalizeSlashes('/public/pkg'));
    const firstOriginal = UriEx.file(normalizeSlashes('/original/first'));
    const secondOriginal = UriEx.file(normalizeSlashes('/original/second'));
    const publicFile = publicRoot.combinePaths('file.py');
    const fs = new TestFileSystem(/* ignoreCase */ false, {
        cwd: normalizeSlashes('/'),
        files: {
            [publicFile.getFilePath()]: 'public',
            [firstOriginal.combinePaths('file.py').getFilePath()]: 'first',
            [secondOriginal.combinePaths('file.py').getFilePath()]: 'second',
        },
    });
    const state = createFileSystemMappingState();
    const first = state.bind(fs);
    const second = state.bind(fs);
    const stale = first.mapDirectory(publicRoot, firstOriginal);
    expect(second.readFileSync(publicFile, 'utf8')).toBe('first');

    second.mapDirectory(publicRoot, secondOriginal);
    expect(first.readFileSync(publicFile, 'utf8')).toBe('second');

    stale.dispose();
    expect(first.isMappedUri(publicFile)).toBe(false);
    expect(second.isMappedUri(publicFile)).toBe(false);
    expect(second.readFileSync(publicFile, 'utf8')).toBe('public');
});

test('independent mapping states remain isolated over the same downstream filesystem', () => {
    const firstPublic = UriEx.file(normalizeSlashes('/public/first'));
    const secondPublic = UriEx.file(normalizeSlashes('/public/second'));
    const firstOriginal = UriEx.file(normalizeSlashes('/original/first'));
    const secondOriginal = UriEx.file(normalizeSlashes('/original/second'));
    const fs = new TestFileSystem(/* ignoreCase */ false, {
        cwd: normalizeSlashes('/'),
        files: {
            [firstOriginal.combinePaths('file.py').getFilePath()]: 'first',
            [secondOriginal.combinePaths('file.py').getFilePath()]: 'second',
        },
    });
    const first = createFileSystemMappingState().bind(fs);
    const second = createFileSystemMappingState().bind(fs);
    first.mapDirectory(firstPublic, firstOriginal);
    second.mapDirectory(secondPublic, secondOriginal);

    expect(first.isMappedUri(firstPublic)).toBe(true);
    expect(first.isMappedUri(secondPublic)).toBe(false);
    expect(second.isMappedUri(firstPublic)).toBe(false);
    expect(second.isMappedUri(secondPublic)).toBe(true);
});

test('compatibility mapping factory creates isolated state for every call', () => {
    const publicRoot = UriEx.file(normalizeSlashes('/public/pkg'));
    const originalRoot = UriEx.file(normalizeSlashes('/original/pkg'));
    const publicFile = publicRoot.combinePaths('file.py');
    const fs = new TestFileSystem(/* ignoreCase */ false, {
        cwd: normalizeSlashes('/'),
        files: { [originalRoot.combinePaths('file.py').getFilePath()]: 'content' },
    });
    const first = createFileSystemMapping(fs);
    const second = createFileSystemMapping(fs);

    first.mapDirectory(publicRoot, originalRoot);

    expect(first.isMappedUri(publicFile)).toBe(true);
    expect(second.isMappedUri(publicFile)).toBe(false);
});

test('file system mapping translates children, filters originals, and disposes mappings', () => {
    const publicRoot = UriEx.file(normalizeSlashes('/public/pkg'));
    const originalRoot = UriEx.file(normalizeSlashes('/original/pkg'));
    const publicFile = publicRoot.combinePaths('file.py');
    const originalFile = originalRoot.combinePaths('file.py');
    const deniedPublic = publicRoot.combinePaths('denied.py');
    const deniedOriginal = originalRoot.combinePaths('denied.py');
    const fs = new TestFileSystem(/* ignoreCase */ false, {
        cwd: normalizeSlashes('/'),
        files: {
            [originalFile.getFilePath()]: 'original',
            [deniedOriginal.getFilePath()]: 'denied original',
            [deniedPublic.getFilePath()]: 'public fallback',
        },
    });
    const mapping = createFileSystemMapping(fs);
    const filterCalls: Array<{ uri: Uri; fileSystem: FileSystem }> = [];
    const disposable = mapping.mapDirectory(publicRoot, originalRoot, (uri, fileSystem) => {
        filterCalls.push({ uri, fileSystem });
        return !uri.equals(deniedOriginal);
    });

    const equalPublicFile = UriEx.file(publicFile.getFilePath());
    expect(equalPublicFile).not.toBe(publicFile);
    expect(mapping.isMappedUri(equalPublicFile)).toBe(true);
    expect(mapping.getOriginalUri(equalPublicFile).equals(originalFile)).toBe(true);
    expect(mapping.getMappedUri(UriEx.file(originalFile.getFilePath())).equals(publicFile)).toBe(true);
    expect(mapping.readFileSync(publicFile, 'utf8')).toBe('original');
    expect(mapping.existsSync(originalFile)).toBe(false);
    expect(() => mapping.statSync(originalFile)).toThrow('ENOENT: path does not exist');

    expect(mapping.isMappedUri(deniedPublic)).toBe(true);
    expect(mapping.getMappedUri(deniedOriginal).equals(deniedOriginal)).toBe(true);
    expect(mapping.existsSync(deniedOriginal)).toBe(true);
    expect(mapping.readFileSync(deniedPublic, 'utf8')).toBe('public fallback');
    expect(filterCalls.some((call) => call.uri.equals(originalFile) && call.fileSystem === fs)).toBe(true);
    expect(filterCalls.some((call) => call.uri.equals(deniedOriginal) && call.fileSystem === fs)).toBe(true);

    disposable.dispose();
    expect(mapping.isMappedUri(publicFile)).toBe(false);
    expect(mapping.existsSync(originalFile)).toBe(true);
});

test('file system mapping follows URI case-sensitivity semantics', () => {
    const fs = new TestFileSystem(/* ignoreCase */ false, { cwd: normalizeSlashes('/') });
    const mapping = createFileSystemMapping(fs);
    const sensitiveMapped = UriEx.file(normalizeSlashes('/Public/Sensitive'), /* isCaseSensitive */ true);
    const sensitiveOriginal = UriEx.file(normalizeSlashes('/Original/Sensitive'), true);
    const insensitiveMapped = UriEx.file(normalizeSlashes('/Public/Insensitive'), /* isCaseSensitive */ false);
    const insensitiveOriginal = UriEx.file(normalizeSlashes('/Original/Insensitive'), false);
    mapping.mapDirectory(sensitiveMapped, sensitiveOriginal);
    mapping.mapDirectory(insensitiveMapped, insensitiveOriginal);

    const sensitiveMismatch = UriEx.file(normalizeSlashes('/public/sensitive/file.py'), true);
    const insensitiveAlias = UriEx.file(normalizeSlashes('/PUBLIC/INSENSITIVE/file.py'), false);

    expect(mapping.getOriginalUri(sensitiveMismatch)).toBe(sensitiveMismatch);
    expect(
        mapping
            .getOriginalUri(insensitiveAlias)
            .equals(UriEx.file(normalizeSlashes('/Original/Insensitive/file.py'), false))
    ).toBe(true);
});

test('file system mapping uses closest parents and exact-root realpath behavior', () => {
    const publicRoot = UriEx.file(normalizeSlashes('/public/pkg'));
    const originalRoot = UriEx.file(normalizeSlashes('/original/pkg'));
    const nestedPublic = publicRoot.combinePaths('nested');
    const nestedOriginal = UriEx.file(normalizeSlashes('/nested-source'));
    const nestedFile = nestedPublic.combinePaths('file.py');
    const siblingFile = publicRoot.combinePaths('nestedish', 'file.py');
    const fs = new TestFileSystem(/* ignoreCase */ false, {
        cwd: normalizeSlashes('/'),
        files: {
            [nestedOriginal.combinePaths('file.py').getFilePath()]: 'nested',
            [originalRoot.combinePaths('nested', 'file.py').getFilePath()]: 'parent nested',
            [originalRoot.combinePaths('nestedish', 'file.py').getFilePath()]: 'sibling',
        },
    });
    const realpathSync = jest.spyOn(fs, 'realpathSync').mockImplementation((uri) => uri);
    const mapping = createFileSystemMapping(fs);
    mapping.mapDirectory(publicRoot, originalRoot);
    expect(mapping.readFileSync(nestedFile, 'utf8')).toBe('parent nested');

    const nested = mapping.mapDirectory(nestedPublic, nestedOriginal);

    expect(mapping.readFileSync(nestedFile, 'utf8')).toBe('nested');
    expect(mapping.readFileSync(siblingFile, 'utf8')).toBe('sibling');
    expect(mapping.realpathSync(publicRoot)).toBe(publicRoot);
    expect(mapping.realpathSync(nestedFile)).toBe(nestedFile);
    expect(realpathSync).toHaveBeenCalledTimes(1);
    expect(realpathSync).toHaveBeenCalledWith(nestedFile);

    nested.dispose();
    expect(mapping.readFileSync(nestedFile, 'utf8')).toBe('parent nested');
});

test('file system mapping preserves stale and independent disposable behavior', () => {
    const publicRoot = UriEx.file(normalizeSlashes('/public/pkg'));
    const firstOriginal = UriEx.file(normalizeSlashes('/original/first'));
    const secondOriginal = UriEx.file(normalizeSlashes('/original/second'));
    const otherPublic = UriEx.file(normalizeSlashes('/public/other'));
    const otherOriginal = UriEx.file(normalizeSlashes('/original/other'));
    const publicFile = publicRoot.combinePaths('file.py');
    const fs = new TestFileSystem(/* ignoreCase */ false, {
        cwd: normalizeSlashes('/'),
        files: {
            [publicFile.getFilePath()]: 'public',
            [firstOriginal.combinePaths('file.py').getFilePath()]: 'first',
            [secondOriginal.combinePaths('file.py').getFilePath()]: 'second',
            [otherOriginal.combinePaths('file.py').getFilePath()]: 'other',
        },
    });
    const mapping = createFileSystemMapping(fs);
    const stale = mapping.mapDirectory(publicRoot, firstOriginal);
    expect(mapping.readFileSync(publicFile, 'utf8')).toBe('first');
    mapping.mapDirectory(publicRoot, secondOriginal);
    expect(mapping.readFileSync(publicFile, 'utf8')).toBe('second');
    const other = mapping.mapDirectory(otherPublic, otherOriginal);

    stale.dispose();
    expect(mapping.isMappedUri(publicFile)).toBe(false);
    expect(mapping.readFileSync(publicFile, 'utf8')).toBe('public');
    expect(mapping.readFileSync(otherPublic.combinePaths('file.py'), 'utf8')).toBe('other');
    other.dispose();
    expect(mapping.existsSync(otherOriginal.combinePaths('file.py'))).toBe(true);
});

test('file system mapping synthesizes and merges classified directory entries', () => {
    const publicParent = UriEx.file(normalizeSlashes('/public'));
    const publicRoot = publicParent.combinePaths('pkg');
    const originalRoot = UriEx.file(normalizeSlashes('/original/pkg'));
    const linkedTarget = UriEx.file(normalizeSlashes('/targets/linked.pyi'));
    const linkedPath = originalRoot.combinePaths('linked.pyi').getFilePath();
    const missingPath = originalRoot.combinePaths('missing.pyi').getFilePath();
    const fs = new TestFileSystem(/* ignoreCase */ false, { cwd: normalizeSlashes('/') });
    fs.mkdirpSync(originalRoot.getFilePath());
    fs.mkdirpSync(publicRoot.getFilePath());
    fs.mkdirpSync(linkedTarget.getDirectory().getFilePath());
    fs.mkdirpSync(originalRoot.combinePaths('subdir').getFilePath());
    fs.writeFileSync(linkedTarget, 'linked');
    fs.writeFileSync(originalRoot.combinePaths('dup.pyi'), 'mapped duplicate');
    fs.writeFileSync(publicRoot.combinePaths('dup.pyi'), 'real duplicate');
    fs.writeFileSync(publicRoot.combinePaths('real.py'), 'real');
    fs.symlinkSync(linkedTarget.getFilePath(), linkedPath);
    fs.symlinkSync(normalizeSlashes('/targets/missing.pyi'), missingPath);
    const originalEntries = fs.readdirEntriesSync(originalRoot);
    const publicEntries = fs.readdirEntriesSync(publicRoot);
    const parentEntriesFromBase = fs.readdirEntriesSync(publicParent);
    const realDuplicate = publicEntries.find((entry) => entry.name === 'dup.pyi');
    jest.spyOn(fs, 'readdirEntriesSync').mockImplementation((uri) => {
        if (uri.equals(originalRoot)) {
            return originalEntries;
        }
        if (uri.equals(publicRoot)) {
            return publicEntries;
        }
        if (uri.equals(publicParent)) {
            return parentEntriesFromBase;
        }
        return [];
    });
    const mapping = createFileSystemMapping(fs);
    mapping.mapDirectory(
        publicRoot,
        originalRoot,
        (uri) => uri.equals(originalRoot) || uri.fileName === 'subdir' || uri.fileName.endsWith('.pyi')
    );

    const parentEntries = mapping.readdirEntriesSync(publicParent);
    expect(parentEntries.map((entry) => entry.name)).toStrictEqual(['pkg']);
    expect(parentEntries[0].isDirectory()).toBe(true);
    expect((parentEntries[0] as { parentPath?: string }).parentPath).toBe(publicParent.getFilePath());

    const entries = mapping.readdirEntriesSync(publicRoot);
    expect(entries.map((entry) => entry.name)).toStrictEqual(['dup.pyi', 'linked.pyi', 'subdir', 'real.py']);
    expect(entries[0]).toBe(realDuplicate);
    expect(entries[1].isFile()).toBe(true);
    expect(entries[1].isSymbolicLink()).toBe(false);
    expect(entries[2].isDirectory()).toBe(true);
    expect(entries.some((entry) => entry.name === 'missing.pyi')).toBe(false);
});

test('file system mapping synthesizes a mapped child with no public backing directory', () => {
    const publicParent = UriEx.file(normalizeSlashes('/public'));
    const publicRoot = publicParent.combinePaths('pkg');
    const originalRoot = UriEx.file(normalizeSlashes('/original/pkg'));
    const fs = new TestFileSystem(/* ignoreCase */ false, {
        cwd: normalizeSlashes('/'),
        files: { [originalRoot.combinePaths('file.py').getFilePath()]: 'content' },
    });
    expect(fs.existsSync(publicParent)).toBe(false);
    const mapping = createFileSystemMapping(fs);
    mapping.mapDirectory(publicRoot, originalRoot);

    const entries = mapping.readdirEntriesSync(publicParent);
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe('pkg');
    expect(entries[0].isDirectory()).toBe(true);
    expect(entries[0].isFile()).toBe(false);
    expect((entries[0] as { parentPath?: string }).parentPath).toBe(publicParent.getFilePath());
});

test('file system mapping synthesizes only direct mapped children', () => {
    const publicParent = UriEx.file(normalizeSlashes('/public'));
    const intermediate = publicParent.combinePaths('a');
    const mappedRoot = intermediate.combinePaths('pkg');
    const originalRoot = UriEx.file(normalizeSlashes('/original/pkg'));
    const fs = new TestFileSystem(/* ignoreCase */ false, {
        cwd: normalizeSlashes('/'),
        files: { [originalRoot.combinePaths('file.py').getFilePath()]: 'content' },
    });
    fs.mkdirpSync(intermediate.getFilePath());
    const mapping = createFileSystemMapping(fs);
    mapping.mapDirectory(mappedRoot, originalRoot);

    expect(mapping.readdirEntriesSync(publicParent).map((entry) => entry.name)).toStrictEqual(['a']);
});

test('file system mapping hides allowed original roots from their real parent listing', () => {
    const publicRoot = UriEx.file(normalizeSlashes('/public/pkg'));
    const originalParent = UriEx.file(normalizeSlashes('/original'));
    const originalRoot = originalParent.combinePaths('pkg');
    const visibleSibling = originalParent.combinePaths('visible');
    const fs = new TestFileSystem(/* ignoreCase */ false, {
        cwd: normalizeSlashes('/'),
        files: {
            [originalRoot.combinePaths('file.py').getFilePath()]: 'content',
            [visibleSibling.combinePaths('file.py').getFilePath()]: 'visible',
        },
    });
    const mapping = createFileSystemMapping(fs);
    mapping.mapDirectory(publicRoot, originalRoot);

    expect(mapping.readdirEntriesSync(originalParent).map((entry) => entry.name)).toStrictEqual(['visible']);
});

test('file system mapping preserves read, metadata, stream, and promise identities', async () => {
    const publicRoot = UriEx.file(normalizeSlashes('/public/pkg'));
    const originalRoot = UriEx.file(normalizeSlashes('/original/pkg'));
    const publicFile = publicRoot.combinePaths('file.py');
    const originalFile = originalRoot.combinePaths('file.py');
    const fs = new TestFileSystem(/* ignoreCase */ false, { cwd: normalizeSlashes('/') });
    const bufferResult = Buffer.from('binary');
    const statResult = {} as Stats;
    const streamResult = {} as ReadStream;
    const readPromise = Promise.resolve(bufferResult);
    const textPromise = Promise.resolve('text');
    const readFileSync = jest
        .spyOn(fs, 'readFileSync')
        .mockImplementation((_uri, encoding) => (encoding ? 'text' : bufferResult));
    const statSync = jest.spyOn(fs, 'statSync').mockReturnValue(statResult as never);
    const createReadStream = jest.spyOn(fs, 'createReadStream').mockReturnValue(streamResult);
    const readFile = jest.spyOn(fs, 'readFile').mockReturnValue(readPromise);
    const readFileText = jest.spyOn(fs, 'readFileText').mockReturnValue(textPromise);
    const mapping = createFileSystemMapping(fs);
    mapping.mapDirectory(publicRoot, originalRoot);

    expect(mapping.readFileSync(publicFile)).toBe(bufferResult);
    expect(mapping.readFileSync(publicFile, null)).toBe(bufferResult);
    expect(mapping.readFileSync(publicFile, 'latin1')).toBe('text');
    expect(mapping.statSync(publicFile)).toBe(statResult);
    expect(mapping.createReadStream(publicFile)).toBe(streamResult);
    expect(mapping.readFile(publicFile)).toBe(readPromise);
    expect(mapping.readFileText(publicFile)).toBe(textPromise);
    expect(mapping.readFileText(publicFile, 'latin1')).toBe(textPromise);
    expect(readFileSync.mock.calls).toStrictEqual([
        [originalFile, undefined],
        [originalFile, null],
        [originalFile, 'latin1'],
    ]);
    expect(statSync).toHaveBeenCalledTimes(1);
    expect(statSync).toHaveBeenCalledWith(originalFile);
    expect(createReadStream).toHaveBeenCalledTimes(1);
    expect(createReadStream).toHaveBeenCalledWith(originalFile);
    expect(readFile).toHaveBeenCalledTimes(1);
    expect(readFile).toHaveBeenCalledWith(originalFile);
    expect(readFileText.mock.calls).toStrictEqual([
        [originalFile, undefined],
        [originalFile, 'latin1'],
    ]);

    const syncFailure = new Error('sync failure');
    readFileSync.mockImplementation(() => {
        throw syncFailure;
    });
    expect(captureThrownValue(() => mapping.readFileSync(publicFile, 'utf8'))).toBe(syncFailure);
    const rejection = new Error('rejection');
    const rejectedRead = Promise.reject<Buffer>(rejection);
    readFile.mockReturnValue(rejectedRead);
    const actualRejectedRead = mapping.readFile(publicFile);
    expect(actualRejectedRead).toBe(rejectedRead);
    await expect(actualRejectedRead).rejects.toBe(rejection);
});

test('cached structural resolutions evaluate live filters for every sync and async read', async () => {
    const publicRoot = UriEx.file(normalizeSlashes('/public/pkg'));
    const originalRoot = UriEx.file(normalizeSlashes('/original/pkg'));
    const publicFile = publicRoot.combinePaths('file.py');
    const originalFile = originalRoot.combinePaths('file.py');
    const fs = new TestFileSystem(/* ignoreCase */ false, { cwd: normalizeSlashes('/') });
    const readFileSync = jest.spyOn(fs, 'readFileSync').mockReturnValue('content');
    const readFile = jest.spyOn(fs, 'readFile').mockResolvedValue(Buffer.from('content'));
    const readFileText = jest.spyOn(fs, 'readFileText').mockResolvedValue('content');
    const filterCalls: Uri[] = [];
    let visible = true;
    const mapping = createFileSystemMapping(fs);
    mapping.mapDirectory(publicRoot, originalRoot, (uri) => {
        filterCalls.push(uri);
        return visible;
    });

    expect(mapping.readFileSync(publicFile, 'utf8')).toBe('content');
    await expect(mapping.readFile(publicFile)).resolves.toEqual(Buffer.from('content'));
    await expect(mapping.readFileText(publicFile, 'utf8')).resolves.toBe('content');
    visible = false;
    expect(mapping.readFileSync(publicFile, 'utf8')).toBe('content');
    await expect(mapping.readFile(publicFile)).resolves.toEqual(Buffer.from('content'));
    await expect(mapping.readFileText(publicFile, 'utf8')).resolves.toBe('content');

    expect(filterCalls).toStrictEqual([
        originalFile,
        originalFile,
        originalFile,
        originalFile,
        originalFile,
        originalFile,
    ]);
    expect(readFileSync.mock.calls.map(([uri]) => uri)).toStrictEqual([originalFile, publicFile]);
    expect(readFile.mock.calls.map(([uri]) => uri)).toStrictEqual([originalFile, publicFile]);
    expect(readFileText.mock.calls.map(([uri]) => uri)).toStrictEqual([originalFile, publicFile]);
});

test('file system mapping keeps internal reads distinct from chained public URI translation', () => {
    const physicalRoot = UriEx.file(normalizeSlashes('/physical/pkg'));
    const innerPublicRoot = UriEx.file(normalizeSlashes('/inner/pkg'));
    const outerPublicRoot = UriEx.file(normalizeSlashes('/outer/pkg'));
    const physicalFile = physicalRoot.combinePaths('file.py');
    const innerPublicFile = innerPublicRoot.combinePaths('file.py');
    const outerPublicFile = outerPublicRoot.combinePaths('file.py');
    const raw = new TestFileSystem(/* ignoreCase */ false, {
        cwd: normalizeSlashes('/'),
        files: { [physicalFile.getFilePath()]: 'physical' },
    });
    const inner = new PyrightFileSystem(raw);
    inner.mapDirectory(innerPublicRoot, physicalRoot);
    const getOriginalUri = jest.spyOn(inner, 'getOriginalUri');
    const mapping = createFileSystemMapping(inner);
    mapping.mapDirectory(outerPublicRoot, innerPublicRoot);

    expect(mapping.isMappedUri(innerPublicFile)).toBe(true);
    expect(mapping.getMappedUri(physicalFile).equals(innerPublicFile)).toBe(true);
    expect(mapping.readFileSync(outerPublicFile, 'utf8')).toBe('physical');
    expect(getOriginalUri).not.toHaveBeenCalled();
    expect(mapping.getOriginalUri(outerPublicFile).equals(physicalFile)).toBe(true);
    expect(getOriginalUri).toHaveBeenCalledTimes(1);
    expect(getOriginalUri).toHaveBeenCalledWith(innerPublicFile);
});

function captureThrownValue(callback: () => unknown): unknown {
    try {
        callback();
    } catch (error) {
        return error;
    }
    throw new Error('Expected callback to throw');
}
