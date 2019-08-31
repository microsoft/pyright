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

export class DocStringUtils {
    static decodeDocString(rawString: string): string {
        // Remove carriage returns and replace tabs.
        const unescaped = rawString.replace(/\r/g, '').replace(/\t/g, '        ');

        // Split into lines.
        const lines = unescaped.split('\n');

        // Determine the max indent amount.
        let maxIndent = Number.MAX_VALUE;
        lines.forEach((line, index) => {
            // First line is special.
            if (lines.length <= 1 || index > 0) {
                const trimmed = line.trimLeft();
                if (trimmed) {
                    maxIndent = Math.min(maxIndent, line.length - trimmed.length);
                }
            }
        });

        // Trim the lines.
        const trimmedLines: string[] = [];
        if (maxIndent < Number.MAX_VALUE) {
            lines.forEach((line, index) => {
                if (index === 0) {
                    trimmedLines.push(line.trimRight());
                } else {
                    trimmedLines.push(line.substr(maxIndent).trimRight());
                }
            });
        }

        // Strip off leading and trailing blank lines.
        while (trimmedLines.length > 0 && trimmedLines[0].length === 0) {
            trimmedLines.shift();
        }

        while (trimmedLines.length > 0 && trimmedLines[trimmedLines.length - 1].length === 0) {
            trimmedLines.pop();
        }

        return trimmedLines.join('\n');
    }
}
