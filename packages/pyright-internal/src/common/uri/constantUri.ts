/*
 * constantUri.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * URI class that represents a constant/marker URI.
 */

import { BaseUri } from './baseUri';
import { Uri } from './uri';

export class ConstantUri extends BaseUri {
    constructor(name: string) {
        super(name);
    }

    override get scheme(): string {
        return '';
    }

    override get isCaseSensitive(): boolean {
        return true;
    }

    override get fileName(): string {
        return '';
    }

    override get lastExtension(): string {
        return '';
    }

    override get root(): Uri {
        return this;
    }

    override get fragment(): string {
        return '';
    }

    override get query(): string {
        return '';
    }

    override equals(other: Uri | undefined): boolean {
        // For constant Uri, reference equality must be used instead of value equality.
        return this === other;
    }

    override toJsonObj() {
        throw new Error(`constant uri can't be serialized`);
    }

    override toString(): string {
        return this.key;
    }

    override toUserVisibleString(): string {
        return '';
    }

    override matchesRegex(regex: RegExp): boolean {
        return false;
    }

    override withFragment(fragment: string): Uri {
        return this;
    }

    override withQuery(query: string): Uri {
        return this;
    }

    override addPath(extra: string): Uri {
        return this;
    }

    override getDirectory(): Uri {
        return this;
    }

    override isRoot(): boolean {
        return false;
    }

    override isChild(parent: Uri, ignoreCase?: boolean | undefined): boolean {
        return false;
    }

    override isLocal(): boolean {
        return false;
    }

    override startsWith(other: Uri | undefined, ignoreCase?: boolean | undefined): boolean {
        return false;
    }

    override getPathLength(): number {
        return 0;
    }

    override resolvePaths(...paths: string[]): Uri {
        return this;
    }

    override combinePaths(...paths: string[]): Uri {
        return this;
    }

    override combinePathsUnsafe(...paths: string[]): Uri {
        return this;
    }

    override getPath(): string {
        return '';
    }

    override getFilePath(): string {
        return '';
    }

    override stripExtension(): Uri {
        return this;
    }

    override stripAllExtensions(): Uri {
        return this;
    }

    protected override getRootPath(): string {
        return '';
    }

    protected override getComparablePath(): string {
        return '';
    }

    protected override getPathComponentsImpl(): string[] {
        return [];
    }
}
