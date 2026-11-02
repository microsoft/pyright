/*
 * typeInferenceComparison.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Generates deterministic reveal_type scenarios, runs Pyright and Pyrefly,
 * and writes a Markdown report that highlights inference differences.
 */

import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { performance } from 'perf_hooks';

interface Options {
    caseCount: number;
    outputDirectory: string;
    pythonVersion: string;
    pyreflyCommand: string;
}

interface GeneratedCase {
    id: string;
    category: string;
    description: string;
    lines: string[];
    revealExpression: string;
}

interface RenderedCorpus {
    source: string;
    casesByRevealLine: Map<number, GeneratedCase>;
}

interface CheckerDiagnostic {
    line: number;
    severity: string;
    message: string;
    rule?: string;
}

interface CheckerResult {
    name: string;
    version: string;
    durationMs: number;
    exitCode: number | null;
    reveals: Map<number, string>;
    diagnostics: CheckerDiagnostic[];
    stderr: string;
}

type ComparisonKind =
    | 'equivalent'
    | 'pyright-narrower'
    | 'pyrefly-narrower'
    | 'different'
    | 'missing-pyright'
    | 'missing-pyrefly'
    | 'missing-both';

interface CaseComparison {
    generatedCase: GeneratedCase;
    pyrightType?: string;
    pyreflyType?: string;
    kind: ComparisonKind;
    reason: string;
}

interface DifferenceFamily {
    category: string;
    count: number;
    example: CaseComparison;
    pyreflyArgument: string;
}

const DEFAULT_CASE_COUNT = 1000;
const DEFAULT_PYTHON_VERSION = '3.11';
const GENERATED_DIRECTORY = path.resolve(
    process.cwd(),
    'src',
    'tests',
    'benchmarks',
    '.generated',
    'type-inference-comparison'
);

const commonHeader = `from __future__ import annotations

from collections.abc import Callable, Iterable, Sequence
from dataclasses import dataclass
from typing import Any, Generic, Literal, TypeGuard, TypeVar, overload, reveal_type

T = TypeVar("T")

def identity(value: T) -> T:
    return value

def first(values: Sequence[T]) -> T:
    return values[0]

def is_str(value: object) -> TypeGuard[str]:
    return isinstance(value, str)
`;

function parseOptions(args: string[]): Options {
    let caseCount = DEFAULT_CASE_COUNT;
    let outputDirectory = GENERATED_DIRECTORY;
    let pythonVersion = DEFAULT_PYTHON_VERSION;
    let pyreflyCommand = process.env.PYREFLY_COMMAND || 'uvx';

    for (let index = 0; index < args.length; index++) {
        const arg = args[index];
        const value = args[index + 1];

        if (arg === '--cases' && value) {
            caseCount = Number.parseInt(value, 10);
            index++;
        } else if (arg === '--output' && value) {
            outputDirectory = path.resolve(value);
            index++;
        } else if (arg === '--python-version' && value) {
            pythonVersion = value;
            index++;
        } else if (arg === '--pyrefly-command' && value) {
            pyreflyCommand = value;
            index++;
        } else if (arg === '--help') {
            printUsageAndExit();
        } else {
            throw new Error(`Unknown or incomplete argument: ${arg}`);
        }
    }

    if (!Number.isInteger(caseCount) || caseCount < 1) {
        throw new Error('--cases must be a positive integer');
    }

    return { caseCount, outputDirectory, pythonVersion, pyreflyCommand };
}

function printUsageAndExit(): never {
    console.log(`Usage: pnpm run benchmark:type-inference -- [options]

Options:
  --cases <count>              Number of generated reveal_type cases (default: ${DEFAULT_CASE_COUNT})
  --output <directory>         Report and corpus output directory
  --python-version <version>   Python version supplied to both checkers (default: ${DEFAULT_PYTHON_VERSION})
  --pyrefly-command <command>  Pyrefly executable, or uvx to run "uvx pyrefly" (default: uvx)
  --help                       Show this help
`);
    process.exit(0);
}

function createCase(index: number): GeneratedCase {
    const id = `case_${String(index + 1).padStart(5, '0')}`;
    const integer = (index % 97) + 1;
    const alternateInteger = ((index * 17) % 89) + 100;
    const text = `value_${index % 53}`;
    const template = index % 16;

    switch (template) {
        case 0:
            return {
                id,
                category: 'literal',
                description: 'Literal integer inference',
                lines: [`value = ${integer}`],
                revealExpression: 'value',
            };
        case 1:
            return {
                id,
                category: 'container',
                description: 'Homogeneous list inference',
                lines: [`value = [${integer}, ${alternateInteger}]`],
                revealExpression: 'value',
            };
        case 2:
            return {
                id,
                category: 'container',
                description: 'Heterogeneous tuple inference',
                lines: [`value = (${integer}, "${text}", True)`],
                revealExpression: 'value',
            };
        case 3:
            return {
                id,
                category: 'generic-call',
                description: 'Generic identity function',
                lines: [`value = identity(("${text}", ${integer}))`],
                revealExpression: 'value',
            };
        case 4:
            return {
                id,
                category: 'generic-call',
                description: 'Generic sequence element extraction',
                lines: [`value = first([${integer}, ${alternateInteger}])`],
                revealExpression: 'value',
            };
        case 5:
            return {
                id,
                category: 'comprehension',
                description: 'Filtered list comprehension',
                lines: [`value = [item * 2 for item in [${integer}, ${alternateInteger}] if item > 0]`],
                revealExpression: 'value',
            };
        case 6:
            return {
                id,
                category: 'narrowing',
                description: 'None narrowing',
                lines: [
                    `value: int | None = ${integer} if bool(${index % 2}) else None`,
                    'if value is not None:',
                    '    narrowed = value',
                    'else:',
                    '    narrowed = 0',
                ],
                revealExpression: 'narrowed',
            };
        case 7:
            return {
                id,
                category: 'narrowing',
                description: 'User-defined TypeGuard narrowing',
                lines: [
                    `candidate: object = "${text}"`,
                    'if is_str(candidate):',
                    '    narrowed = candidate',
                    'else:',
                    '    narrowed = ""',
                ],
                revealExpression: 'narrowed',
            };
        case 8:
            return {
                id,
                category: 'conditional',
                description: 'Conditional expression union',
                lines: [`value = ${integer} if bool(${index % 2}) else "${text}"`],
                revealExpression: 'value',
            };
        case 9:
            return {
                id,
                category: 'mapping',
                description: 'Dictionary inference',
                lines: [`value = {"left": ${integer}, "right": ${alternateInteger}}`],
                revealExpression: 'value',
            };
        case 10:
            return {
                id,
                category: 'callable',
                description: 'Lambda inference',
                lines: [`value = lambda item: item + ${integer}`],
                revealExpression: 'value',
            };
        case 11:
            return {
                id,
                category: 'flow',
                description: 'Isinstance flow narrowing',
                lines: [
                    `candidate: int | str = ${integer} if bool(${index % 2}) else "${text}"`,
                    'if isinstance(candidate, str):',
                    '    value = candidate.upper()',
                    'else:',
                    '    value = candidate + 1',
                ],
                revealExpression: 'value',
            };
        case 12:
            return {
                id,
                category: 'unpacking',
                description: 'Tuple unpacking inference',
                lines: [`left, *middle, right = (${integer}, "${text}", True, ${alternateInteger})`],
                revealExpression: 'middle',
            };
        case 13:
            return {
                id,
                category: 'iteration',
                description: 'Generator expression inference',
                lines: [`value = (item for item in [${integer}, ${alternateInteger}])`],
                revealExpression: 'value',
            };
        case 14:
            return {
                id,
                category: 'generic-class',
                description: 'Generic dataclass construction',
                lines: [
                    '@dataclass',
                    'class Box(Generic[T]):',
                    '    value: T',
                    '',
                    `value = Box(("${text}", ${integer}))`,
                ],
                revealExpression: 'value',
            };
        default:
            return {
                id,
                category: 'higher-order',
                description: 'Higher-order callable return inference',
                lines: [
                    'def apply(callback: Callable[[int], T], value: int) -> T:',
                    '    return callback(value)',
                    '',
                    `value = apply(lambda item: (item, "${text}"), ${integer})`,
                ],
                revealExpression: 'value',
            };
    }
}

function renderCorpus(caseCount: number): RenderedCorpus {
    const output: string[] = [...commonHeader.trimEnd().split('\n'), ''];
    const casesByRevealLine = new Map<number, GeneratedCase>();

    for (let index = 0; index < caseCount; index++) {
        const generatedCase = createCase(index);
        output.push(`# ${generatedCase.id}: ${generatedCase.description}`);
        output.push(`def ${generatedCase.id}() -> None:`);

        for (const line of generatedCase.lines) {
            output.push(line ? `    ${line}` : '');
        }

        output.push(`    reveal_type(${generatedCase.revealExpression})`);
        casesByRevealLine.set(output.length, generatedCase);
        output.push('');
    }

    return { source: `${output.join('\n')}\n`, casesByRevealLine };
}

function runProcess(
    command: string,
    args: string[],
    cwd: string
): {
    exitCode: number | null;
    stdout: string;
    stderr: string;
    durationMs: number;
} {
    const start = performance.now();
    const result = spawnSync(command, args, {
        cwd,
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
        shell: false,
    });

    if (result.error) {
        throw new Error(`Failed to run ${command}: ${result.error.message}`);
    }

    return {
        exitCode: result.status,
        stdout: result.stdout || '',
        stderr: result.stderr || '',
        durationMs: performance.now() - start,
    };
}

function runPyright(corpusPath: string, pythonVersion: string): CheckerResult {
    const pyrightPath = path.resolve(__dirname, 'typeInferencePyrightEntry.js');
    const workingDirectory = path.dirname(corpusPath);
    const versionResult = runProcess(process.execPath, [pyrightPath, '--version'], workingDirectory);
    const result = runProcess(
        process.execPath,
        [pyrightPath, corpusPath, '--outputjson', '--pythonversion', pythonVersion],
        workingDirectory
    );
    if (!result.stdout.trim()) {
        throw new Error(`Pyright produced no JSON output. stderr: ${result.stderr || '<empty>'}`);
    }
    const parsed = JSON.parse(result.stdout) as {
        generalDiagnostics?: Array<{
            severity: string;
            message: string;
            rule?: string;
            range?: { start: { line: number } };
        }>;
    };
    const diagnostics = (parsed.generalDiagnostics || []).map((diagnostic) => ({
        line: (diagnostic.range?.start.line ?? -1) + 1,
        severity: diagnostic.severity,
        message: diagnostic.message,
        rule: diagnostic.rule,
    }));

    return {
        name: 'Pyright',
        version: versionResult.stdout.trim() || versionResult.stderr.trim() || 'unknown',
        durationMs: result.durationMs,
        exitCode: result.exitCode,
        reveals: extractReveals(diagnostics, /^Type of ".+" is "(.+)"$/),
        diagnostics: diagnostics.filter((diagnostic) => !diagnostic.message.startsWith('Type of "')),
        stderr: result.stderr.trim(),
    };
}

function runPyrefly(corpusPath: string, pythonVersion: string, command: string): CheckerResult {
    const workingDirectory = path.dirname(corpusPath);
    const commandName = path.basename(command).toLowerCase();
    const usesPackageRunner = commandName === 'uvx' || commandName === 'uvx.exe';
    const prefixArgs = usesPackageRunner ? ['pyrefly'] : [];
    const versionResult = runProcess(command, [...prefixArgs, '--version'], workingDirectory);
    const result = runProcess(
        command,
        [
            ...prefixArgs,
            'check',
            corpusPath,
            '--output-format=json',
            '--output=-',
            '--summary=none',
            '--progress-bar=no',
            '--preset=default',
            '--color=never',
            '--threads=1',
            '--python-version',
            pythonVersion,
        ],
        workingDirectory
    );
    if (!result.stdout.trim()) {
        throw new Error(`Pyrefly produced no JSON output. stderr: ${result.stderr || '<empty>'}`);
    }
    const parsed = JSON.parse(result.stdout) as {
        errors?: Array<{
            line: number;
            severity: string;
            description: string;
            name?: string;
        }>;
    };
    const diagnostics = (parsed.errors || []).map((diagnostic) => ({
        line: diagnostic.line,
        severity: diagnostic.severity,
        message: diagnostic.description,
        rule: diagnostic.name,
    }));

    return {
        name: 'Pyrefly',
        version: versionResult.stdout.trim() || versionResult.stderr.trim() || 'unknown',
        durationMs: result.durationMs,
        exitCode: result.exitCode,
        reveals: extractReveals(diagnostics, /^revealed type: (.+)$/i),
        diagnostics: diagnostics.filter((diagnostic) => diagnostic.rule !== 'reveal-type'),
        stderr: result.stderr.trim(),
    };
}

function extractReveals(diagnostics: CheckerDiagnostic[], pattern: RegExp): Map<number, string> {
    const reveals = new Map<number, string>();

    for (const diagnostic of diagnostics) {
        const match = pattern.exec(diagnostic.message);
        if (match) {
            reveals.set(diagnostic.line, match[1]);
        }
    }

    return reveals;
}

function normalizeType(type: string): string {
    const normalized = type
        .replace(/\btyping\./g, '')
        .replace(/\btyping_extensions\./g, '')
        .replace(/\bcase_\d+\./g, '')
        .replace(/\s+/g, '')
        .toLowerCase();

    return canonicalizeType(normalized);
}

function canonicalizeType(type: string): string {
    const unionMembers = splitTopLevel(type, '|');
    if (unionMembers.length > 1) {
        return unionMembers.map(canonicalizeType).sort().join('|');
    }

    const openingBracket = type.indexOf('[');
    if (openingBracket < 0 || !type.endsWith(']')) {
        return type;
    }

    const name = type.slice(0, openingBracket);
    const argumentsText = type.slice(openingBracket + 1, -1);
    let typeArguments = splitTopLevel(argumentsText, ',').map(canonicalizeType);

    if (name === 'literal') {
        typeArguments = typeArguments.sort();
    } else if (name === 'generator' && typeArguments.length === 1) {
        typeArguments.push('none', 'none');
    } else if (name === 'union') {
        return typeArguments.sort().join('|');
    }

    return `${name}[${typeArguments.join(',')}]`;
}

function splitTopLevel(value: string, separator: string): string[] {
    const parts: string[] = [];
    let bracketDepth = 0;
    let quote: string | undefined;
    let start = 0;

    for (let index = 0; index < value.length; index++) {
        const character = value[index];
        if (quote) {
            if (character === quote && value[index - 1] !== '\\') {
                quote = undefined;
            }
        } else if (character === '"' || character === "'") {
            quote = character;
        } else if (character === '[') {
            bracketDepth++;
        } else if (character === ']') {
            bracketDepth--;
        } else if (character === separator && bracketDepth === 0) {
            parts.push(value.slice(start, index));
            start = index + 1;
        }
    }

    parts.push(value.slice(start));
    return parts;
}

function imprecisionScore(type: string): number {
    const normalized = normalizeType(type);
    const matches = normalized.match(/\b(any|unknown|object)\b/g);
    return matches?.length ?? 0;
}

function literalScore(type: string): number {
    return (normalizeType(type).match(/literal\[/g) || []).length;
}

function compareTypes(
    pyrightType: string | undefined,
    pyreflyType: string | undefined
): {
    kind: ComparisonKind;
    reason: string;
} {
    if (!pyrightType && !pyreflyType) {
        return { kind: 'missing-both', reason: 'Neither checker reported a reveal type.' };
    }
    if (!pyrightType) {
        return { kind: 'missing-pyright', reason: 'Only Pyrefly reported a reveal type.' };
    }
    if (!pyreflyType) {
        return { kind: 'missing-pyrefly', reason: 'Only Pyright reported a reveal type.' };
    }

    if (normalizeType(pyrightType) === normalizeType(pyreflyType)) {
        return { kind: 'equivalent', reason: 'Normalized type strings are equivalent.' };
    }

    const pyrightImprecision = imprecisionScore(pyrightType);
    const pyreflyImprecision = imprecisionScore(pyreflyType);
    if (pyrightImprecision !== pyreflyImprecision) {
        return pyrightImprecision < pyreflyImprecision
            ? { kind: 'pyright-narrower', reason: 'Pyrefly contains more Any, Unknown, or object components.' }
            : { kind: 'pyrefly-narrower', reason: 'Pyright contains more Any, Unknown, or object components.' };
    }

    const pyrightLiterals = literalScore(pyrightType);
    const pyreflyLiterals = literalScore(pyreflyType);
    if (pyrightLiterals !== pyreflyLiterals) {
        return pyrightLiterals > pyreflyLiterals
            ? { kind: 'pyright-narrower', reason: 'Pyright preserves more Literal components.' }
            : { kind: 'pyrefly-narrower', reason: 'Pyrefly preserves more Literal components.' };
    }

    return {
        kind: 'different',
        reason: 'The concrete types differ and require semantic adjudication.',
    };
}

function compareCases(corpus: RenderedCorpus, pyright: CheckerResult, pyrefly: CheckerResult): CaseComparison[] {
    const comparisons: CaseComparison[] = [];

    for (const [line, generatedCase] of corpus.casesByRevealLine) {
        const pyrightType = pyright.reveals.get(line);
        const pyreflyType = pyrefly.reveals.get(line);
        const result = compareTypes(pyrightType, pyreflyType);
        comparisons.push({ generatedCase, pyrightType, pyreflyType, ...result });
    }

    return comparisons;
}

function escapeTableCell(value: string): string {
    return value.replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
}

function formatDuration(durationMs: number): string {
    return `${(durationMs / 1000).toFixed(2)}s`;
}

function getPyreflyArgument(comparison: CaseComparison): string {
    switch (comparison.generatedCase.category) {
        case 'generic-call':
            return 'Widening literal arguments while solving a type variable produces a stable reusable type. Retaining incidental values can make generic return types and overload selection depend on constants that callers did not annotate as Literal.';
        case 'narrowing':
            return 'The explicit annotation is an abstraction boundary. After both branches produce an int, reporting int is more stable than retaining the initializer and fallback constants as a literal union.';
        case 'flow':
            return 'The variable was declared int | str, and the branch operations return those public types. str accurately describes upper(), whose result is not a known literal value, while the integer literal comes from optional constant folding rather than a typing guarantee.';
        case 'generic-class':
            return 'Constructor inference for a mutable generic class should generally widen incidental literal values. A literal-specialized type argument can be too narrow if the attribute is reassigned later and can make otherwise equivalent instances appear incompatible.';
        case 'higher-order':
            return 'Widening constants in an inferred callback return keeps the callable reusable and prevents captured literal values from leaking into the public result type. The tuple shape is preserved even though its elements are widened.';
        default:
            if (comparison.reason.includes('Any, Unknown, or object')) {
                return 'A gradual component may reflect an intentional boundary, unsupported feature, or soundness fallback. It is weaker evidence than a concrete-type disagreement but still needs validation before being called a loss.';
            }
            return "A narrower display is not automatically a better type. The difference should be checked against the typing specification, mutation behavior, and the checker's documented inference policy.";
    }
}

function getDifferenceFamilies(comparisons: CaseComparison[]): DifferenceFamily[] {
    const families = new Map<string, DifferenceFamily>();

    for (const comparison of comparisons) {
        if (comparison.kind === 'equivalent') {
            continue;
        }

        const key = `${comparison.generatedCase.category}:${comparison.kind}:${comparison.reason}`;
        const existing = families.get(key);
        if (existing) {
            existing.count++;
        } else {
            families.set(key, {
                category: comparison.generatedCase.category,
                count: 1,
                example: comparison,
                pyreflyArgument: getPyreflyArgument(comparison),
            });
        }
    }

    return [...families.values()].sort((left, right) => right.count - left.count);
}

function writeMarkdownReport(
    outputPath: string,
    corpusPath: string,
    options: Options,
    comparisons: CaseComparison[],
    pyright: CheckerResult,
    pyrefly: CheckerResult
): void {
    const counts = new Map<ComparisonKind, number>();
    for (const comparison of comparisons) {
        counts.set(comparison.kind, (counts.get(comparison.kind) || 0) + 1);
    }

    const equivalent = counts.get('equivalent') || 0;
    const pyrightWins = counts.get('pyright-narrower') || 0;
    const pyreflyWins = counts.get('pyrefly-narrower') || 0;
    const different = counts.get('different') || 0;
    const missing =
        (counts.get('missing-pyright') || 0) + (counts.get('missing-pyrefly') || 0) + (counts.get('missing-both') || 0);
    const nonRevealDiagnostics = pyright.diagnostics.length + pyrefly.diagnostics.length;
    const assessment =
        missing > 0 || nonRevealDiagnostics > 0
            ? 'Not ready for an inference-only switch decision: missing reveals or ordinary diagnostics need triage.'
            : different > 0
            ? 'No automatic switch recommendation: concrete disagreements require typing-spec or runtime adjudication.'
            : pyreflyWins > pyrightWins
            ? 'Pyrefly produced more narrow outputs under this heuristic; this is not by itself a switch recommendation.'
            : pyrightWins > pyreflyWins
            ? 'Pyright produced more narrow outputs under this heuristic; this is not by itself evidence that its inference policy is better.'
            : 'The checkers are tied on the prototype specificity heuristic.';
    const differences = comparisons.filter((comparison) => comparison.kind !== 'equivalent');
    const differenceFamilies = getDifferenceFamilies(comparisons);

    const lines: string[] = [
        '# Pyright vs. Pyrefly type inference comparison',
        '',
        `Generated: ${new Date().toISOString()}`,
        '',
        '## Switching assessment',
        '',
        `**${assessment}**`,
        '',
        'This report measures the specificity and availability of inferred `reveal_type` results. It does not by itself measure soundness, diagnostic quality, compatibility with a production codebase, IDE behavior, or typing-spec compliance. A narrower type can be wrong, so every concrete disagreement remains a review item rather than an automatic win.',
        '',
        '## Run configuration',
        '',
        '| Setting | Value |',
        '|---|---|',
        `| Cases | ${options.caseCount} |`,
        `| Python version | ${escapeTableCell(options.pythonVersion)} |`,
        `| Corpus | \`${escapeTableCell(path.relative(path.dirname(outputPath), corpusPath))}\` |`,
        `| Pyright | ${escapeTableCell(pyright.version)} |`,
        `| Pyrefly | ${escapeTableCell(pyrefly.version)} |`,
        '',
        '## Summary',
        '',
        '| Result | Count | Meaning |',
        '|---|---:|---|',
        `| Equivalent | ${equivalent} | Normalized reveal strings match |`,
        `| Pyright narrower outputs | ${pyrightWins} | Fewer gradual components or more literal detail |`,
        `| Pyrefly narrower outputs | ${pyreflyWins} | Fewer gradual components or more literal detail |`,
        `| Different concrete types | ${different} | Needs semantic adjudication |`,
        `| Missing reveal results | ${missing} | At least one checker did not produce a result |`,
        '',
        '| Checker | Reveals | Ordinary diagnostics | Time | Exit code |',
        '|---|---:|---:|---:|---:|',
        `| Pyright | ${pyright.reveals.size} | ${pyright.diagnostics.length} | ${formatDuration(
            pyright.durationMs
        )} | ${pyright.exitCode ?? 'none'} |`,
        `| Pyrefly | ${pyrefly.reveals.size} | ${pyrefly.diagnostics.length} | ${formatDuration(
            pyrefly.durationMs
        )} | ${pyrefly.exitCode ?? 'none'} |`,
        '',
        'Timing is a single cold process run and is included only as context, not as a stable performance benchmark.',
        '',
        '## Pyrefly-side interpretation',
        '',
        'The narrower-output count is intentionally adversarially reviewed below. These arguments do not prove that Pyrefly is correct; they explain why widening can be a deliberate and useful inference policy rather than a loss of capability.',
        '',
        '| Family | Count | Example | Strongest Pyrefly argument |',
        '|---|---:|---|---|',
    ];

    if (differenceFamilies.length === 0) {
        lines.push('| _None_ | 0 | | |');
    } else {
        for (const family of differenceFamilies) {
            lines.push(
                `| ${escapeTableCell(family.category)} | ${family.count} | ${
                    family.example.generatedCase.id
                }: \`${escapeTableCell(family.example.pyrightType || 'missing')}\` vs. \`${escapeTableCell(
                    family.example.pyreflyType || 'missing'
                )}\` | ${escapeTableCell(family.pyreflyArgument)} |`
            );
        }
    }

    lines.push(
        '',
        '## Differences',
        '',
        '| Case | Category | Result | Pyright | Pyrefly | Reason |',
        '|---|---|---|---|---|---|'
    );

    if (differences.length === 0) {
        lines.push('| _None_ | | | | | |');
    } else {
        for (const comparison of differences) {
            lines.push(
                `| ${comparison.generatedCase.id} | ${escapeTableCell(comparison.generatedCase.category)} | ${
                    comparison.kind
                } | \`${escapeTableCell(comparison.pyrightType || 'missing')}\` | \`${escapeTableCell(
                    comparison.pyreflyType || 'missing'
                )}\` | ${escapeTableCell(comparison.reason)} |`
            );
        }
    }

    lines.push('', '## Ordinary diagnostics', '');
    for (const checker of [pyright, pyrefly]) {
        lines.push(`### ${checker.name}`, '');
        if (checker.diagnostics.length === 0) {
            lines.push('_None._', '');
        } else {
            lines.push('| Line | Severity | Rule | Message |', '|---:|---|---|---|');
            for (const diagnostic of checker.diagnostics) {
                lines.push(
                    `| ${diagnostic.line} | ${escapeTableCell(diagnostic.severity)} | ${escapeTableCell(
                        diagnostic.rule || ''
                    )} | ${escapeTableCell(diagnostic.message)} |`
                );
            }
            lines.push('');
        }
    }

    lines.push(
        '## Interpretation rules',
        '',
        '- Equivalent types are compared after removing whitespace and `typing` qualification.',
        '- `Any`, `Unknown`, and `object` are treated as gradual/imprecise components.',
        '- Preserving more `Literal[...]` components is classified as a narrower output, not an automatic quality win.',
        '- All other concrete differences are intentionally left unresolved.',
        '- A production switch should additionally run both checkers over representative repositories and adjudicate error false positives, false negatives, suppression behavior, configuration parity, and IDE features.',
        ''
    );

    if (pyright.stderr) {
        lines.push('## Pyright stderr', '', '```text', pyright.stderr, '```', '');
    }
    if (pyrefly.stderr) {
        lines.push('## Pyrefly stderr', '', '```text', pyrefly.stderr, '```', '');
    }

    fs.writeFileSync(outputPath, lines.join('\n'), 'utf8');
}

function main(): void {
    const options = parseOptions(process.argv.slice(2));
    fs.mkdirSync(options.outputDirectory, { recursive: true });

    const corpus = renderCorpus(options.caseCount);
    const corpusPath = path.join(options.outputDirectory, 'generated_type_inference_corpus.py');
    const reportPath = path.join(options.outputDirectory, 'type-inference-comparison.md');
    fs.writeFileSync(corpusPath, corpus.source, 'utf8');

    console.log(`Generated ${options.caseCount} cases in ${corpusPath}`);
    const workingDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'type-inference-comparison-'));
    const workingCorpusPath = path.join(workingDirectory, path.basename(corpusPath));
    fs.writeFileSync(workingCorpusPath, corpus.source, 'utf8');

    try {
        const pyright = runPyright(workingCorpusPath, options.pythonVersion);
        console.log(`Pyright: ${pyright.reveals.size} reveals in ${formatDuration(pyright.durationMs)}`);
        const pyrefly = runPyrefly(workingCorpusPath, options.pythonVersion, options.pyreflyCommand);
        console.log(`Pyrefly: ${pyrefly.reveals.size} reveals in ${formatDuration(pyrefly.durationMs)}`);

        const comparisons = compareCases(corpus, pyright, pyrefly);
        writeMarkdownReport(reportPath, corpusPath, options, comparisons, pyright, pyrefly);
        console.log(`Markdown report written to ${reportPath}`);
    } finally {
        fs.rmSync(workingDirectory, { recursive: true });
    }
}

main();
