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
    parameters?: string;
    lines: string[];
    revealExpression: string;
}

interface RenderedCorpus {
    source: string;
    casesByRevealLine: Map<number, GeneratedCase>;
    expectedErrorsByLine: Map<number, ProbeLocation>;
    requiredAcceptsByLine: Map<number, ProbeLocation>;
}

interface ProbeLocation {
    generatedCase: GeneratedCase;
    source: string;
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

interface BehavioralProbeResult {
    line: number;
    location: ProbeLocation;
    pyrightDiagnostics: CheckerDiagnostic[];
    pyreflyDiagnostics: CheckerDiagnostic[];
}

interface ComparisonRun {
    corpusPath: string;
    corpus: RenderedCorpus;
    pyright: CheckerResult;
    pyrefly: CheckerResult;
}

const DEFAULT_CASE_COUNT = 1000;
const DEFAULT_PYTHON_VERSION = '3.11';
const SCENARIO_TEMPLATE_COUNT = 16;
const GENERATED_DIRECTORY = path.resolve(
    process.cwd(),
    'src',
    'tests',
    'benchmarks',
    '.generated',
    'type-inference-comparison'
);

const commonHeader = `from __future__ import annotations

from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Any, Generic, Literal, LiteralString, TypeGuard, TypedDict, TypeVar, overload, reveal_type

T = TypeVar("T")

def identity(value: T) -> T:
    return value

def first(values: Sequence[T]) -> T:
    return values[0]

def is_str(value: object) -> TypeGuard[str]:
    return isinstance(value, str)

def accepts_literal_string(value: LiteralString) -> None:
    pass

class BenchmarkIntResult:
    def int_only(self) -> int:
        return 1

class BenchmarkStrResult:
    def str_only(self) -> str:
        return ""

class BenchmarkRecord(TypedDict):
    name: str
    age: int

class BenchmarkA(TypedDict):
    kind: Literal["a"]
    value: int

class BenchmarkB(TypedDict):
    kind: Literal["b"]
    value: str
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
    const template = index % SCENARIO_TEMPLATE_COUNT;

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

function createBehaviorCases(): GeneratedCase[] {
    return [
        {
            id: 'behavior_generic_call',
            category: 'generic-call',
            description: 'Literal-sensitive assignment after generic identity',
            lines: [
                'value = identity(("tag", 4))',
                'exact: tuple[Literal["tag"], Literal[4]] = value  # benchmark: require-accept',
            ],
            revealExpression: 'value',
        },
        {
            id: 'behavior_narrowing',
            category: 'narrowing',
            description: 'Literal union retained across None narrowing',
            lines: [
                'value: int | None = 7 if bool(0) else None',
                'if value is not None:',
                '    narrowed = value',
                'else:',
                '    narrowed = 0',
                'exact: Literal[7, 0] = narrowed  # benchmark: require-accept',
            ],
            revealExpression: 'narrowed',
        },
        {
            id: 'behavior_literal_string',
            category: 'flow',
            description: 'LiteralString retained through branch flow',
            lines: [
                'candidate: int | str = 11 if bool(1) else "value"',
                'if isinstance(candidate, str):',
                '    value = candidate.upper()',
                'else:',
                '    value = candidate + 1',
                'if isinstance(value, str):',
                '    accepts_literal_string(value)  # benchmark: require-accept',
            ],
            revealExpression: 'value',
        },
        {
            id: 'behavior_generic_class',
            category: 'generic-class',
            description: 'Literal-sensitive generic class construction',
            lines: [
                '@dataclass',
                'class Box(Generic[T]):',
                '    value: T',
                '',
                'value = Box(("tag", 15))',
                'exact: Box[tuple[Literal["tag"], Literal[15]]] = value  # benchmark: require-accept',
            ],
            revealExpression: 'value',
        },
        {
            id: 'behavior_higher_order',
            category: 'higher-order',
            description: 'Literal retained through callback return inference',
            lines: [
                'def apply(callback: Callable[[int], T], value: int) -> T:',
                '    return callback(value)',
                '',
                'value = apply(lambda item: (item, "tag"), 16)',
                'exact: tuple[int, Literal["tag"]] = value  # benchmark: require-accept',
            ],
            revealExpression: 'value',
        },
        {
            id: 'behavior_ambiguous_overload',
            category: 'ambiguous-overload',
            description: 'Ambiguous overload with invariant Any argument',
            parameters: 'source: list[Any]',
            lines: [
                '@overload',
                'def choose(value: list[int]) -> list[int]: ...',
                '@overload',
                'def choose(value: list[str]) -> list[str]: ...',
                'def choose(value: Any) -> Any:',
                '    return value',
                '',
                'value = choose(source)',
                'value.append(1)  # benchmark: require-accept',
                'value.append("x")  # benchmark: require-accept',
                'value.append(3.14)  # benchmark: expect-error',
                'value.nonexistent()  # benchmark: expect-error',
            ],
            revealExpression: 'value',
        },
        {
            id: 'behavior_disjoint_overload',
            category: 'disjoint-overload',
            description: 'Ambiguous overload with disjoint result members',
            parameters: 'source: list[Any]',
            lines: [
                '@overload',
                'def choose(value: list[int]) -> BenchmarkIntResult: ...',
                '@overload',
                'def choose(value: list[str]) -> BenchmarkStrResult: ...',
                'def choose(value: Any) -> Any:',
                '    return BenchmarkIntResult()',
                '',
                'value = choose(source)',
                'value.int_only()  # benchmark: require-accept',
                'value.str_only()  # benchmark: require-accept',
                'value.missing()  # benchmark: expect-error',
            ],
            revealExpression: 'value',
        },
        {
            id: 'behavior_typed_dict_key',
            category: 'typed-dict-key',
            description: 'Literal key retained through a generic tuple',
            lines: [
                'record: BenchmarkRecord = {"name": "tag", "age": 19}',
                'pair = identity(("name", 19))',
                'key = pair[0]',
                'value = record[key]  # benchmark: require-accept',
                'value.upper()  # benchmark: require-accept',
            ],
            revealExpression: 'value',
        },
        {
            id: 'behavior_discriminated_union',
            category: 'discriminated-union',
            description: 'TypedDict discriminated union narrowing',
            parameters: 'item: BenchmarkA | BenchmarkB',
            lines: ['if item["kind"] == "a":', '    value = item["value"]', 'else:', '    value = item["value"]'],
            revealExpression: 'value',
        },
    ];
}

function renderCases(generatedCases: GeneratedCase[]): RenderedCorpus {
    const output: string[] = [...commonHeader.trimEnd().split('\n'), ''];
    const casesByRevealLine = new Map<number, GeneratedCase>();
    const expectedErrorsByLine = new Map<number, ProbeLocation>();
    const requiredAcceptsByLine = new Map<number, ProbeLocation>();

    for (const generatedCase of generatedCases) {
        output.push(`# ${generatedCase.id}: ${generatedCase.description}`);
        output.push(`def ${generatedCase.id}(${generatedCase.parameters || ''}) -> None:`);

        for (const line of generatedCase.lines) {
            const renderedLine = line ? `    ${line}` : '';
            output.push(renderedLine);

            const location = { generatedCase, source: line.replace(/\s+# benchmark: .+$/, '').trim() };
            if (line.includes('# benchmark: expect-error')) {
                expectedErrorsByLine.set(output.length, location);
            } else if (line.includes('# benchmark: require-accept')) {
                requiredAcceptsByLine.set(output.length, location);
            }
        }

        output.push(`    reveal_type(${generatedCase.revealExpression})`);
        casesByRevealLine.set(output.length, generatedCase);
        output.push('');
    }

    return {
        source: `${output.join('\n')}\n`,
        casesByRevealLine,
        expectedErrorsByLine,
        requiredAcceptsByLine,
    };
}

function renderCorpus(caseCount: number): RenderedCorpus {
    return renderCases(Array.from({ length: caseCount }, (_unused, index) => createCase(index)));
}

function renderBehaviorCorpus(): RenderedCorpus {
    return renderCases(createBehaviorCases());
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

function isBlockingDiagnostic(diagnostic: CheckerDiagnostic): boolean {
    return diagnostic.severity === 'error' || diagnostic.severity === 'warning' || diagnostic.severity === 'warn';
}

function getBehavioralProbeResults(
    probesByLine: Map<number, ProbeLocation>,
    pyright: CheckerResult,
    pyrefly: CheckerResult
): BehavioralProbeResult[] {
    return [...probesByLine].map(([line, location]) => ({
        line,
        location,
        pyrightDiagnostics: pyright.diagnostics.filter(
            (diagnostic) => diagnostic.line === line && isBlockingDiagnostic(diagnostic)
        ),
        pyreflyDiagnostics: pyrefly.diagnostics.filter(
            (diagnostic) => diagnostic.line === line && isBlockingDiagnostic(diagnostic)
        ),
    }));
}

function getOrdinaryDiagnostics(checker: CheckerResult, corpus: RenderedCorpus): CheckerDiagnostic[] {
    return checker.diagnostics.filter(
        (diagnostic) =>
            isBlockingDiagnostic(diagnostic) &&
            !corpus.expectedErrorsByLine.has(diagnostic.line) &&
            !corpus.requiredAcceptsByLine.has(diagnostic.line)
    );
}

function escapeTableCell(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
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
        case 'ambiguous-overload':
        case 'disjoint-overload':
            return 'A gradual fallback avoids committing to one overload result, but it also removes member information and suppresses downstream argument and attribute diagnostics. This is a capability tradeoff rather than display-only widening.';
        case 'typed-dict-key':
            return 'Widening the generic tuple element to str avoids value-sensitive inference, but the widened key can no longer index a TypedDict. The policy therefore creates an observable rejection in otherwise valid code.';
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

function describeDiagnostics(diagnostics: CheckerDiagnostic[]): string {
    if (diagnostics.length === 0) {
        return '';
    }

    return diagnostics.map((diagnostic) => diagnostic.rule || diagnostic.message).join('; ');
}

function writeMarkdownReport(
    outputPath: string,
    options: Options,
    comparisons: CaseComparison[],
    precisionRun: ComparisonRun,
    behaviorRun: ComparisonRun
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
    const expectedErrorResults = getBehavioralProbeResults(
        behaviorRun.corpus.expectedErrorsByLine,
        behaviorRun.pyright,
        behaviorRun.pyrefly
    );
    const requiredAcceptResults = getBehavioralProbeResults(
        behaviorRun.corpus.requiredAcceptsByLine,
        behaviorRun.pyright,
        behaviorRun.pyrefly
    );
    const pyrightCaughtErrors = expectedErrorResults.filter((result) => result.pyrightDiagnostics.length > 0).length;
    const pyreflyCaughtErrors = expectedErrorResults.filter((result) => result.pyreflyDiagnostics.length > 0).length;
    const pyrightAccepted = requiredAcceptResults.filter((result) => result.pyrightDiagnostics.length === 0).length;
    const pyreflyAccepted = requiredAcceptResults.filter((result) => result.pyreflyDiagnostics.length === 0).length;
    const ordinaryPyrightDiagnostics = [
        ...getOrdinaryDiagnostics(precisionRun.pyright, precisionRun.corpus),
        ...getOrdinaryDiagnostics(behaviorRun.pyright, behaviorRun.corpus),
    ];
    const ordinaryPyreflyDiagnostics = [
        ...getOrdinaryDiagnostics(precisionRun.pyrefly, precisionRun.corpus),
        ...getOrdinaryDiagnostics(behaviorRun.pyrefly, behaviorRun.corpus),
    ];
    const ordinaryDiagnosticCount = ordinaryPyrightDiagnostics.length + ordinaryPyreflyDiagnostics.length;
    const assessment =
        missing > 0 || ordinaryDiagnosticCount > 0
            ? 'Not ready for an automatic switch decision: missing reveals or unclassified diagnostics need triage.'
            : pyrightCaughtErrors > pyreflyCaughtErrors || pyrightAccepted > pyreflyAccepted
            ? 'Pyright preserved more downstream checking or narrow-type capabilities in this corpus; review the behavioral probes separately from display precision.'
            : pyreflyCaughtErrors > pyrightCaughtErrors || pyreflyAccepted > pyrightAccepted
            ? 'Pyrefly preserved more downstream checking or narrow-type capabilities in this corpus; review the behavioral probes separately from display precision.'
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
        `| Scenario templates | ${SCENARIO_TEMPLATE_COUNT} |`,
        `| Behavioral cases | ${behaviorRun.corpus.casesByRevealLine.size} |`,
        `| Python version | ${escapeTableCell(options.pythonVersion)} |`,
        `| Precision corpus | \`${escapeTableCell(
            path.relative(path.dirname(outputPath), precisionRun.corpusPath)
        )}\` |`,
        `| Behavioral corpus | \`${escapeTableCell(
            path.relative(path.dirname(outputPath), behaviorRun.corpusPath)
        )}\` |`,
        `| Pyright | ${escapeTableCell(precisionRun.pyright.version)} |`,
        `| Pyrefly | ${escapeTableCell(precisionRun.pyrefly.version)} |`,
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
        '| Checker | Reveals | Non-reveal diagnostics | Time | Exit code |',
        '|---|---:|---:|---:|---:|',
        `| Pyright | ${precisionRun.pyright.reveals.size + behaviorRun.pyright.reveals.size} | ${
            precisionRun.pyright.diagnostics.length + behaviorRun.pyright.diagnostics.length
        } | ${formatDuration(precisionRun.pyright.durationMs + behaviorRun.pyright.durationMs)} | ${
            precisionRun.pyright.exitCode ?? 'none'
        } / ${behaviorRun.pyright.exitCode ?? 'none'} |`,
        `| Pyrefly | ${precisionRun.pyrefly.reveals.size + behaviorRun.pyrefly.reveals.size} | ${
            precisionRun.pyrefly.diagnostics.length + behaviorRun.pyrefly.diagnostics.length
        } | ${formatDuration(precisionRun.pyrefly.durationMs + behaviorRun.pyrefly.durationMs)} | ${
            precisionRun.pyrefly.exitCode ?? 'none'
        } / ${behaviorRun.pyrefly.exitCode ?? 'none'} |`,
        '',
        'Timing is a single cold process run and is included only as context, not as a stable performance benchmark.',
        '',
        '## Behavioral probes',
        '',
        'Behavioral probes distinguish display-only widening from observable checker behavior. `expect-error` probes are intentionally invalid operations that should remain diagnosed. `require-accept` probes exercise capabilities made available by a narrower inferred type; disagreement here can reflect a deliberate inference policy rather than a correctness bug.',
        '',
        '| Probe kind | Total | Pyright | Pyrefly |',
        '|---|---:|---:|---:|',
        `| Expected errors caught | ${expectedErrorResults.length} | ${pyrightCaughtErrors} | ${pyreflyCaughtErrors} |`,
        `| Required accepts accepted | ${requiredAcceptResults.length} | ${pyrightAccepted} | ${pyreflyAccepted} |`,
        '',
        '### Behavioral differences',
        '',
        '| Kind | Case | Probe | Pyright | Pyrefly |',
        '|---|---|---|---|---|',
    ];

    const expectedErrorDifferences = expectedErrorResults.filter(
        (result) => result.pyrightDiagnostics.length > 0 !== result.pyreflyDiagnostics.length > 0
    );
    const requiredAcceptDifferences = requiredAcceptResults.filter(
        (result) => (result.pyrightDiagnostics.length === 0) !== (result.pyreflyDiagnostics.length === 0)
    );

    if (expectedErrorDifferences.length === 0 && requiredAcceptDifferences.length === 0) {
        lines.push('| _None_ | | | | |');
    } else {
        for (const result of expectedErrorDifferences) {
            lines.push(
                `| expect-error | ${result.location.generatedCase.id} | \`${escapeTableCell(
                    result.location.source
                )}\` | ${
                    result.pyrightDiagnostics.length > 0
                        ? `caught (${escapeTableCell(describeDiagnostics(result.pyrightDiagnostics))})`
                        : 'missed'
                } | ${
                    result.pyreflyDiagnostics.length > 0
                        ? `caught (${escapeTableCell(describeDiagnostics(result.pyreflyDiagnostics))})`
                        : 'missed'
                } |`
            );
        }
        for (const result of requiredAcceptDifferences) {
            lines.push(
                `| require-accept | ${result.location.generatedCase.id} | \`${escapeTableCell(
                    result.location.source
                )}\` | ${
                    result.pyrightDiagnostics.length === 0
                        ? 'accepted'
                        : `rejected (${escapeTableCell(describeDiagnostics(result.pyrightDiagnostics))})`
                } | ${
                    result.pyreflyDiagnostics.length === 0
                        ? 'accepted'
                        : `rejected (${escapeTableCell(describeDiagnostics(result.pyreflyDiagnostics))})`
                } |`
            );
        }
    }

    lines.push(
        '',
        '## Pyrefly-side interpretation',
        '',
        'The narrower-output count is intentionally adversarially reviewed below. These arguments do not prove that Pyrefly is correct; they explain why widening can be a deliberate and useful inference policy rather than a loss of capability.',
        '',
        '| Family | Count | Example | Strongest Pyrefly argument |',
        '|---|---:|---|---|'
    );

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

    lines.push('', '## Unclassified diagnostics', '');
    for (const [checkerName, diagnostics] of [
        ['Pyright', ordinaryPyrightDiagnostics],
        ['Pyrefly', ordinaryPyreflyDiagnostics],
    ] as const) {
        lines.push(`### ${checkerName}`, '');
        if (diagnostics.length === 0) {
            lines.push('_None._', '');
        } else {
            lines.push('| Line | Severity | Rule | Message |', '|---:|---|---|---|');
            for (const diagnostic of diagnostics) {
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
        '- `expect-error` probes measure whether invalid operations remain diagnosed after inference.',
        '- `require-accept` probes measure whether a narrower result enables an operation; these are capability comparisons rather than automatic correctness judgments.',
        '- All other concrete differences are intentionally left unresolved.',
        '- A production switch should additionally run both checkers over representative repositories and adjudicate error false positives, false negatives, suppression behavior, configuration parity, and IDE features.',
        ''
    );

    const pyrightStderr = [precisionRun.pyright.stderr, behaviorRun.pyright.stderr].filter(Boolean).join('\n');
    const pyreflyStderr = [precisionRun.pyrefly.stderr, behaviorRun.pyrefly.stderr].filter(Boolean).join('\n');
    if (pyrightStderr) {
        lines.push('## Pyright stderr', '', '```text', pyrightStderr, '```', '');
    }
    if (pyreflyStderr) {
        lines.push('## Pyrefly stderr', '', '```text', pyreflyStderr, '```', '');
    }

    fs.writeFileSync(outputPath, lines.join('\n'), 'utf8');
}

function main(): void {
    const options = parseOptions(process.argv.slice(2));
    fs.mkdirSync(options.outputDirectory, { recursive: true });

    const precisionCorpus = renderCorpus(options.caseCount);
    const behaviorCorpus = renderBehaviorCorpus();
    const precisionCorpusPath = path.join(options.outputDirectory, 'generated_type_inference_corpus.py');
    const behaviorCorpusPath = path.join(options.outputDirectory, 'generated_behavior_corpus.py');
    const reportPath = path.join(options.outputDirectory, 'type-inference-comparison.md');
    fs.writeFileSync(precisionCorpusPath, precisionCorpus.source, 'utf8');
    fs.writeFileSync(behaviorCorpusPath, behaviorCorpus.source, 'utf8');

    console.log(`Generated ${options.caseCount} precision cases in ${precisionCorpusPath}`);
    console.log(`Generated ${behaviorCorpus.casesByRevealLine.size} behavioral cases in ${behaviorCorpusPath}`);
    const workingDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'type-inference-comparison-'));
    const workingPrecisionCorpusPath = path.join(workingDirectory, path.basename(precisionCorpusPath));
    const workingBehaviorCorpusPath = path.join(workingDirectory, path.basename(behaviorCorpusPath));
    fs.writeFileSync(workingPrecisionCorpusPath, precisionCorpus.source, 'utf8');
    fs.writeFileSync(workingBehaviorCorpusPath, behaviorCorpus.source, 'utf8');

    try {
        const precisionRun: ComparisonRun = {
            corpusPath: precisionCorpusPath,
            corpus: precisionCorpus,
            pyright: runPyright(workingPrecisionCorpusPath, options.pythonVersion),
            pyrefly: runPyrefly(workingPrecisionCorpusPath, options.pythonVersion, options.pyreflyCommand),
        };
        const behaviorRun: ComparisonRun = {
            corpusPath: behaviorCorpusPath,
            corpus: behaviorCorpus,
            pyright: runPyright(workingBehaviorCorpusPath, options.pythonVersion),
            pyrefly: runPyrefly(workingBehaviorCorpusPath, options.pythonVersion, options.pyreflyCommand),
        };
        console.log(
            `Pyright: ${
                precisionRun.pyright.reveals.size + behaviorRun.pyright.reveals.size
            } reveals in ${formatDuration(precisionRun.pyright.durationMs + behaviorRun.pyright.durationMs)}`
        );
        console.log(
            `Pyrefly: ${
                precisionRun.pyrefly.reveals.size + behaviorRun.pyrefly.reveals.size
            } reveals in ${formatDuration(precisionRun.pyrefly.durationMs + behaviorRun.pyrefly.durationMs)}`
        );

        const comparisons = [
            ...compareCases(precisionRun.corpus, precisionRun.pyright, precisionRun.pyrefly),
            ...compareCases(behaviorRun.corpus, behaviorRun.pyright, behaviorRun.pyrefly),
        ];
        writeMarkdownReport(reportPath, options, comparisons, precisionRun, behaviorRun);
        console.log(`Markdown report written to ${reportPath}`);
    } finally {
        fs.rmSync(workingDirectory, { recursive: true });
    }
}

main();
