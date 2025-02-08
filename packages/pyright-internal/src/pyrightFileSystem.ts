/*
 * pyrightFileSystem.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * A file system that knows how to deal with remapping files from one folder to another.
 */

import type * as fs from 'fs';

import { FileSystem, MkDirOptions } from './common/fileSystem';
import { Uri } from './common/uri/uri';
import { ReadOnlyAugmentedFileSystem } from './readonlyAugmentedFileSystem';

export interface IPyrightFileSystem extends FileSystem {}

export class PyrightFileSystem extends ReadOnlyAugmentedFileSystem implements IPyrightFileSystem {
    constructor(realFS: FileSystem) {
        super(realFS);
    }

    override mkdirSync(uri: Uri, options?: MkDirOptions): void {
        this.realFS.mkdirSync(uri, options);
    }

    override chdir(uri: Uri): void {
        this.realFS.chdir(uri);
    }

    override writeFileSync(uri: Uri, data: string | Buffer, encoding: BufferEncoding | null): void {
        this.realFS.writeFileSync(this.getOriginalUri(uri), data, encoding);
    }

    override rmdirSync(uri: Uri): void {
        this.realFS.rmdirSync(this.getOriginalUri(uri));
    }

    override unlinkSync(uri: Uri): void {
        this.realFS.unlinkSync(this.getOriginalUri(uri));
    }

    override createWriteStream(uri: Uri): fs.WriteStream {
        return this.realFS.createWriteStream(this.getOriginalUri(uri));
    }

    override copyFileSync(src: Uri, dst: Uri): void {
        this.realFS.copyFileSync(this.getOriginalUri(src), this.getOriginalUri(dst));
    }
}
