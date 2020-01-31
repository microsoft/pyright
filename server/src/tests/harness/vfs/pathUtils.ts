/*
 * pathUtils.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 */

import * as path from "path"
import * as pu from "../../../common/pathUtils"
import { createIOError } from "../io";

// I am not sure why this is done this way. for now, I am keeping original structure.
// it might have needed in typescript as a way to mock these operations?
export import FileSystemEntries = pu.FileSystemEntries;

export import sep = path.sep;
export import normalizeSeparators = pu.normalizeSlashes;
export import isAbsolute = pu.isRootedDiskPath;
export import isRoot = pu.isDiskPathRoot;
export import hasTrailingSeparator = pu.hasTrailingDirectorySeparator;
export import addTrailingSeparator = pu.ensureTrailingDirectorySeparator;
export import stripTrailingSeparator = pu.stripTrailingDirectorySeparator;
export import normalize = pu.normalizePath;
export import combine = pu.combinePaths;
export import parse = pu.getPathComponents;
export import reduce = pu.reducePathComponents;
export import format = pu.combinePathComponents;
export import resolve = pu.resolvePaths;
export import compare = pu.comparePaths;
export import compareCaseSensitive = pu.comparePathsCaseSensitive;
export import compareCaseInsensitive = pu.comparePathsCaseInsensitive;
export import dirname = pu.getDirectoryPath;
export import basename = pu.getBaseFileName;
export import extname = pu.getAnyExtensionFromPath;
export import relative = pu.getRelativePathFromDirectory;
export import beneath = pu.containsPath;
export import changeExtension = pu.changeAnyExtension;

const invalidRootComponentRegExp = getInvalidRootComponentRegExp();
const invalidNavigableComponentRegExp = /[:*?"<>|]/;
const invalidNavigableComponentWithWildcardsRegExp = /[:"<>|]/;
const invalidNonNavigableComponentRegExp = /^\.{1,2}$|[:*?"<>|]/;
const invalidNonNavigableComponentWithWildcardsRegExp = /^\.{1,2}$|[:"<>|]/;
const extRegExp = /\.\w+$/;

export const enum ValidationFlags {
    None = 0,

    RequireRoot = 1 << 0,
    RequireDirname = 1 << 1,
    RequireBasename = 1 << 2,
    RequireExtname = 1 << 3,
    RequireTrailingSeparator = 1 << 4,

    AllowRoot = 1 << 5,
    AllowDirname = 1 << 6,
    AllowBasename = 1 << 7,
    AllowExtname = 1 << 8,
    AllowTrailingSeparator = 1 << 9,
    AllowNavigation = 1 << 10,
    AllowWildcard = 1 << 11,

    /** Path must be a valid directory root */
    Root = RequireRoot | AllowRoot | AllowTrailingSeparator,

    /** Path must be a absolute */
    Absolute = RequireRoot | AllowRoot | AllowDirname | AllowBasename | AllowExtname | AllowTrailingSeparator | AllowNavigation,

    /** Path may be relative or absolute */
    RelativeOrAbsolute = AllowRoot | AllowDirname | AllowBasename | AllowExtname | AllowTrailingSeparator | AllowNavigation,

    /** Path may only be a filename */
    Basename = RequireBasename | AllowExtname,
}

function validateComponents(components: string[], flags: ValidationFlags, hasTrailingSeparator: boolean) {
    const hasRoot = !!components[0];
    const hasDirname = components.length > 2;
    const hasBasename = components.length > 1;
    const hasExtname = hasBasename && extRegExp.test(components[components.length - 1]);
    const invalidComponentRegExp = flags & ValidationFlags.AllowNavigation
        ? flags & ValidationFlags.AllowWildcard ? invalidNavigableComponentWithWildcardsRegExp : invalidNavigableComponentRegExp
        : flags & ValidationFlags.AllowWildcard ? invalidNonNavigableComponentWithWildcardsRegExp : invalidNonNavigableComponentRegExp;

    // Validate required components
    if (flags & ValidationFlags.RequireRoot && !hasRoot) return false;
    if (flags & ValidationFlags.RequireDirname && !hasDirname) return false;
    if (flags & ValidationFlags.RequireBasename && !hasBasename) return false;
    if (flags & ValidationFlags.RequireExtname && !hasExtname) return false;
    if (flags & ValidationFlags.RequireTrailingSeparator && !hasTrailingSeparator) return false;

    // Required components indicate allowed components
    if (flags & ValidationFlags.RequireRoot) flags |= ValidationFlags.AllowRoot;
    if (flags & ValidationFlags.RequireDirname) flags |= ValidationFlags.AllowDirname;
    if (flags & ValidationFlags.RequireBasename) flags |= ValidationFlags.AllowBasename;
    if (flags & ValidationFlags.RequireExtname) flags |= ValidationFlags.AllowExtname;
    if (flags & ValidationFlags.RequireTrailingSeparator) flags |= ValidationFlags.AllowTrailingSeparator;

    // Validate disallowed components
    if (~flags & ValidationFlags.AllowRoot && hasRoot) return false;
    if (~flags & ValidationFlags.AllowDirname && hasDirname) return false;
    if (~flags & ValidationFlags.AllowBasename && hasBasename) return false;
    if (~flags & ValidationFlags.AllowExtname && hasExtname) return false;
    if (~flags & ValidationFlags.AllowTrailingSeparator && hasTrailingSeparator) return false;

    // Validate component strings
    if (invalidRootComponentRegExp.test(components[0])) return false;
    for (let i = 1; i < components.length; i++) {
        if (invalidComponentRegExp.test(components[i])) return false;
    }

    return true;
}

export function validate(path: string, flags: ValidationFlags = ValidationFlags.RelativeOrAbsolute) {
    const components = parse(path);
    const trailing = hasTrailingSeparator(path);
    if (!validateComponents(components, flags, trailing)) throw createIOError("ENOENT");
    return components.length > 1 && trailing ? format(reduce(components)) + sep : format(reduce(components));
}

function getInvalidRootComponentRegExp(): RegExp {
    const escapedSeparator = pu.getRegexEscapedSeparator();
    return new RegExp(`^(?!(${ escapedSeparator }|${ escapedSeparator }${ escapedSeparator }w+${ escapedSeparator }|[a-zA-Z]:${ escapedSeparator }?|)$)`);
}
