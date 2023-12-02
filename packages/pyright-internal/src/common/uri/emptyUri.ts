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
    override get filename(): string {
        return '';
    }
    override get extname(): string {
        return '';
    }
    override get root(): Uri {
        return this;
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
    override getDirectory(): Uri {
        return this;
    }
    override isRoot(): boolean {
        return false;
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
    override combinePaths(...paths: string[]): Uri {
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
    protected override getComparablePath(): string {
        return '';
    }
}
