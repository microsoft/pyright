/*
 * docStringService.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Interface for service that parses docstrings and converts them to other formats.
 */

import { MarkupKind } from 'vscode-languageserver-types';
import { convertDocStringToMarkdown, convertDocStringToPlainText } from '../analyzer/docStringConversion';
import { extractAttributeDocumentation, extractParameterDocumentation } from '../analyzer/docStringUtils';
import { Uri } from './uri/uri';

export interface DocStringService {
    convertDocStringToPlainText(docString: string): string;
    convertDocStringToMarkdown(docString: string, forceLiteral?: boolean, sourceFileUri?: Uri): string;
    extractParameterDocumentation(
        functionDocString: string,
        paramName: string,
        format?: MarkupKind,
        forceLiteral?: boolean
    ): string | undefined;
    extractAttributeDocumentation(
        classDocString: string,
        attrName: string,
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
            !!value.extractParameterDocumentation &&
            !!value.extractAttributeDocumentation
        );
    }
}

export class PyrightDocStringService implements DocStringService {
    convertDocStringToPlainText(docString: string): string {
        return convertDocStringToPlainText(docString);
    }

    convertDocStringToMarkdown(docString: string, _forceLiteral?: boolean, _sourceFileUri?: Uri): string {
        return convertDocStringToMarkdown(docString);
    }

    extractParameterDocumentation(functionDocString: string, paramName: string): string | undefined {
        return extractParameterDocumentation(functionDocString, paramName);
    }

    extractAttributeDocumentation(classDocString: string, attrName: string): string | undefined {
        return extractAttributeDocumentation(classDocString, attrName);
    }

    clone() {
        // No need to clone, no internal state
        return this;
    }
}
