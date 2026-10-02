/*
 * nativeAdapter.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * AST instrumentation for supported unbundled CommonJS builds. Hook locations
 * are derived from syntax, never byte/line replacements. No files are changed.
 */

import * as ts from 'typescript';

export interface HookSite {
    id: string;
    file: string;
    label: string;
    line: number;
    start: number;
    length: number;
    text: string;
}

interface AdapterModule {
    functions: string[];
    optionalFunctions?: string[];
    factory?: string;
    state?: string[];
    required: string[];
}

export const adapterVersion = 'native-commonjs-v1';
const modules: Record<string, AdapterModule> = {
    'analyzer/typeEvaluator.js': {
        factory: 'createTypeEvaluator',
        state: [
            'typeCache',
            'expectedTypeCache',
            'typeFormTypeCache',
            'incompleteGenCount',
            'codeFlowAnalyzerCache',
            'returnTypeInferenceTypeCache',
            'returnTypeInferenceContextStack',
            'suppressedNodeStack',
            'signatureTrackerStack',
            'symbolResolutionStack',
            'deferredClassCompletions',
            'speculativeTypeTracker',
        ],
        functions: [
            'getTypeOfExpression',
            'readTypeCacheEntry',
            'readTypeFormTypeCacheEntry',
            'isTypeCacheEntryValid',
            'readTypeCache',
            'writeTypeCache',
            'addExpectedTypeCacheEntry',
            'validateCallArgs',
            'validateArgType',
            'inferFunctionReturnType',
            'disposeEvaluator',
        ],
        required: ['collection', 'branch', 'generation', 'field-write'],
    },
    'analyzer/codeFlowEngine.js': {
        factory: 'getCodeFlowEngine',
        state: ['flowIncompleteGeneration', 'reachabilityCache', 'callIsNoReturnCache', 'isReachableRecursionSet'],
        functions: [
            'createCodeFlowAnalyzer',
            'getTypeFromCodeFlow',
            'getTypeFromFlowNode',
            'setCacheEntry',
            'setIncompleteSubtype',
            'getCacheEntry',
            'preventRecursion',
            'getFlowNodeReachability',
            'isCallNoReturn',
        ],
        required: ['collection', 'branch', 'generation', 'field-write'],
    },
    'analyzer/typeCacheUtils.js': {
        optionalFunctions: ['findContextualTypeCacheEntry'],
        functions: [
            'contextualTypeCacheEntryMatches',
            'addContextualTypeCacheEntry',
            'enterSpeculativeContext',
            'leaveSpeculativeContext',
            'trackEntry',
            'disableSpeculativeMode',
            'enableSpeculativeMode',
            'getSpeculativeType',
            'addSpeculativeType',
            '_dependentTypesMatch',
        ],
        required: ['collection', 'branch'],
    },
    'analyzer/constraintTracker.js': {
        functions: ['ConstraintSet.setBounds', 'ConstraintSet.getTypeVar', 'ConstraintTracker.setBounds'],
        required: ['collection'],
    },
    'common/diagnosticSink.js': {
        functions: ['fetchAndClear', 'addDiagnostic', 'addDiagnostics'],
        required: ['collection'],
    },
    'analyzer/analyzerNodeInfo.js': {
        functions: ['AnalyzerNodeInfoStore.setFileInfo'],
        required: [],
    },
    'analyzer/overloadResultController.js': {
        functions: ['_trial', 'evaluate', 'evaluateAndContinue', 'beforeCall'],
        required: ['collection', 'branch', 'evaluator-link'],
    },
};

export function adapterFiles(experimental: boolean) {
    return Object.keys(modules).filter((file) => experimental || !file.includes('overloadResultController'));
}

const bridgeName = '__pyrightTrace';

function parseExpression(text: string): ts.Expression {
    const file = ts.createSourceFile('hook.js', `(${text});`, ts.ScriptTarget.ES2020, false, ts.ScriptKind.JS);
    return synthesize((file.statements[0] as ts.ExpressionStatement).expression);
}

function parseStatements(text: string): readonly ts.Statement[] {
    return ts
        .createSourceFile('hook.js', text, ts.ScriptTarget.ES2020, false, ts.ScriptKind.JS)
        .statements.map(synthesize);
}

function synthesize<T extends ts.Node>(node: T): T {
    ts.setTextRange(node, { pos: -1, end: -1 });
    ts.forEachChild(node, (child) => {
        synthesize(child);
    });
    return node;
}

export function instrument(
    file: string,
    code: string,
    experimental = false
): { code: string; sites: HookSite[]; counts: Record<string, number> } {
    let spec = modules[file];
    if (!spec) {
        throw new Error(`No adapter for ${file}`);
    }
    if (experimental && file === 'analyzer/typeCacheUtils.js') {
        spec = {
            ...spec,
            functions: [...spec.functions, 'useNodeCacheIsolation', 'SpeculativeTypeTracker.useNodeCacheIsolation'],
        };
    }
    const source = ts.createSourceFile(file, code, ts.ScriptTarget.ES2020, true, ts.ScriptKind.JS);
    const sites: HookSite[] = [];
    const counts: Record<string, number> = {};
    const matches = new Map([...spec.functions, ...(spec.optionalFunctions ?? [])].map((name) => [name, 0]));
    const declarations = new Set<string>();
    let collisions = false;
    const scan = (node: ts.Node) => {
        if (ts.isIdentifier(node)) {
            if (node.text.startsWith('__ptr') || node.text === bridgeName) {
                collisions = true;
            }
        }
        if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
            declarations.add(node.name.text);
        }
        ts.forEachChild(node, scan);
    };
    scan(source);
    if (collisions) {
        throw new Error(`Adapter identifier collision in ${file}`);
    }
    for (const name of spec.state ?? []) {
        if (!declarations.has(name)) {
            throw new Error(`Adapter drift: missing state ${file}:${name}`);
        }
    }
    const site = (node: ts.Node, label: string, kind: string) => {
        counts[kind] = (counts[kind] ?? 0) + 1;
        const result: HookSite = {
            id: `${file}:${sites.length + 1}`,
            file,
            label,
            start: node.getStart(source),
            length: node.getWidth(source),
            line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
            text: node.getText(source).slice(0, 1000),
        };
        sites.push(result);
        return ts.factory.createStringLiteral(result.id);
    };
    const call = (name: string, args: ts.Expression[]) =>
        ts.factory.createCallExpression(
            ts.factory.createPropertyAccessExpression(ts.factory.createIdentifier(bridgeName), name),
            undefined,
            args
        );
    let currentFunction = '';
    let currentClass = '';
    let selected = false;
    let inFactory = false;
    let currentOwner = 'undefined';
    let parameters: string[] = [];
    let factoryCount = 0;
    const transform: ts.TransformerFactory<ts.SourceFile> = (context) => {
        const visit: ts.Visitor = (node) => {
            if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
                const saved = currentClass;
                currentClass = node.name?.text ?? '';
                const updated = ts.visitEachChild(node, visit, context);
                currentClass = saved;
                return updated;
            }
            if (
                ts.isFunctionDeclaration(node) ||
                ts.isFunctionExpression(node) ||
                ts.isArrowFunction(node) ||
                ts.isMethodDeclaration(node)
            ) {
                const name =
                    node.name && ts.isIdentifier(node.name)
                        ? node.name.text
                        : ts.isVariableDeclaration(node.parent) && ts.isIdentifier(node.parent.name)
                        ? node.parent.name.text
                        : ts.isBinaryExpression(node.parent) && ts.isPropertyAccessExpression(node.parent.left)
                        ? node.parent.left.name.text
                        : '';
                const qualified = `${currentClass}.${name}`;
                const key = matches.has(qualified) ? qualified : name;
                const isSelected = matches.has(key);
                const isFlowAnalyzer = file === 'analyzer/codeFlowEngine.js' && name === 'createCodeFlowAnalyzer';
                const isFactory = name === spec.factory || isFlowAnalyzer;
                if (isSelected) {
                    matches.set(key, matches.get(key)! + 1);
                }
                if (name === spec.factory) {
                    factoryCount++;
                }
                if ((isSelected || isFactory) && (!node.body || !ts.isBlock(node.body))) {
                    throw new Error(`Adapter drift: expected block body ${file}:${name}`);
                }
                if (isFactory && node.body && ts.isBlock(node.body)) {
                    const declared = new Set(
                        node.body.statements.flatMap((s) =>
                            ts.isVariableStatement(s)
                                ? s.declarationList.declarations.flatMap((d) =>
                                      ts.isIdentifier(d.name) ? [d.name.text] : []
                                  )
                                : []
                        )
                    );
                    for (const state of isFlowAnalyzer ? ['flowNodeTypeCacheSet'] : spec.state!) {
                        if (!declared.has(state)) {
                            throw new Error(`Adapter drift: ${name} does not directly declare state ${state}`);
                        }
                    }
                }
                if (
                    isSelected &&
                    (node.parameters.some((p) => !ts.isIdentifier(p.name) || !!p.dotDotDotToken) ||
                        node.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword) ||
                        ('asteriskToken' in node && node.asteriskToken))
                ) {
                    throw new Error(`Unsupported asynchronous/generator/destructured hook ${file}:${name}`);
                }
                const previous = { currentFunction, selected, inFactory, currentOwner, parameters };
                currentFunction = name;
                selected = isSelected;
                inFactory = isFactory || inFactory;
                parameters = node.parameters.map((p) => p.name.getText(source));
                if (isFactory) {
                    currentOwner = `__ptrOwner_${name}`;
                }
                let updated = ts.visitEachChild(node, visit, context);
                if ((isSelected || isFactory) && updated.body && ts.isBlock(updated.body)) {
                    let statements = [...updated.body.statements];
                    if (isFactory) {
                        const state = isFlowAnalyzer ? ['flowNodeTypeCacheSet'] : spec.state!;
                        const parent = name === 'getCodeFlowEngine' ? 'evaluator' : previous.currentOwner;
                        statements.unshift(
                            ...parseStatements(
                                `${bridgeName}.owner(${currentOwner}, ${JSON.stringify(name)}, () => ({${state.join(
                                    ','
                                )}}), ${parent});`
                            )
                        );
                    }
                    if (isSelected) {
                        const hook = site(node, key, 'function');
                        const args = parameters;
                        const owner = currentOwner;
                        const receiver = ts.isMethodDeclaration(node) ? 'this' : 'undefined';
                        const prefix = parseStatements(
                            `const __ptrSpan = ${bridgeName}.enter(${JSON.stringify(hook.text)}, ${owner}, ` +
                                `{${args.join(',')}}, ${receiver});`
                        );
                        const originalBody = ts.factory.createBlock(statements, true);
                        const caught = ts.factory.createCatchClause(
                            '__ptrError',
                            ts.factory.createBlock(
                                [
                                    ts.factory.createExpressionStatement(
                                        call('thrown', [
                                            ts.factory.createIdentifier('__ptrSpan'),
                                            ts.factory.createIdentifier('__ptrError'),
                                        ])
                                    ),
                                    ts.factory.createThrowStatement(ts.factory.createIdentifier('__ptrError')),
                                ],
                                true
                            )
                        );
                        const final = ts.factory.createBlock(
                            [
                                ts.factory.createExpressionStatement(
                                    call('exit', [ts.factory.createIdentifier('__ptrSpan')])
                                ),
                            ],
                            true
                        );
                        statements = [...prefix, ts.factory.createTryStatement(originalBody, caught, final)];
                    }
                    if (isFactory) {
                        statements.unshift(...parseStatements(`const ${currentOwner} = {};`));
                    }
                    const body = ts.factory.updateBlock(updated.body, statements);
                    if (ts.isFunctionDeclaration(updated)) {
                        updated = ts.factory.updateFunctionDeclaration(
                            updated,
                            updated.modifiers,
                            updated.asteriskToken,
                            updated.name,
                            updated.typeParameters,
                            updated.parameters,
                            updated.type,
                            body
                        );
                    } else if (ts.isMethodDeclaration(updated)) {
                        updated = ts.factory.updateMethodDeclaration(
                            updated,
                            updated.modifiers,
                            updated.asteriskToken,
                            updated.name,
                            updated.questionToken,
                            updated.typeParameters,
                            updated.parameters,
                            updated.type,
                            body
                        );
                    } else if (ts.isArrowFunction(updated)) {
                        updated = ts.factory.updateArrowFunction(
                            updated,
                            updated.modifiers,
                            updated.typeParameters,
                            updated.parameters,
                            updated.type,
                            updated.equalsGreaterThanToken,
                            body
                        );
                    } else if (ts.isFunctionExpression(updated)) {
                        updated = ts.factory.updateFunctionExpression(
                            updated,
                            updated.modifiers,
                            updated.asteriskToken,
                            updated.name,
                            updated.typeParameters,
                            updated.parameters,
                            updated.type,
                            body
                        );
                    }
                }
                ({ currentFunction, selected, inFactory, currentOwner, parameters } = previous);
                return updated;
            }
            if (ts.isReturnStatement(node)) {
                const value = node.expression
                    ? (ts.visitNode(node.expression, visit) as ts.Expression)
                    : ts.factory.createIdentifier('undefined');
                if (selected) {
                    const result =
                        currentFunction === 'createCodeFlowAnalyzer'
                            ? call('bind', [ts.factory.createIdentifier(currentOwner), value])
                            : value;
                    return ts.factory.updateReturnStatement(
                        node,
                        call('returned', [
                            ts.factory.createIdentifier('__ptrSpan'),
                            result,
                            parseExpression(`{${parameters.join(',')}}`),
                            site(node, currentFunction, 'return'),
                        ])
                    );
                }
                if (currentFunction === spec.factory) {
                    return ts.factory.updateReturnStatement(
                        node,
                        call('bind', [ts.factory.createIdentifier(currentOwner), value])
                    );
                }
            }
            if (
                currentFunction === '_trial' &&
                ts.isVariableStatement(node) &&
                node.declarationList.declarations.some((d) => ts.isIdentifier(d.name) && d.name.text === 'evaluator')
            ) {
                counts['evaluator-link'] = (counts['evaluator-link'] ?? 0) + 1;
                return [
                    ts.visitEachChild(node, visit, context),
                    ...parseStatements(`${bridgeName}.linkCurrent(evaluator);`),
                ];
            }
            if (selected && ts.isIfStatement(node)) {
                return ts.factory.updateIfStatement(
                    node,
                    call('branch', [
                        site(node.expression, currentFunction, 'branch'),
                        ts.visitNode(node.expression, visit) as ts.Expression,
                    ]),
                    ts.visitNode(node.thenStatement, visit) as ts.Statement,
                    ts.visitNode(node.elseStatement, visit) as ts.Statement | undefined
                );
            }
            if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && !node.questionDotToken) {
                const receiver = node.expression.expression;
                const method = node.expression.name.text;
                const receiverText = receiver.getText(source);
                // These names identify native state containers, not Python fixtures or
                // selected source functions. The manifest reports every matched site.
                if (
                    /cache|stack|pendingNodes|closedFinallyGateNodes|incompleteEntries|candidates|_typeVarMap|_diagnostic|entriesToUndo|_activeDependentTypes|RecursionSet/i.test(
                        receiverText
                    ) &&
                    ['get', 'has', 'set', 'delete', 'clear', 'add', 'push', 'pop'].includes(method) &&
                    !node.expression.questionDotToken
                ) {
                    return ts.factory.updateCallExpression(
                        node,
                        call('method', [
                            site(node, currentFunction, 'collection'),
                            ts.visitNode(receiver, visit) as ts.Expression,
                            ts.factory.createStringLiteral(method),
                        ]),
                        undefined,
                        node.arguments.map((arg) => ts.visitNode(arg, visit) as ts.Expression)
                    );
                }
            }
            if (
                (ts.isPostfixUnaryExpression(node) || ts.isPrefixUnaryExpression(node)) &&
                ts.isIdentifier(node.operand) &&
                ['incompleteGenCount', 'flowIncompleteGeneration'].includes(node.operand.text)
            ) {
                return call('effect', [
                    site(node, node.operand.text, 'generation'),
                    node,
                    parseExpression(`{value:${node.operand.text}, domain:${JSON.stringify(node.operand.text)}}`),
                ]);
            }
            if (
                ts.isBinaryExpression(node) &&
                node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
                ts.isPropertyAccessExpression(node.left) &&
                (selected || node.left.name.text === 'inferredReturnType')
            ) {
                const receiver = node.left.expression;
                if (
                    ts.isIdentifier(receiver) ||
                    receiver.kind === ts.SyntaxKind.ThisKeyword ||
                    (ts.isPropertyAccessExpression(receiver) && ts.isIdentifier(receiver.expression))
                ) {
                    return call('effect', [
                        site(node, currentFunction, 'field-write'),
                        ts.visitEachChild(node, visit, context),
                        ts.factory.createObjectLiteralExpression([
                            ts.factory.createPropertyAssignment('target', receiver),
                            ts.factory.createPropertyAssignment(
                                'field',
                                ts.factory.createStringLiteral(node.left.name.text)
                            ),
                        ]),
                    ]);
                }
            }
            return ts.visitEachChild(node, visit, context);
        };
        return (root) => ts.visitNode(root, visit) as ts.SourceFile;
    };
    const result = ts.transform(source, [transform]);
    try {
        for (const [name, count] of matches) {
            counts[`function:${name}`] = count;
            if (count !== 1 && !(count === 0 && spec.optionalFunctions?.includes(name))) {
                throw new Error(`Adapter drift: expected one ${file}:${name}, found ${count}`);
            }
        }
        if (spec.factory && factoryCount !== 1) {
            throw new Error(`Adapter drift: expected one factory ${file}:${spec.factory}, found ${factoryCount}`);
        }
        for (const kind of spec.required) {
            if (!counts[kind]) {
                throw new Error(`Adapter drift: missing ${kind} in ${file}`);
            }
        }
        return { code: ts.createPrinter().printFile(result.transformed[0]), sites, counts };
    } finally {
        result.dispose();
    }
}
