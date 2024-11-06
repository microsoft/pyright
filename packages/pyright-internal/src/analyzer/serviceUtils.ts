import { ReadOnlyFileSystem } from '../common/fileSystem';
import { configFileName, pyprojectTomlName } from '../common/pathConsts';
import { Uri } from '../common/uri/uri';
import { forEachAncestorDirectory } from '../common/uri/uriUtils';

export function findPyprojectTomlFileHereOrUp(fs: ReadOnlyFileSystem, searchPath: Uri): Uri | undefined {
    return forEachAncestorDirectory(searchPath, (ancestor) => findPyprojectTomlFile(fs, ancestor));
}

export function findPyprojectTomlFile(fs: ReadOnlyFileSystem, searchPath: Uri) {
    const fileName = searchPath.resolvePaths(pyprojectTomlName);
    if (fs.existsSync(fileName)) {
        return fs.realCasePath(fileName);
    }
    return undefined;
}

export function findConfigFileHereOrUp(fs: ReadOnlyFileSystem, searchPath: Uri): Uri | undefined {
    return forEachAncestorDirectory(searchPath, (ancestor) => findConfigFile(fs, ancestor));
}

export function findConfigFile(fs: ReadOnlyFileSystem, searchPath: Uri): Uri | undefined {
    const fileName = searchPath.resolvePaths(configFileName);
    if (fs.existsSync(fileName)) {
        return fs.realCasePath(fileName);
    }

    return undefined;
}
