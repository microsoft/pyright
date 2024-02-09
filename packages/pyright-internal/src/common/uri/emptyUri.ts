/*
 * emptyUri.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * URI class that represents an empty URI.
 */

import { JsonObjType } from './baseUri';
import { FileUri } from './fileUri';
import { Uri } from './uri';

const EmptyKey = '<empty>';

export class EmptyUri extends FileUri {
    private static _instance = new EmptyUri();
    private constructor() {
        super(EmptyKey, '', '', '', undefined, /* isCaseSensitive */ true);
    }

    static get instance() {
        return EmptyUri._instance;
    }

    override get scheme(): string {
        return '';
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

    override toJsonObj(): JsonObjType {
        return {
            _key: EmptyKey,
        };
    }

    static isEmptyUri(uri: any): boolean {
        return uri?._key === EmptyKey;
    }

    override isEmpty(): boolean {
        return true;
    }

    override isLocal(): boolean {
        return false;
    }

    override getPath(): string {
        return '';
    }

    override getFilePath(): string {
        return '';
    }

    override toString(): string {
        return '';
    }

    override toUserVisibleString(): string {
        return '';
    }

    override matchesRegex(regex: RegExp): boolean {
        return false;
    }

    override replaceExtension(ext: string): Uri {
        return this;
    }
    override addPath(extra: string): Uri {
        return this;
    }

    override getDirectory(): Uri {
        return this;
    }

    override isRoot(): boolean {
        return true;
    }

    override isChild(parent: Uri): boolean {
        return false;
    }

    override startsWith(other: Uri | undefined): boolean {
        return false;
    }

    override getPathLength(): number {
        return 0;
    }

    override getShortenedFileName(maxDirLength: number): string {
        return '';
    }

    override stripExtension(): Uri {
        return this;
    }

    override withFragment(fragment: string): Uri {
        return this;
    }

    override withQuery(query: string): Uri {
        return this;
    }

    override stripAllExtensions(): Uri {
        return this;
    }

    protected override getPathComponentsImpl(): string[] {
        return [];
    }

    protected override normalizeSlashes(path: string): string {
        return '';
    }

    protected override getRootPath(): string {
        return '';
    }

    protected override getComparablePath(): string {
        return '';
    }
}
