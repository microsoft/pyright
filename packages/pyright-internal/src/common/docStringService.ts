/*
 * docStringService.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Interface for service that parses docstrings and converts them to other formats.
 */

import { MarkupKind } from 'vscode-languageserver-types';
import { convertDocStringToMarkdown, convertDocStringToPlainText } from '../analyzer/docStringConversion';
import { extractParameterDocumentation } from '../analyzer/docStringUtils';

export interface DocStringService {
    convertDocStringToPlainText(docString: string): string;
    convertDocStringToMarkdown(docString: string, forceLiteral?: boolean): string;
    extractParameterDocumentation(
        functionDocString: string,
        paramName: string,
        format?: MarkupKind,
        forceLiteral?: boolean
    ): string | undefined;
    clone(): DocStringService;
}

export namespace DocStringService {
    export function is(value: any): value is DocStringService {
        return (
            !!value.convertDocStringToMarkdown &&
            !!value.convertDocStringToPlainText &&
            !!value.extractParameterDocumentation
        );
    }
}

export class PyrightDocStringService implements DocStringService {
    convertDocStringToPlainText(docString: string): string {
        return convertDocStringToPlainText(docString);
    }

    convertDocStringToMarkdown(docString: string): string {
        return convertDocStringToMarkdown(docString);
    }

    extractParameterDocumentation(functionDocString: string, paramName: string): string | undefined {
        return extractParameterDocumentation(functionDocString, paramName);
    }

    clone() {
        // No need to clone, no internal state
        return this;
    }
}
