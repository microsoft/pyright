/*
 * emptyUri.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * URI class that represents an empty URI.
 */

import * as debug from '../debug';
import { BaseUri } from './baseUri';
import { Uri } from './uri';

const EmptyKey = '<empty>';

export class EmptyUri extends BaseUri {
    private static _instance = new EmptyUri();
    private constructor() {
        super(EmptyKey);
    }

    static get instance() {
        return EmptyUri._instance;
    }

    override get scheme(): string {
        return '';
    }
    get isCaseSensitive(): boolean {
        return true;
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
        debug.fail(`EmptyUri.getFilePath() should not be called.`);
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
    override getDirectoryImpl(): Uri {
        return this;
    }
    override isRoot(): boolean {
        return false;
    }
    override isChild(parent: Uri, ignoreCase: boolean): boolean {
        return false;
    }
    override startsWith(other: Uri | undefined, ignoreCase: boolean): boolean {
        return false;
    }
    override getPathLength(): number {
        return 0;
    }
    override combinePathsImpl(...paths: string[]): Uri {
        return this;
    }
    override getShortenedFileName(maxDirLength: number): string {
        return '';
    }
    override stripExtension(): Uri {
        return this;
    }
    protected override getPathComponentsImpl(): string[] {
        return [];
    }
    protected override getRootPath(): string {
        return '';
    }
    protected override getComparablePathImpl(): string {
        return '';
    }
    protected override getRootImpl(): Uri {
        return this;
    }
    protected override getBasenameImpl(): string {
        return '';
    }
    protected override getExtnameImpl(): string {
        return '';
    }
}
