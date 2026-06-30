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

export function extractAttributeDocumentation(classDocString: string, attrName: string): string | undefined {
    if (!classDocString || !attrName) {
        return undefined;
    }

    // Python documentation styles for attributes:
    //
    // 1. reST:
    //      :ivar attr1: description
    // 2. Google:
    //      Attributes:
    //          attr1: description
    // 3. Google (with type):
    //      Attributes:
    //          attr1 (type): description

    const docStringLines = cleanAndSplitDocString(classDocString);
    for (const line of docStringLines) {
        const trimmedLine = line.trim();

        // Check for reST format
        let attrOffset = trimmedLine.indexOf(':ivar ' + attrName);
        if (attrOffset >= 0) {
            return trimmedLine.substr(attrOffset + 6);
        }

        // Check for Google (variant 1) format
        attrOffset = trimmedLine.indexOf(attrName + ': ');
        if (attrOffset >= 0) {
            return trimmedLine.substr(attrOffset);
        }

        // Check for Google (variant 2) format
        attrOffset = trimmedLine.indexOf(attrName + ' (');
        if (attrOffset >= 0) {
            return trimmedLine.substr(attrOffset);
        }
    }

    return undefined;
}

export function extractReturnDocumentation(functionDocString: string): string | undefined {
    if (!functionDocString) {
        return undefined;
    }

    // Python doesn't have a single standard for documenting return values. There are three
    // popular styles.
    //
    // 1. Epytext:
    //      @return: description
    //      @returns: description
    // 2. reST:
    //      :return: description
    //      :returns: description
    // 3. Google:
    //      Returns:
    //          description
    //      Returns:
    //          type: description

    // Scan the raw (only CR/tab-normalized) lines rather than cleanAndSplitDocString output.
    // cleanAndSplitDocString trims the first physical line to indent 0 and dedents the rest by a
    // common indent, which can collapse a first-line "Returns:" header and its body to the same
    // indent (e.g. `"""Returns:\n    the value."""`). The Google branch below compares header vs
    // body indentation, so it needs the original indentation preserved. reST/Epytext matching is
    // indent-agnostic and is unaffected by using raw lines.
    const docStringLines = functionDocString
        .replace(docStringCrRegEx, '')
        .replace(docStringTabRegEx, '        ')
        .split('\n');
    for (let i = 0; i < docStringLines.length; i++) {
        const line = docStringLines[i];
        const trimmedLine = line.trim();

        // Check for reST format (":return:" / ":returns:").
        let match = trimmedLine.match(/^:returns?:\s*(.*)$/i);
        if (match) {
            const description = match[1].trim();
            return description.length > 0 ? description : undefined;
        }

        // Check for Epytext format ("@return:" / "@returns:"). Mirror the reST handling so a
        // missing space after the colon (e.g. "@returns:foo") still extracts the description. The
        // word boundary keeps "@returnsfoo" (no delimiter) from being treated as a return field.
        match = trimmedLine.match(/^@returns?\b:?\s*(.*)$/i);
        if (match) {
            const description = match[1].trim();
            return description.length > 0 ? description : undefined;
        }

        // Check for Google format ("Returns:" / "Return:" section header). The description
        // lives on the following line(s), indented deeper than the header.
        //
        // Note: this matches the first "Returns:" line anywhere in the docstring; it does not
        // require the header to be at the outermost section indent. A bare "Returns:" nested
        // inside another section would therefore be treated as the header. That matches the
        // existing Args/parameter extraction behavior and is acceptable in practice.
        if (/^returns?:$/i.test(trimmedLine)) {
            const headerIndent = line.length - line.trimStart().length;
            const descriptionLines: string[] = [];
            for (let j = i + 1; j < docStringLines.length; j++) {
                const nextLine = docStringLines[j];
                if (nextLine.trim().length === 0) {
                    // A blank line ends the section once we've started collecting.
                    if (descriptionLines.length > 0) {
                        break;
                    }
                    continue;
                }

                const nextIndent = nextLine.length - nextLine.trimStart().length;
                if (nextIndent <= headerIndent) {
                    // Dedented back to (or past) the header: next section started.
                    break;
                }

                descriptionLines.push(nextLine.trim());
            }

            const description = descriptionLines.join('\n').trim();
            return description.length > 0 ? description : undefined;
        }
    }

    return undefined;
}
