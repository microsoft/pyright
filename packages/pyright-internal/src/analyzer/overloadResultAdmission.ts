/*
 * overloadResultAdmission.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Conservative local-use admission for the fixed-seed experiment.
 */

import { CallNode, isExpressionNode, ModuleNode, NameNode, ParseNode, ParseNodeType } from '../parser/parseNodes';
import { AnalyzerNodeInfoAccessor } from './analyzerNodeInfo';
import { FlowAssignment, FlowFlags, FlowLabel, FlowNode } from './codeFlowTypes';
import { DeclarationType } from './declaration';
import type { FixedOverloadResultSeed, LocalOverloadOperation, OverloadResultLimits } from './overloadResultController';
import { getEnclosingFunction, isImplicitRevealTypeName } from './parseTreeUtils';
import { ParseTreeWalker } from './parseTreeWalker';
import { Symbol } from './symbol';
import { TypeEvaluator } from './typeEvaluatorTypes';

export class OverloadResultAdmissionLimit extends Error {}

const maxProjectionDeclarations = 32;
const maxReachingVisits = 256;

class BoundedNodes extends ParseTreeWalker {
    readonly nodes: ParseNode[] = [];

    constructor(private _limit: number) {
        super();
    }

    override visitNode(node: ParseNode) {
        if (this.nodes.length >= this._limit) {
            throw new OverloadResultAdmissionLimit('node-limit');
        }
        this.nodes.push(node);
        return super.visitNode(node);
    }
}

export function collectOverloadResultNodes(node: ParseNode, limit: number): ParseNode[] {
    const walker = new BoundedNodes(limit);
    walker.walk(node);
    return walker.nodes;
}

export interface LocalOverloadAdmission {
    nodes: readonly ParseNode[];
    records: Map<ParseNode, LocalOverloadOperation>;
    byNode: Map<ParseNode, LocalOverloadOperation>;
    definitions: Map<NameNode, LocalOverloadOperation>;
    reaching: Map<NameNode, LocalOverloadOperation>;
    decisions: Map<LocalOverloadOperation, Set<string>>;
    graphUnits: number;
    complete: boolean;
    reason?: string;
}

export function admitLocalOverloadResults(
    module: ModuleNode,
    seeds: readonly FixedOverloadResultSeed[],
    evaluator: TypeEvaluator,
    info: AnalyzerNodeInfoAccessor,
    limits: OverloadResultLimits
): LocalOverloadAdmission {
    const result: LocalOverloadAdmission = {
        nodes: [],
        records: new Map(),
        byNode: new Map(),
        definitions: new Map(),
        reaching: new Map(),
        decisions: new Map(),
        graphUnits: 0,
        complete: false,
    };
    const charge = () => {
        if (result.graphUnits >= limits.graphUnits) {
            throw new OverloadResultAdmissionLimit('graph-limit');
        }
        result.graphUnits++;
    };
    const symbolCache = new Map<NameNode, Symbol | undefined>();
    const symbol = (node: NameNode) => {
        if (!symbolCache.has(node)) {
            charge();
            symbolCache.set(node, evaluator.lookUpSymbolRecursive(node, node.d.value, true)?.symbol);
        }
        return symbolCache.get(node);
    };
    const reject = (origins: ReadonlySet<LocalOverloadOperation>, reason: string) => {
        origins.forEach((seed) => result.decisions.get(seed)?.add(reason));
    };
    try {
        result.nodes = collectOverloadResultNodes(module, limits.nodes);
        if (seeds.length > limits.records) {
            throw new OverloadResultAdmissionLimit('seed-limit');
        }
        const nodeSet = new Set(result.nodes);
        const seedMap = new Map(seeds.map((seed) => [seed.node, seed]));
        for (const node of result.nodes) {
            if (node.nodeType !== ParseNodeType.StatementList || node.d.statements.length !== 1) {
                continue;
            }
            const statement = node.d.statements[0];
            const fn = getEnclosingFunction(statement);
            if (!fn || (statement.nodeType !== ParseNodeType.Assignment && !isExpressionNode(statement))) {
                continue;
            }
            let nodes: ParseNode[];
            try {
                nodes = collectOverloadResultNodes(node, limits.rootNodes);
            } catch (error) {
                if (!(error instanceof OverloadResultAdmissionLimit)) {
                    throw error;
                }
                continue;
            }
            const assignment = statement.nodeType === ParseNodeType.Assignment ? statement : undefined;
            const left = assignment?.d.leftExpr;
            const target = left?.nodeType === ParseNodeType.TypeAnnotation ? left.d.valueExpr : left;
            if (target && target.nodeType !== ParseNodeType.Name) {
                continue;
            }
            if (result.records.size >= limits.records) {
                throw new OverloadResultAdmissionLimit('record-limit');
            }
            const expression = statement.nodeType === ParseNodeType.Assignment ? statement.d.rightExpr : statement;
            const containedSeeds = nodes.filter(
                (n): n is CallNode => n.nodeType === ParseNodeType.Call && seedMap.has(n)
            );
            const seed = containedSeeds.length === 1 ? seedMap.get(containedSeeds[0]) : undefined;
            const valueNodes = new Set(collectOverloadResultNodes(expression, limits.rootNodes));
            if (target) {
                valueNodes.add(target);
            }
            const record: LocalOverloadOperation = {
                root: node,
                statement,
                expression,
                assignment,
                target,
                annotated: left?.nodeType === ParseNodeType.TypeAnnotation || !!assignment?.d.annotationComment,
                fn,
                nodes,
                ids: new Set(nodes.map((n) => n.id)),
                valueNodes,
                seed,
                admitted: false,
                reader: false,
            };
            result.records.set(node, record);
            nodes.forEach((n) => result.byNode.set(n, record));
            if (target) {
                result.definitions.set(target, record);
            }
            if (seed) {
                result.decisions.set(record, new Set());
            } else if (containedSeeds.length > 1) {
                // No partial injection of a statement containing several seeds.
                record.admitted = false;
            }
        }

        const origins = new Map<LocalOverloadOperation, Set<LocalOverloadOperation>>();
        const symbolDefs = new Map<number, LocalOverloadOperation[]>();
        for (const record of result.records.values()) {
            charge();
            origins.set(record, new Set(record.seed ? [record] : []));
            const sym = record.target && symbol(record.target);
            if (sym) {
                const defs = symbolDefs.get(sym.id) ?? [];
                defs.push(record);
                symbolDefs.set(sym.id, defs);
            }
        }
        const reads = new Map<NameNode, { defs: LocalOverloadOperation[]; ambiguous: boolean; captured: boolean }>();
        for (const node of result.nodes) {
            if (
                node.nodeType !== ParseNodeType.Name ||
                result.definitions.has(node) ||
                (node.parent?.nodeType === ParseNodeType.MemberAccess && node.parent.d.member === node)
            ) {
                continue;
            }
            charge();
            const sym = symbol(node);
            const declarations = sym && symbolDefs.get(sym.id);
            if (!sym || !declarations) {
                continue;
            }
            const targets = new Set<ParseNode>();
            const visited = new Set<number>();
            let complex = false;
            function walk(flow: FlowNode | undefined) {
                if (!flow || visited.has(flow.id)) {
                    return;
                }
                charge();
                visited.add(flow.id);
                if (visited.size > maxReachingVisits) {
                    throw new OverloadResultAdmissionLimit('flow-limit');
                }
                if (flow.flags & FlowFlags.Assignment) {
                    // FlowNode is flag-discriminated throughout the analyzer.
                    const assignment = flow as FlowAssignment;
                    if (assignment.targetSymbolId === sym!.id) {
                        targets.add(assignment.node);
                        return;
                    }
                }
                if (flow.flags & FlowFlags.LoopLabel) {
                    complex = true;
                    return;
                }
                if (flow.flags & FlowFlags.Start) {
                    return;
                }
                if ('antecedents' in flow && Array.isArray(flow.antecedents)) {
                    // Use the existing FlowLabel shape rather than interpreting
                    // arbitrary fields on a ParseNode.
                    (flow as FlowLabel).antecedents.forEach(walk);
                } else if ('antecedent' in flow) {
                    walk((flow as FlowAssignment).antecedent);
                }
            }
            walk(info.getFlowNode(node));
            let defs = [...targets]
                .filter((n): n is NameNode => n.nodeType === ParseNodeType.Name)
                .map((n) => result.definitions.get(n))
                .filter((d): d is LocalOverloadOperation => !!d);
            const untracked = defs.length !== targets.size;
            const captured = declarations.filter((d) => d.fn !== getEnclosingFunction(node));
            defs = [...new Set([...defs, ...captured])];
            if (complex || untracked || (!targets.size && !captured.length)) {
                defs = declarations;
            }
            const ambiguous = complex || untracked || targets.size !== 1 || defs.length !== 1;
            reads.set(node, { defs, ambiguous, captured: captured.length > 0 });
            if (!ambiguous && !captured.length) {
                result.reaching.set(node, defs[0]);
            }
        }
        const valueOrigins = (record: LocalOverloadOperation) =>
            record.annotated ? new Set<LocalOverloadOperation>() : origins.get(record)!;
        let changed = true;
        while (changed) {
            changed = false;
            for (const record of result.records.values()) {
                if (record.annotated) {
                    continue;
                }
                for (const node of record.nodes) {
                    if (node.nodeType !== ParseNodeType.Name) {
                        continue;
                    }
                    for (const definition of reads.get(node)?.defs ?? []) {
                        charge();
                        for (const origin of valueOrigins(definition)) {
                            charge();
                            if (!origins.get(record)!.has(origin)) {
                                origins.get(record)!.add(origin);
                                changed = true;
                            }
                        }
                    }
                }
            }
        }
        const perStatement = new Map<LocalOverloadOperation, Set<LocalOverloadOperation>[]>();
        const nestedReaderInputs = new Map<LocalOverloadOperation, Set<LocalOverloadOperation>>();
        const callableValues = new Map<NameNode, { opaque: boolean; nestedReader: boolean }>();
        for (const [node, read] of reads) {
            const affected = new Set(read.defs.flatMap((d) => [...valueOrigins(d)]));
            if (!affected.size) {
                continue;
            }
            charge();
            if (read.captured) {
                reject(affected, 'closure-capture');
            }
            if (read.ambiguous) {
                reject(affected, 'ambiguous-reaching-definition');
            }
            const record = result.byNode.get(node);
            if (!record) {
                reject(affected, 'unsupported-statement-or-escape');
                continue;
            }
            const uses = perStatement.get(record) ?? [];
            uses.push(affected);
            perStatement.set(record, uses);
            if (
                record.statement.nodeType === ParseNodeType.Call &&
                (node.parent?.nodeType !== ParseNodeType.Argument || node.parent.parent !== record.statement)
            ) {
                const nested = nestedReaderInputs.get(record) ?? new Set<LocalOverloadOperation>();
                affected.forEach((origin) => nested.add(origin));
                nestedReaderInputs.set(record, nested);
            }
            if (record.root.parent !== record.fn.d.suite) {
                reject(affected, 'non-straight-line-statement');
            }
            let current: ParseNode | undefined = node;
            while (current && current !== record.statement) {
                charge();
                const child = current;
                current = current.parent;
                if (!current) {
                    reject(affected, 'unsupported-expression-path');
                    break;
                }
                if (
                    current.nodeType === ParseNodeType.Call &&
                    current.d.leftExpr.nodeType === ParseNodeType.MemberAccess &&
                    child.nodeType === ParseNodeType.Argument
                ) {
                    reject(affected, 'alternative-argument-to-member-call');
                }
                if (current.nodeType === ParseNodeType.Call && current.d.leftExpr.nodeType === ParseNodeType.Name) {
                    const callee = current.d.leftExpr;
                    if (!callableValues.has(callee)) {
                        const declarations = symbol(callee)?.getDeclarations() ?? [];
                        const opaque =
                            declarations.length > maxProjectionDeclarations ||
                            declarations.some((d) => {
                                const resolved = evaluator.resolveAliasDeclaration(d, true);
                                return (
                                    resolved?.type === DeclarationType.Variable ||
                                    resolved?.type === DeclarationType.Param
                                );
                            });
                        callableValues.set(callee, {
                            opaque,
                            nestedReader: !opaque && current !== record.statement && diagnosticReader(callee),
                        });
                    }
                    // Callable values can alias a diagnostic reader without a
                    // declaration exposing its argument roles.
                    if (callableValues.get(callee)!.opaque) {
                        reject(affected, 'unsupported-callable-value');
                    }
                    if (callableValues.get(callee)!.nestedReader) {
                        reject(affected, 'unsupported-nested-reader');
                    }
                }
                if (
                    ![
                        ParseNodeType.Argument,
                        ParseNodeType.Assignment,
                        ParseNodeType.Call,
                        ParseNodeType.MemberAccess,
                        ParseNodeType.StatementList,
                        ParseNodeType.Ternary,
                    ].includes(current.nodeType)
                ) {
                    reject(affected, 'container-or-unsupported-expression');
                }
            }
            if (
                record.target &&
                !record.annotated &&
                record.expression.nodeType !== ParseNodeType.Name &&
                record.expression.nodeType !== ParseNodeType.Call
            ) {
                reject(affected, 'unsupported-stored-value');
            }
        }

        function typingFunction(name: NameNode, expectedNames: readonly string[]) {
            const declarations = symbol(name)?.getDeclarations() ?? [];
            if (declarations.length !== 1) {
                return false;
            }
            charge();
            const resolved = evaluator.resolveAliasDeclaration(declarations[0], true);
            if (resolved?.type !== DeclarationType.Function || !expectedNames.includes(resolved.node.d.name.d.value)) {
                return false;
            }
            const file = info.getFileInfo(resolved.node);
            return file.isTypingStubFile || file.isTypingExtensionsStubFile;
        }
        function diagnosticReader(name: NameNode) {
            return (
                (isImplicitRevealTypeName(name) && !symbol(name)) ||
                typingFunction(name, ['assert_type', 'reveal_type'])
            );
        }
        function projectionShape(call: CallNode) {
            if (call.d.leftExpr.nodeType !== ParseNodeType.Name) {
                return false;
            }
            const declarations = symbol(call.d.leftExpr)?.getDeclarations() ?? [];
            if (!declarations.length || declarations.length > maxProjectionDeclarations) {
                return false;
            }
            let signatures = 0;
            for (const [index, declaration] of declarations.entries()) {
                charge();
                if (declaration.type !== DeclarationType.Function || !nodeSet.has(declaration.node)) {
                    return false;
                }
                for (const decorator of declaration.node.d.decorators) {
                    if (
                        decorator.d.expr.nodeType !== ParseNodeType.Name ||
                        !typingFunction(decorator.d.expr, ['overload'])
                    ) {
                        return false;
                    }
                }
                const annotation = declaration.node.d.returnAnnotation;
                const base = annotation?.nodeType === ParseNodeType.Index ? annotation.d.leftExpr : annotation;
                if (base?.nodeType !== ParseNodeType.Name) {
                    return false;
                }
                const returns = symbol(base)?.getDeclarations() ?? [];
                if (!returns.length || returns.length > maxProjectionDeclarations) {
                    return false;
                }
                let classReturn = false;
                for (const returned of returns) {
                    charge();
                    if (evaluator.resolveAliasDeclaration(returned, true)?.type === DeclarationType.Class) {
                        classReturn = true;
                    }
                }
                if (!classReturn && !(index === declarations.length - 1 && signatures > 1)) {
                    return false;
                }
                if (classReturn) {
                    signatures++;
                }
            }
            return signatures > 0;
        }
        const inputs = new Map<LocalOverloadOperation, Set<LocalOverloadOperation>>();
        for (const [record, uses] of perStatement) {
            const affected = new Set(uses.flatMap((use) => [...use]));
            if (uses.length > 1) {
                reject(affected, 'multiple-alternative-occurrences');
            }
            if (record.seed) {
                reject(new Set([...affected, record]), 'dependent-fixed-seeds');
            }
            if (
                record.target &&
                !record.annotated &&
                record.expression.nodeType === ParseNodeType.Call &&
                !projectionShape(record.expression)
            ) {
                reject(affected, 'unsupported-stored-call-declaration');
            }
            inputs.set(record, affected);
        }
        for (const record of result.decisions.keys()) {
            if (!record.target || record.expression !== record.seed?.node || record.root.parent !== record.fn.d.suite) {
                reject(new Set([record]), 'unsupported-seed-storage');
            }
        }
        for (const record of result.records.values()) {
            if (
                record.statement.nodeType === ParseNodeType.Call &&
                record.statement.d.leftExpr.nodeType === ParseNodeType.Name
            ) {
                record.reader = diagnosticReader(record.statement.d.leftExpr);
                const nested = nestedReaderInputs.get(record);
                // A reader can consume a direct local value, but must not inject
                // it into an unadapted nested member/call or type expression.
                if (record.reader && nested) {
                    reject(nested, 'unsupported-reader-expression');
                }
            }
        }
        for (const record of result.records.values()) {
            const dependencies = new Set([...(origins.get(record) ?? []), ...(inputs.get(record) ?? [])]);
            record.admitted =
                dependencies.size > 0 && [...dependencies].every((d) => result.decisions.get(d)?.size === 0);
        }
        result.complete = true;
    } catch (error) {
        if (!(error instanceof OverloadResultAdmissionLimit)) {
            throw error;
        }
        result.reason = error.message;
        result.records.forEach((r) => {
            r.admitted = false;
        });
        result.decisions.forEach((reasons) => reasons.add(error.message));
        result.reaching.clear();
    }
    return result;
}
