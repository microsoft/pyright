/*
 * uriInterface.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * URI interface definition (extracted to break circular dependency).
 */

export interface Uri {
    // Unique key for storing in maps.
    readonly key: string;

    // Returns the scheme of the URI.
    readonly scheme: string;

    // Returns the last segment of the URI, similar to the UNIX basename command.
    readonly fileName: string;

    // Returns the extension of the URI, similar to the UNIX extname command. This includes '.' on the extension.
    readonly lastExtension: string;

    // Returns a URI where the path just contains the root folder.
    readonly root: Uri;

    // Returns a URI where the path contains the directory name with .py appended.
    readonly packageUri: Uri;

    // Returns a URI where the path contains the directory name with .pyi appended.
    readonly packageStubUri: Uri;

    // Returns a URI where the path has __init__.py appended.
    readonly initPyUri: Uri;

    // Returns a URI where the path has __init__.pyi appended.
    readonly initPyiUri: Uri;

    // Returns a URI where the path has py.typed appended.
    readonly pytypedUri: Uri;

    // Returns the filename without any extensions
    readonly fileNameWithoutExtensions: string;

    // Indicates if the underlying file system for this URI is case sensitive or not.
    // This should never be used to create another Uri.
    // Use `CaseSensitivityDetector` when creating new Uri using `Uri.parse/file`
    readonly isCaseSensitive: boolean;

    // Returns the fragment part of a URI.
    readonly fragment: string;

    // Returns the query part of a URI.
    readonly query: string;

    isEmpty(): boolean;
    toString(): string;
    toUserVisibleString(): string;
    // Determines whether a path consists only of a path root.
    isRoot(): boolean;
    // Determines whether a Uri is a child of some parent Uri. Meaning the parent Uri is a prefix of this Uri.
    isChild(parent: Uri): boolean;
    isLocal(): boolean;
    isUntitled(): boolean;
    equals(other: Uri | undefined): boolean;
    // Returns true if the `other` is the parent of `this`. Meaning `other` is a prefix of `this`.
    startsWith(other: Uri | undefined): boolean;
    pathStartsWith(name: string): boolean;
    pathEndsWith(name: string): boolean;
    pathIncludes(include: string): boolean;
    matchesRegex(regex: RegExp): boolean;
    addPath(extra: string): Uri;
    // Returns a URI where the path is the directory name of the original URI, similar to the UNIX dirname command.
    getDirectory(): Uri;
    getRootPathLength(): number;
    // How long the path for this Uri is.
    getPathLength(): number;
    // Combines paths with the URI and resolves any relative paths. This should be used for combining paths with user input.
    // Input can be of the form `.` or `./` or `../` or `../foo` or `foo/bar` or `/foo/bar` or `c:\foo\bar` or `file:///foo/bar`
    // Meaning relative or rooted paths are allowed.
    resolvePaths(...paths: string[]): Uri;
    // Combines paths with the URI and resolves any relative paths. When the paths contain separators or '..', this will
    // use resolvePaths to combine the paths. Otherwise it calls the quicker version.
    combinePaths(...paths: string[]): Uri;
    // Combines paths with the URI and DOES NOT resolve any '..' or '.' in the path.
    // This should only be used when the input is known to be relative and contains no separators (as separators are not normalized)
    combinePathsUnsafe(...paths: string[]): Uri;
    getRelativePath(child: Uri): string | undefined;
    getPathComponents(): readonly string[];
    getPath(): string;
    getFilePath(): string;
    getRelativePathComponents(to: Uri): readonly string[];
    getShortenedFileName(maxDirLength?: number): string;
    stripExtension(): Uri;
    stripAllExtensions(): Uri;
    replaceExtension(ext: string): Uri;
    addExtension(ext: string): Uri;
    hasExtension(ext: string): boolean;
    containsExtension(ext: string): boolean;
    withFragment(fragment: string): Uri;
    withQuery(query: string): Uri;
    toJsonObj(): any;
}
