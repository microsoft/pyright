/*
 * pathUtils.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 */

import { sep } from 'path';

import * as pu from '../../../common/pathUtils';
import { createIOError } from '../utils';
import { Uri } from '../../../common/uri/uri';

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
    Absolute = RequireRoot |
        AllowRoot |
        AllowDirname |
        AllowBasename |
        AllowExtname |
        AllowTrailingSeparator |
        AllowNavigation,

    /** Path may be relative or absolute */
    RelativeOrAbsolute = AllowRoot |
        AllowDirname |
        AllowBasename |
        AllowExtname |
        AllowTrailingSeparator |
        AllowNavigation,

    /** Path may only be a filename */
    Basename = RequireBasename | AllowExtname,
}

function validateComponents(components: string[], flags: ValidationFlags, hasTrailingSeparator: boolean) {
    const hasRoot = !!components[0];
    const hasDirname = components.length > 2;
    const hasBasename = components.length > 1;
    const hasExtname = hasBasename && extRegExp.test(components[components.length - 1]);
    const invalidComponentRegExp =
        flags & ValidationFlags.AllowNavigation
            ? flags & ValidationFlags.AllowWildcard
                ? invalidNavigableComponentWithWildcardsRegExp
                : invalidNavigableComponentRegExp
            : flags & ValidationFlags.AllowWildcard
            ? invalidNonNavigableComponentWithWildcardsRegExp
            : invalidNonNavigableComponentRegExp;

    // Validate required components
    if (flags & ValidationFlags.RequireRoot && !hasRoot) {
        return false;
    }
    if (flags & ValidationFlags.RequireDirname && !hasDirname) {
        return false;
    }
    if (flags & ValidationFlags.RequireBasename && !hasBasename) {
        return false;
    }
    if (flags & ValidationFlags.RequireExtname && !hasExtname) {
        return false;
    }
    if (flags & ValidationFlags.RequireTrailingSeparator && !hasTrailingSeparator) {
        return false;
    }

    // Required components indicate allowed components
    if (flags & ValidationFlags.RequireRoot) {
        flags |= ValidationFlags.AllowRoot;
    }
    if (flags & ValidationFlags.RequireDirname) {
        flags |= ValidationFlags.AllowDirname;
    }
    if (flags & ValidationFlags.RequireBasename) {
        flags |= ValidationFlags.AllowBasename;
    }
    if (flags & ValidationFlags.RequireExtname) {
        flags |= ValidationFlags.AllowExtname;
    }
    if (flags & ValidationFlags.RequireTrailingSeparator) {
        flags |= ValidationFlags.AllowTrailingSeparator;
    }

    // Validate disallowed components
    if (~flags & ValidationFlags.AllowRoot && hasRoot) {
        return false;
    }
    if (~flags & ValidationFlags.AllowDirname && hasDirname) {
        return false;
    }
    if (~flags & ValidationFlags.AllowBasename && hasBasename) {
        return false;
    }
    if (~flags & ValidationFlags.AllowExtname && hasExtname) {
        return false;
    }
    if (~flags & ValidationFlags.AllowTrailingSeparator && hasTrailingSeparator) {
        return false;
    }

    // Validate component strings
    if (invalidRootComponentRegExp.test(components[0])) {
        return false;
    }
    for (let i = 1; i < components.length; i++) {
        if (invalidComponentRegExp.test(components[i]) && components[i] !== Uri.DefaultWorkspaceRootComponent) {
            return false;
        }
    }

    return true;
}

export function validate(path: string, flags: ValidationFlags = ValidationFlags.RelativeOrAbsolute) {
    const components = pu.getPathComponents(path);
    const trailing = pu.hasTrailingDirectorySeparator(path);
    if (!validateComponents(components, flags, trailing)) {
        throw createIOError('ENOENT');
    }
    return components.length > 1 && trailing
        ? pu.combinePathComponents(pu.reducePathComponents(components)) + sep
        : pu.combinePathComponents(pu.reducePathComponents(components));
}

function getInvalidRootComponentRegExp(): RegExp {
    const escapedSeparator = pu.getRegexEscapedSeparator();
    return new RegExp(
        `^(?!(${escapedSeparator}|${escapedSeparator}${escapedSeparator}w+${escapedSeparator}|[a-zA-Z]:${escapedSeparator}?|)$)`
    );
}
