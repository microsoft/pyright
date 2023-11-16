/*
 * emptyUri.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * URI class that represents an empty URI.
 */

import * as debug from '../debug';
import { Uri } from './uri';

const EmptyKey = '<empty>';

export class EmptyUri extends Uri {
    private static _instance = new EmptyUri();
    private constructor() {
        super(EmptyKey, 'empty');
    }

    static get instance() {
        return EmptyUri._instance;
    }

    override get scheme(): string {
        return '';
    }
    override get basename(): string {
        return '';
    }
    override get extname(): string {
        return '';
    }
    override get root(): Uri {
        return this;
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
    override isDiskPathRoot(): boolean {
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
    override combinePaths(...paths: string[]): Uri {
        return this;
    }
    override getPathComponents(): string[] {
        return [];
    }
    override getShortenedFileName(maxDirLength: number): string {
        return '';
    }
    override stripExtension(): Uri {
        return this;
    }
    protected override getRootPath(): string {
        return '';
    }
    protected override getComparablePath(): string {
        return '';
    }
}
