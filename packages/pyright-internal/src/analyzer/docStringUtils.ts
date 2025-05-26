/*
 * docStringUtils.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Static methods that format and parse doc strings based on
 * the rules specified in PEP 257
 * (https://www.python.org/dev/peps/pep-0257/).
 */

const docStringCrRegEx = /\r/g;
const docStringTabRegEx = /\t/g;

export function cleanAndSplitDocString(rawString: string): string[] {
    // Remove carriage returns and replace tabs.
    const unescaped = rawString.replace(docStringCrRegEx, '').replace(docStringTabRegEx, '        ');

    // Split into lines.
    const lines = unescaped.split('\n');

    // Determine the max indent amount.
    let leftSpacesToRemove = Number.MAX_VALUE;
    lines.forEach((line, index) => {
        // First line is special.
        if (lines.length <= 1 || index > 0) {
            const trimmed = line.trimLeft();
            if (trimmed) {
                leftSpacesToRemove = Math.min(leftSpacesToRemove, line.length - trimmed.length);
            }
        }
    });

    // Handle the case where there were only empty lines.
    if (leftSpacesToRemove >= Number.MAX_VALUE) {
        leftSpacesToRemove = 0;
    }

    // Trim the lines.
    const trimmedLines: string[] = [];
    lines.forEach((line, index) => {
        if (index === 0) {
            trimmedLines.push(line.trim());
        } else {
            trimmedLines.push(line.substr(leftSpacesToRemove).trimRight());
        }
    });

    // Strip off leading and trailing blank lines.
    while (trimmedLines.length > 0 && trimmedLines[0].length === 0) {
        trimmedLines.shift();
    }

    while (trimmedLines.length > 0 && trimmedLines[trimmedLines.length - 1].length === 0) {
        trimmedLines.pop();
    }

    return trimmedLines;
}

export function extractParameterDocumentation(functionDocString: string, paramName: string): string | undefined {
    if (!functionDocString || !paramName) {
        return undefined;
    }

    // Python doesn't have a single standard for param documentation. There are three
    // popular styles.
    //
    // 1. Epytext:
    //      @param param1: description
    // 2. reST:
    //      :param param1: description
    // 3. Google (variant 1):
    //      Args:
    //          param1: description
    // 4. Google (variant 2):
    //      Args:
    //          param1 (type): description

    const docStringLines = cleanAndSplitDocString(functionDocString);
    for (const line of docStringLines) {
        const trimmedLine = line.trim();

        // Check for Epytext
        let paramOffset = trimmedLine.indexOf('@param ' + paramName);
        if (paramOffset >= 0) {
            return trimmedLine.substr(paramOffset + 7);
        }

        // Check for reST format
        paramOffset = trimmedLine.indexOf(':param ' + paramName);
        if (paramOffset >= 0) {
            return trimmedLine.substr(paramOffset + 7);
        }

        // Check for Google (variant 1) format
        paramOffset = trimmedLine.indexOf(paramName + ': ');
        if (paramOffset >= 0) {
            return trimmedLine.substr(paramOffset);
        }

        // Check for Google (variant 2) format
        paramOffset = trimmedLine.indexOf(paramName + ' (');
        if (paramOffset >= 0) {
            return trimmedLine.substr(paramOffset);
        }
    }

    return undefined;
}
