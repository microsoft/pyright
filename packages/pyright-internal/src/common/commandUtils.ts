/*
 * commandUtils.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Utilities for working with LSP commands.
 */

import { Command } from 'vscode-languageserver-types';
import { Uri } from './uri/uri';

export function createCommand(title: string, command: string, ...args: any[]): Command {
    // Make sure if any of the args are URIs, we convert them to strings.
    const convertedArgs = args.map((arg) => {
        if (Uri.is(arg)) {
            return arg.toString();
        }
        return arg;
    });
    return Command.create(title, command, ...convertedArgs);
}
