/*
 * docStringToMarkdown.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Python doc string to markdown converter.
 *
 * This does various things, including removing common indention, escaping
 * characters, handling code blocks, and more.
 *
 * This is a straight port of
 * https://github.com/microsoft/python-language-server/blob/master/src/LanguageServer/Impl/Documentation/DocstringConverter.cs
 *
 * The restructured npm library was evaluated, and while it worked well for
 * parsing valid input, it was going to be more difficult to handle invalid
 * RST input.
 */

export function convertDocStringToMarkdown(docString: string): string {
    return new DocStringConverter(docString).convert();
}

interface RegExpReplacement {
    exp: RegExp;
    replacement: string;
}

// Regular expressions for one match
const LeadingSpaceCountRegExp = /\S|$/;
const CrLfRegExp = /\r?\n/;
const NonWhitespaceRegExp = /\S/;
const TildaHeaderRegExp = /^\s*~~~+$/;
const PlusHeaderRegExp = /^\s*\+\+\++$/;
const LeadingAsteriskRegExp = /^(\s+\* )(.*)$/;
const SpaceDotDotRegExp = /^\s*\.\. /;
const DirectiveLikeRegExp = /^\s*\.\.\s+(\w+)::\s*(.*)$/;
const DoctestRegExp = / *>>> /;
const DirectivesExtraNewlineRegExp = /^\s*:(param|arg|type|return|rtype|raise|except|var|ivar|cvar|copyright|license)/;

const PotentialHeaders: RegExpReplacement[] = [
    { exp: /^\s*=+(\s+=+)+$/, replacement: '=' },
    { exp: /^\s*-+(\s+-+)+$/, replacement: '-' },
    { exp: /^\s*~+(\s+-+)+$/, replacement: '~' },
    { exp: /^\s*\++(\s+\++)+$/, replacement: '+' },
];

// Regular expressions for replace all
const WhitespaceRegExp = /\s/g;
const DoubleTickRegExp = /``/g;
const TabRegExp = /\t/g;
const TildeRegExp = /~/g;
const PlusRegExp = /\+/g;
const UnescapedMarkdownCharsRegExp = /(?<!\\)([_*~[\]])/g;

const HtmlEscapes: RegExpReplacement[] = [
    { exp: /</g, replacement: '&lt;' },
    { exp: />/g, replacement: '&gt;' },
];

// http://docutils.sourceforge.net/docs/ref/rst/restructuredtext.html#literal-blocks
const LiteralBlockEmptyRegExp = /^\s*::$/;
const LiteralBlockReplacements: RegExpReplacement[] = [
    { exp: /\s+::$/g, replacement: '' },
    { exp: /(\S)\s*::$/g, replacement: '$1:' },
    // http://docutils.sourceforge.net/docs/ref/rst/restructuredtext.html#interpreted-text
    { exp: /:[\w_\-+:.]+:`/g, replacement: '`' },
    { exp: /`:[\w_\-+:.]+:/g, replacement: '`' },
];

// Converter is a state machine, where the current state is a function which
// will be run (and change the state again) until completion.
type State = () => void;

class DocStringConverter {
    private _builder = '';
    private _skipAppendEmptyLine = true;
    private _insideInlineCode = false;
    private _appendDirectiveBlock = false;

    private _state: State;
    private _stateStack: State[] = [];

    private _lines: string[];
    private _lineNum = 0;

    private _blockIndent = 0;

    constructor(input: string) {
        this._state = this._parseText;
        this._lines = _splitDocString(input);
    }

    convert(): string {
        while (this._currentLineOrUndefined() !== undefined) {
            const before = this._state;
            const beforeLine = this._lineNum;

            this._state();

            // Parser must make progress; either the state or line number must change.
            if (this._state === before && this._lineNum === beforeLine) {
                break;
            }
        }

        // Close out any outstanding code blocks.
        if (
            this._state === this._parseBacktickBlock ||
            this._state === this._parseDocTest ||
            this._state === this._parseLiteralBlock
        ) {
            this._trimOutputAndAppendLine('```');
        } else if (this._insideInlineCode) {
            this._trimOutputAndAppendLine('`', true);
        }

        return this._builder.trim();
    }

    private _eatLine() {
        this._lineNum++;
    }

    private _currentLineOrUndefined(): string | undefined {
        return this._lineNum < this._lines.length ? this._lines[this._lineNum] : undefined;
    }

    private _currentLine(): string {
        return this._currentLineOrUndefined() || '';
    }

    private _currentIndent(): number {
        return _countLeadingSpaces(this._currentLine());
    }

    private _lineAt(i: number): string | undefined {
        return i < this._lines.length ? this._lines[i] : undefined;
    }

    private _nextBlockIndent(): number {
        return _countLeadingSpaces(
            this._lines.slice(this._lineNum + 1).find((v) => !_isUndefinedOrWhitespace(v)) || ''
        );
    }

    private _currentLineIsOutsideBlock(): boolean {
        return this._currentIndent() < this._blockIndent;
    }

    private _currentLineWithinBlock(): string {
        return this._currentLine().substr(this._blockIndent);
    }

    private _pushAndSetState(next: State): void {
        if (this._state === this._parseText) {
            this._insideInlineCode = false;
        }

        this._stateStack.push(this._state);
        this._state = next;
    }

    private _popState(): void {
        this._state = this._stateStack.splice(0, 1)[0];

        if (this._state === this._parseText) {
            // Terminate inline code when leaving a block.
            this._insideInlineCode = false;
        }
    }

    private _parseText(): void {
        if (_isUndefinedOrWhitespace(this._currentLineOrUndefined())) {
            this._state = this._parseEmpty;
            return;
        }

        if (this._beginBacktickBlock()) {
            return;
        }

        if (this._beginLiteralBlock()) {
            return;
        }

        if (this._beginDocTest()) {
            return;
        }

        if (this._beginDirective()) {
            return;
        }

        // TODO: Push into Google/Numpy style list parser.

        this._appendTextLine(this._escapeHtml(this._currentLine()));
        this._eatLine();
    }

    private _escapeHtml(line: string): string {
        HtmlEscapes.forEach((escape) => {
            line = line.replace(escape.exp, escape.replacement);
        });

        return line;
    }

    private _appendTextLine(line: string): void {
        line = this._preprocessTextLine(line);

        // Attempt to put directives lines into their own paragraphs.
        // This should be removed once proper list-like parsing is written.
        if (!this._insideInlineCode && DirectivesExtraNewlineRegExp.test(line)) {
            this._appendLine();
        }

        const parts = line.split('`');

        for (let i = 0; i < parts.length; i++) {
            let part = parts[i];

            if (i > 0) {
                this._insideInlineCode = !this._insideInlineCode;
                this._append('`');
            }

            if (this._insideInlineCode) {
                this._append(part);
                continue;
            }

            if (i === 0) {
                // Only one part, and not inside code, so check header cases.
                if (parts.length === 1) {
                    // Handle weird separator lines which contain random spaces.
                    for (const expReplacement of PotentialHeaders) {
                        if (expReplacement.exp.test(part)) {
                            part = part.replace(WhitespaceRegExp, expReplacement.replacement);
                            break;
                        }
                    }

                    // Replace ReST style ~~~ header to prevent it being interpreted as a code block
                    // (an alternative in Markdown to triple backtick blocks).
                    if (TildaHeaderRegExp.test(part)) {
                        this._append(part.replace(TildeRegExp, '-'));
                        continue;
                    }

                    // Replace +++ heading too.
                    // TODO: Handle the rest of these, and the precedence order (which depends on the
                    // order heading lines are seen, not what the line contains).
                    // http://docutils.sourceforge.net/docs/ref/rst/restructuredtext.html#sections
                    if (PlusHeaderRegExp.test(part)) {
                        this._append(part.replace(PlusRegExp, '-'));
                        continue;
                    }
                }

                // Don't strip away asterisk-based bullet point lists.
                //
                // TODO: Replace this with real list parsing. This may have
                // false positives and cause random italics when the ReST list
                // doesn't match Markdown's specification.
                const match = LeadingAsteriskRegExp.exec(part);
                if (match !== null && match.length === 3) {
                    this._append(match[1]);
                    part = match[2];
                }
            }

            // TODO: Find a better way to handle this; the below breaks escaped
            // characters which appear at the beginning or end of a line.
            // Applying this only when i == 0 or i == parts.Length-1 may work.

            // http://docutils.sourceforge.net/docs/ref/rst/restructuredtext.html#hyperlink-references
            // part = RegExp.Replace(part, @"^_+", "");
            // http://docutils.sourceforge.net/docs/ref/rst/restructuredtext.html#inline-internal-targets
            // part = RegExp.Replace(part, @"_+$", "");

            // TODO: Strip footnote/citation references.

            // Escape _, *, and ~, but ignore things like ":param \*\*kwargs:".
            part = part.replace(UnescapedMarkdownCharsRegExp, '\\$1');

            this._append(part);
        }

        // Go straight to the builder so that _appendLine doesn't think
        // we're actually trying to insert an extra blank line and skip
        // future whitespace. Empty line deduplication is already handled
        // because Append is used above.
        this._builder += '\n';
    }

    private _preprocessTextLine(line: string): string {
        // http://docutils.sourceforge.net/docs/ref/rst/restructuredtext.html#literal-blocks
        if (LiteralBlockEmptyRegExp.test(line)) {
            return '';
        }

        LiteralBlockReplacements.forEach((item) => (line = line.replace(item.exp, item.replacement)));

        line = line.replace(DoubleTickRegExp, '`');
        return line;
    }

    private _parseEmpty(): void {
        if (_isUndefinedOrWhitespace(this._currentLineOrUndefined())) {
            this._appendLine();
            this._eatLine();
            return;
        }

        this._state = this._parseText;
    }

    private _beginMinIndentCodeBlock(state: State): void {
        this._appendLine('```');
        this._pushAndSetState(state);
        this._blockIndent = this._currentIndent();
    }

    private _beginBacktickBlock(): boolean {
        if (this._currentLine().startsWith('```')) {
            this._appendLine(this._currentLine());
            this._pushAndSetState(this._parseBacktickBlock);
            this._eatLine();
            return true;
        }
        return false;
    }

    private _parseBacktickBlock(): void {
        if (this._currentLine().startsWith('```')) {
            this._appendLine('```');
            this._appendLine();
            this._popState();
        } else {
            this._appendLine(this._currentLine());
        }

        this._eatLine();
    }

    private _beginDocTest(): boolean {
        if (!DoctestRegExp.test(this._currentLine())) {
            return false;
        }

        this._beginMinIndentCodeBlock(this._parseDocTest);
        this._appendLine(this._currentLineWithinBlock());
        this._eatLine();
        return true;
    }

    private _parseDocTest(): void {
        if (this._currentLineIsOutsideBlock() || _isUndefinedOrWhitespace(this._currentLine())) {
            this._trimOutputAndAppendLine('```');
            this._appendLine();
            this._popState();
            return;
        }

        this._appendLine(this._currentLineWithinBlock());
        this._eatLine();
    }

    private _beginLiteralBlock(): boolean {
        // The previous line must be empty.
        const prev = this._lineAt(this._lineNum - 1);
        if (prev === undefined) {
            return false;
        } else if (!_isUndefinedOrWhitespace(prev)) {
            return false;
        }

        // Find the previous paragraph and check that it ends with ::
        let i = this._lineNum - 2;
        for (; i >= 0; i--) {
            const line = this._lineAt(i);
            if (_isUndefinedOrWhitespace(line)) {
                continue;
            }

            // Safe to ignore whitespace after the :: because all lines have been trimRight'd.
            if (line!.endsWith('::')) {
                break;
            }

            return false;
        }

        if (i < 0) {
            return false;
        }

        // Special case: allow one-liners at the same indent level.
        if (this._currentIndent() === 0) {
            this._appendLine('```');
            this._pushAndSetState(this._parseLiteralBlockSingleLine);
            return true;
        }

        this._beginMinIndentCodeBlock(this._parseLiteralBlock);
        return true;
    }

    private _parseLiteralBlock(): void {
        // Slightly different than doctest, wait until the first non-empty unindented line to exit.
        if (_isUndefinedOrWhitespace(this._currentLineOrUndefined())) {
            this._appendLine();
            this._eatLine();
            return;
        }

        if (this._currentLineIsOutsideBlock()) {
            this._trimOutputAndAppendLine('```');
            this._appendLine();
            this._popState();
            return;
        }

        this._appendLine(this._currentLineWithinBlock());
        this._eatLine();
    }

    private _parseLiteralBlockSingleLine(): void {
        this._appendLine(this._currentLine());
        this._appendLine('```');
        this._appendLine();
        this._popState();
        this._eatLine();
    }

    private _beginDirective(): boolean {
        if (!SpaceDotDotRegExp.test(this._currentLine())) {
            return false;
        }

        this._pushAndSetState(this._parseDirective);
        this._blockIndent = this._nextBlockIndent();
        this._appendDirectiveBlock = false;
        return true;
    }

    private _parseDirective(): void {
        // http://docutils.sourceforge.net/docs/ref/rst/restructuredtext.html#directives

        const match = DirectiveLikeRegExp.exec(this._currentLine());
        if (match !== null && match.length === 3) {
            const directiveType = match[1];
            const directive = match[2];

            if (directiveType === 'class') {
                this._appendDirectiveBlock = true;
                this._appendLine();
                this._appendLine('```');
                this._appendLine(directive);
                this._appendLine('```');
                this._appendLine();
            }
        }

        if (this._blockIndent === 0) {
            // This is a one-liner directive, so pop back.
            this._popState();
        } else {
            this._state = this._parseDirectiveBlock;
        }

        this._eatLine();
    }

    private _parseDirectiveBlock(): void {
        if (!_isUndefinedOrWhitespace(this._currentLineOrUndefined()) && this._currentLineIsOutsideBlock()) {
            this._popState();
            return;
        }

        if (this._appendDirectiveBlock) {
            // This is a bit of a hack. This just trims the text and appends it
            // like top-level text, rather than doing actual indent-based recursion.
            this._appendTextLine(this._currentLine().trimLeft());
        }

        this._eatLine();
    }

    private _appendLine(line?: string): void {
        if (!_isUndefinedOrWhitespace(line)) {
            this._builder += line + '\n';
            this._skipAppendEmptyLine = false;
        } else if (!this._skipAppendEmptyLine) {
            this._builder += '\n';
            this._skipAppendEmptyLine = true;
        }
    }

    private _append(text: string): void {
        this._builder += text;
        this._skipAppendEmptyLine = false;
    }

    private _trimOutputAndAppendLine(line: string, noNewLine = false): void {
        this._builder = this._builder.trimRight();
        this._skipAppendEmptyLine = false;

        if (!noNewLine) {
            this._appendLine();
        }

        this._appendLine(line);
    }
}

function _splitDocString(docstring: string): string[] {
    // As done by inspect.cleandoc.
    docstring = docstring.replace(TabRegExp, ' '.repeat(8));

    let lines = docstring.split(CrLfRegExp).map((v) => v.trimRight());
    if (lines.length > 0) {
        let first: string | undefined = lines[0].trimLeft();
        if (first === '') {
            first = undefined;
        } else {
            lines.splice(0, 1);
        }

        lines = _stripLeadingWhitespace(lines);

        if (first !== undefined) {
            lines.splice(0, 0, first);
        }
    }

    return lines;
}

function _stripLeadingWhitespace(lines: string[], trim?: number): string[] {
    const amount = trim === undefined ? _largestTrim(lines) : trim;
    return lines.map((line) => (amount > line.length ? '' : line.substr(amount)));
}

function _largestTrim(lines: string[]): number {
    const nonEmptyLines = lines.filter((s) => !_isUndefinedOrWhitespace(s));
    const counts = nonEmptyLines.map(_countLeadingSpaces);
    const largest = counts.length > 0 ? Math.min(...counts) : 0;
    return largest;
}

function _countLeadingSpaces(s: string): number {
    return s.search(LeadingSpaceCountRegExp);
}

function _isUndefinedOrWhitespace(s: string | undefined): boolean {
    return s === undefined || !NonWhitespaceRegExp.test(s);
}
