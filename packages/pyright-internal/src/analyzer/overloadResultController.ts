/*
 * overloadResultController.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Default-off local alternative-value experiment.
 */

import { assert } from '../common/debug';
import { Diagnostic, DiagnosticCategory } from '../common/diagnostic';
import { TextRangeDiagnosticSink } from '../common/diagnosticSink';
import {
    AssignmentNode,
    CallNode,
    ExpressionNode,
    FunctionNode,
    isExpressionNode,
    ModuleNode,
    NameNode,
    ParseNode,
    ParseNodeType,
} from '../parser/parseNodes';
import { AnalyzerFileInfo } from './analyzerFileInfo';
import { AnalyzerNodeInfoAccessor, AnalyzerNodeInfoReader, createAnalyzerNodeInfoAccessor } from './analyzerNodeInfo';
import {
    admitLocalOverloadResults,
    collectOverloadResultNodes,
    LocalOverloadAdmission,
    OverloadResultAdmissionLimit,
} from './overloadResultAdmission';
import { AutomaticOverloadSelection, findAutomaticOverloadSeeds } from './overloadResultSelector';
import { EvalFlags, TypeEvaluator, TypeResult } from './typeEvaluatorTypes';
import { isOverloadResult, OverloadResultType, Type, TypeCategory } from './types';
import { InferenceContext } from './typeUtils';

export interface OverloadResultLimits {
    nodes: number;
    records: number;
    rootNodes: number;
    graphUnits: number;
    candidates: number;
    calls: number;
    proofUnits: number;
}

export interface FixedOverloadResultSeed {
    node: CallNode;
    // The injection contract supplies complete ordinary return alternatives,
    // not Types containing a buried carrier.
    candidates: (evaluator: TypeEvaluator) => readonly Type[];
    uncertainty: TypeCategory.Any | TypeCategory.Unknown;
}

export interface ExperimentalOverloadResultOptions {
    seeds?: (module: ModuleNode) => readonly FixedOverloadResultSeed[];
    automatic?: boolean;
    limits?: Partial<OverloadResultLimits>;
    producerCalls?: number;
    consumerCalls?: number;
    observe?: (event: OverloadResultEvent) => void;
}

export type OverloadResultEvent =
    | { kind: 'selection'; node: CallNode; selection: AutomaticOverloadSelection }
    | { kind: 'scan'; module: ModuleNode; nodes: number; seeds: number; cutoff: boolean }
    | { kind: 'admission'; module: ModuleNode; admission: LocalOverloadAdmission }
    | { kind: 'enter'; module: ModuleNode; root: ParseNode; mode: OperationMode }
    | {
          kind: 'trial';
          root: ParseNode;
          mode: OperationMode;
          result?: TypeResult;
          diagnostics: readonly Diagnostic[];
          failed: boolean;
          retained: boolean;
          nestedSpeculative: boolean;
          exception: boolean;
      }
    | { kind: 'value'; root: ParseNode; canonical: TypeResult; baseline: TypeResult; cutoff: boolean }
    | { kind: 'project'; node: ExpressionNode; source: Type; result: TypeResult; mode: OperationMode }
    | { kind: 'publish'; root: ParseNode; diagnostics: readonly Diagnostic[] }
    | { kind: 'retire'; module: ModuleNode; outcomes: number }
    | { kind: 'context'; node: ExpressionNode; flags: EvalFlags; context?: InferenceContext; result: TypeResult }
    | { kind: 'beforeCall'; node: CallNode; mode: OperationMode; seen: ReadonlyMap<ParseNode, TypeResult> };

export interface LocalOverloadOperation {
    root: ParseNode;
    statement: AssignmentNode | ExpressionNode;
    expression: ExpressionNode;
    assignment?: AssignmentNode;
    target?: NameNode;
    annotated: boolean;
    fn: FunctionNode;
    nodes: readonly ParseNode[];
    ids: ReadonlySet<number>;
    valueNodes: ReadonlySet<ParseNode>;
    seed?: FixedOverloadResultSeed & { automatic?: boolean };
    admitted: boolean;
    reader: boolean;
    flags?: EvalFlags;
    context?: InferenceContext;
}

export type OverloadOperationRequest =
    | { kind: 'query'; node: ExpressionNode }
    | { kind: 'expression'; node: ExpressionNode; flags: EvalFlags; context?: InferenceContext }
    | { kind: 'statement'; node: AssignmentNode; evaluate: () => void };

type OperationMode =
    | 'baseline'
    | 'candidate'
    | 'reader'
    | 'check-baseline'
    | 'check-candidate'
    | 'materialize-baseline'
    | 'materialize-witness'
    | 'context';
interface Use {
    node: NameNode;
    value: TypeResult;
}
interface Inputs {
    uses: readonly Use[];
    alternative?: Use;
}
interface OrdinaryOutcome {
    result: TypeResult;
    diagnostics: Diagnostic[];
    failed: boolean;
}
interface Outcome {
    baseline: OrdinaryOutcome;
    canonical: TypeResult;
    value?: TypeResult;
    inputs: Inputs;
    successes: { candidate: Type; outcome: OrdinaryOutcome }[];
}
interface Reservation {
    used: number;
    attempts: number;
    limit: number;
}
export interface OverloadResultWork {
    candidateCalls: number;
    candidateTrials: number;
    ordinaryCalls: number;
    ordinaryRequests: number;
    projectionSetup: number;
    contextualRequests: number;
    retryReservations: number;
}
interface Generation {
    module: ModuleNode;
    file: AnalyzerFileInfo;
    admission: LocalOverloadAdmission;
    outcomes: Map<LocalOverloadOperation, Outcome>;
    variants: Map<ParseNode, Map<EvalFlags, LocalOverloadOperation>>;
    slots: Map<string, Reservation>;
    interrupted: Set<Reservation>;
    building: Set<LocalOverloadOperation>;
    preparing: boolean;
    published: Set<LocalOverloadOperation>;
    work: OverloadResultWork;
}
interface ActiveOperation {
    generation: Generation;
    record: LocalOverloadOperation;
    mode: OperationMode;
    inputs: ReadonlyMap<ParseNode, Use>;
    candidate?: Type;
    reservation?: Reservation;
    seen: Map<ParseNode, TypeResult>;
}
const defaultLimits: Readonly<OverloadResultLimits> = {
    nodes: 4096,
    records: 256,
    rootNodes: 256,
    graphUnits: 32768,
    candidates: 32,
    calls: 256,
    proofUnits: 512,
};
class CandidateCutoff extends Error {}

export class ExperimentalOverloadResultController {
    readonly roots = new Map<ParseNode, ReadonlySet<number>>();
    private readonly _limits: OverloadResultLimits;
    private readonly _info: AnalyzerNodeInfoAccessor;
    private readonly _generations = new Map<string, Generation>();
    private readonly _emptyModules = new WeakSet<ModuleNode>();
    private readonly _expiredModules = new WeakSet<ModuleNode>();
    private _active?: ActiveOperation;
    private _disposed = false;
    private _isolate?: (root: ParseNode, callback: () => TypeResult, retain?: boolean) => TypeResult;
    private _evict?: (root: ParseNode) => void;
    private _select?: (node: CallNode, limit: number, proofUnits: number) => AutomaticOverloadSelection;
    private _automaticWork = {
        modules: 0,
        nodes: 0,
        scanCutoffs: 0,
        seeds: 0,
        graphAdmitted: 0,
        selections: 0,
        selected: 0,
        proofUnits: 0,
        reasons: new Map<string, number>(),
    };

    constructor(
        private _options: ExperimentalOverloadResultOptions,
        private _evaluator: () => TypeEvaluator,
        reader: AnalyzerNodeInfoReader
    ) {
        this._limits = { ...defaultLimits, ..._options.limits };
        assert(!_options.automatic || !_options.seeds, 'Automatic discovery cannot use injected seeds');
        for (const key of Object.keys(defaultLimits) as (keyof OverloadResultLimits)[]) {
            const value = this._limits[key];
            assert(Number.isInteger(value) && value >= 0 && value <= defaultLimits[key], `Invalid ${key} limit`);
        }
        for (const value of [_options.producerCalls, _options.consumerCalls]) {
            assert(value === undefined || (Number.isInteger(value) && value >= 0 && value <= defaultLimits.calls));
        }
        this._info = createAnalyzerNodeInfoAccessor(reader);
    }

    install = (isolate: (root: ParseNode, callback: () => TypeResult, retain?: boolean) => TypeResult) => {
        this._isolate = isolate;
    };

    installEviction = (evict: (root: ParseNode) => void) => {
        this._evict = evict;
    };

    installSelector = (select: (node: CallNode, limit: number, proofUnits: number) => AutomaticOverloadSelection) => {
        this._select = select;
    };

    getAutomaticStats() {
        return { ...this._automaticWork, reasons: Object.fromEntries(this._automaticWork.reasons) };
    }

    dispose = () => {
        for (const generation of this._generations.values()) {
            this._retire(generation);
        }
        this._generations.clear();
        this._disposed = true;
    };

    // Kept structurally compatible with the original default-off cache seam.
    dispatch = (_node: ExpressionNode, _flags: EvalFlags, _context?: InferenceContext): TypeResult | undefined =>
        undefined;

    route = (request: OverloadOperationRequest): { result?: TypeResult } | undefined => {
        assert(!this._disposed, 'Retired overload-result controller');
        if (request.kind !== 'statement') {
            const result = this._query(
                request.node,
                request.kind === 'expression' ? request.flags : EvalFlags.None,
                request.kind === 'expression' ? request.context : undefined
            );
            return result ? { result } : undefined;
        }
        const generation = this._ensure(request.node);
        const record = generation?.admission.byNode.get(request.node);
        if (!generation || !record?.admitted || record.assignment !== request.node || this._active?.record === record) {
            return undefined;
        }
        assert(!generation.building.has(record));
        const outcome = this._build(generation, record);
        const selected = record.annotated ? outcome.successes[0] : undefined;
        this._trial(
            generation,
            record,
            selected ? 'materialize-witness' : 'materialize-baseline',
            outcome.inputs,
            selected?.candidate,
            request.evaluate,
            true
        );
        return {};
    };

    project = (node: ExpressionNode, result: TypeResult): TypeResult => {
        const active = this._active;
        if (!active) {
            return result;
        }
        if (active.record.seed?.node === node && active.candidate) {
            result = { ...result, type: active.candidate };
        }
        const use = active.inputs.get(node);
        // Contextual requests use ordinary assignment restoration, not value
        // substitution that could overwrite a flag-sensitive Name failure.
        if (use && !active.record.reader && active.mode !== 'context') {
            const value = use.value.type;
            result = {
                ...result,
                type: isOverloadResult(value) ? active.candidate ?? value.priv.baselineType : value,
            };
            this._emit({ kind: 'project', node, source: value, result, mode: active.mode });
        }
        if (active.record.ids.has(node.id)) {
            active.seen.set(node, result);
        }
        return result;
    };

    beforeCall = (node: CallNode) => {
        const active = this._active;
        if (!active) {
            return;
        }
        this._emit({ kind: 'beforeCall', node, mode: active.mode, seen: active.seen });
        if (active.mode === 'candidate') {
            const reservation = active.reservation!;
            if (reservation.used >= reservation.limit) {
                throw new CandidateCutoff();
            }
            reservation.used++;
            active.generation.work.candidateCalls++;
        } else {
            active.generation.work.ordinaryCalls++;
        }
    };

    check = (module: ModuleNode) => {
        const generation = this._ensure(module);
        if (!generation) {
            return undefined;
        }
        generation.published.clear();
        return {
            walk: (node: ParseNode, callback: () => void) => {
                const record = generation.admission.records.get(node);
                if (this._active || !record?.admitted) {
                    callback();
                    return;
                }
                const output = this._build(generation, record);
                const selected = output.successes[0];
                const mode = record.reader ? 'reader' : selected ? 'check-candidate' : 'check-baseline';
                const committed = this._trial(generation, record, mode, output.inputs, selected?.candidate, callback);
                assert(!generation.published.has(record));
                generation.published.add(record);
                committed.diagnostics.forEach((d) => generation.file.diagnosticSink.addDiagnostic(d));
                this._emit({ kind: 'publish', root: record.root, diagnostics: committed.diagnostics });
            },
            dispose: () => {},
        };
    };

    evict(module: ModuleNode) {
        assert(!this._active);
        const generation = this._ensure(module);
        generation?.admission.records.forEach((record) => {
            if (record.admitted) {
                this._evict?.(record.root);
            }
        });
    }

    getStats(module: ModuleNode) {
        if (this._disposed) {
            return undefined;
        }
        const generation = this._generations.get(this._info.getFileInfo(module).fileUri.key);
        if (!generation || generation.module !== module) {
            return undefined;
        }
        return {
            ...generation.work,
            records: generation.admission.records.size,
            outcomes: generation.outcomes.size,
            variants: [...generation.variants.values()].reduce((n, v) => n + v.size, 0),
            slots: generation.slots.size,
            candidateCallCeiling: [...generation.slots.values()].reduce((n, s) => n + s.limit, 0),
            interruptedSlots: generation.interrupted.size,
        };
    }

    private _emit(event: OverloadResultEvent) {
        this._options.observe?.(event);
    }

    private _retire(generation: Generation) {
        this._emit({ kind: 'retire', module: generation.module, outcomes: generation.outcomes.size });
        this._expiredModules.add(generation.module);
        generation.admission.records.forEach((record) => this.roots.delete(record.root));
        generation.variants.forEach((_, node) => this.roots.delete(node));
        generation.outcomes.clear();
        generation.variants.clear();
        generation.slots.clear();
        generation.interrupted.clear();
    }

    private _ensure(node: ParseNode): Generation | undefined {
        let root = node;
        while (root.parent) {
            root = root.parent;
        }
        if (root.nodeType !== ParseNodeType.Module || this._emptyModules.has(root)) {
            return undefined;
        }
        assert(!this._expiredModules.has(root), 'Expired overload-result parse generation');
        const file = this._info.getFileInfo(root);
        const old = this._generations.get(file.fileUri.key);
        if (old?.module === root) {
            return old;
        }
        if (old) {
            this._retire(old);
            this._generations.delete(file.fileUri.key);
        }
        let seeds = this._options.seeds?.(root) ?? [];
        if (this._options.automatic) {
            let nodes: ParseNode[] = [];
            let cutoff = false;
            try {
                nodes = collectOverloadResultNodes(root, this._limits.nodes);
                seeds = findAutomaticOverloadSeeds(nodes, this._evaluator()).map((node) => ({
                    node,
                    uncertainty: TypeCategory.Any,
                    automatic: true,
                    candidates: () => {
                        const selection = this._select!(node, this._limits.candidates, this._limits.proofUnits);
                        this._automaticWork.selections++;
                        this._automaticWork.selected += selection.reason === 'selected' ? 1 : 0;
                        this._automaticWork.proofUnits += selection.units;
                        const reasons = this._automaticWork.reasons;
                        reasons.set(selection.reason, (reasons.get(selection.reason) ?? 0) + 1);
                        this._emit({ kind: 'selection', node, selection });
                        return selection.candidates;
                    },
                }));
            } catch (error) {
                if (!(error instanceof OverloadResultAdmissionLimit)) {
                    throw error;
                }
                cutoff = true;
            }
            this._automaticWork.modules++;
            this._automaticWork.nodes += cutoff ? this._limits.nodes + 1 : nodes.length;
            this._automaticWork.seeds += seeds.length;
            this._automaticWork.scanCutoffs += cutoff ? 1 : 0;
            this._emit({ kind: 'scan', module: root, nodes: nodes.length, seeds: seeds.length, cutoff });
        }
        if (!seeds.length) {
            this._emptyModules.add(root);
            return undefined;
        }
        const admission = admitLocalOverloadResults(root, seeds, this._evaluator(), this._info, this._limits);
        if (this._options.automatic) {
            this._automaticWork.graphAdmitted += [...admission.records.values()].filter(
                (r) => r.seed && r.admitted
            ).length;
            for (const decision of admission.decisions.values()) {
                for (const reason of decision) {
                    const key = `admission:${reason}`;
                    this._automaticWork.reasons.set(key, (this._automaticWork.reasons.get(key) ?? 0) + 1);
                }
            }
            if (!admission.complete) {
                const key = `admission:${admission.reason}`;
                this._automaticWork.reasons.set(key, (this._automaticWork.reasons.get(key) ?? 0) + 1);
            }
        }
        const generation: Generation = {
            module: root,
            file,
            admission,
            outcomes: new Map(),
            variants: new Map(),
            slots: new Map(),
            interrupted: new Set(),
            building: new Set(),
            preparing: false,
            published: new Set(),
            work: {
                candidateCalls: 0,
                candidateTrials: 0,
                ordinaryCalls: 0,
                ordinaryRequests: 0,
                projectionSetup: 0,
                contextualRequests: 0,
                retryReservations: 0,
            },
        };
        this._emit({ kind: 'admission', module: root, admission });
        const reserve = (node: ParseNode, flags: EvalFlags, seed: boolean) => {
            const key = this._key(node, flags);
            if (!generation.slots.has(key)) {
                generation.slots.set(key, {
                    used: 0,
                    attempts: 0,
                    limit: (seed ? this._options.producerCalls : this._options.consumerCalls) ?? this._limits.calls,
                });
            }
        };
        for (const record of admission.records.values()) {
            if (!record.admitted) {
                continue;
            }
            this.roots.set(record.root, record.ids);
            reserve(record.root, EvalFlags.None, !!record.seed);
            for (const value of record.valueNodes) {
                if (isExpressionNode(value)) {
                    const seed = record.seed?.node;
                    const containsSeed =
                        !!seed && seed.start >= value.start && seed.start + seed.length <= value.start + value.length;
                    reserve(value, EvalFlags.None, containsSeed);
                    reserve(value, EvalFlags.NoSpecialize, containsSeed);
                }
            }
        }
        this._generations.set(file.fileUri.key, generation);
        return generation;
    }

    private _key(node: ParseNode, flags = EvalFlags.None) {
        return `${node.id}:${flags}`;
    }

    private _definition(generation: Generation, node: NameNode) {
        return generation.admission.definitions.get(node) ?? generation.admission.reaching.get(node);
    }

    private _inputs(generation: Generation, record: LocalOverloadOperation): Inputs {
        const uses: Use[] = [];
        for (const node of record.nodes) {
            if (node.nodeType !== ParseNodeType.Name || node === record.target) {
                continue;
            }
            const producer = this._definition(generation, node);
            if (!producer?.admitted || producer === record) {
                continue;
            }
            const value = this._build(generation, producer).value;
            if (value) {
                uses.push({ node, value });
            }
        }
        const alternatives = uses.filter((use) => isOverloadResult(use.value.type));
        assert(alternatives.length <= 1, 'Prepublication admission invariant');
        return { uses, alternative: alternatives[0] };
    }

    private _trial(
        generation: Generation,
        record: LocalOverloadOperation,
        mode: OperationMode,
        inputs: Inputs,
        candidate?: Type,
        callback?: () => void,
        retain = false,
        reservation?: Reservation
    ): OrdinaryOutcome {
        const evaluator = this._evaluator();
        const parent = this._active;
        const previousSink = generation.file.diagnosticSink;
        const sink = new TextRangeDiagnosticSink(generation.file.lines);
        const nestedSpeculative = !!parent && evaluator.isSpeculativeModeInUse(undefined);
        assert(!nestedSpeculative || retain);
        const projections = new Map(inputs.uses.map((use) => [use.node, use]));
        generation.work.projectionSetup += projections.size;
        assert(projections.size <= this._limits.rootNodes);
        const active: ActiveOperation = {
            generation,
            record,
            mode,
            inputs: projections,
            candidate,
            reservation,
            seen: new Map(),
        };
        if (mode === 'candidate') {
            generation.work.candidateTrials++;
        } else {
            generation.work.ordinaryRequests++;
        }
        this._active = active;
        generation.file.diagnosticSink = sink;
        let result: TypeResult | undefined;
        let diagnostics: Diagnostic[] = [];
        let completed = false;
        try {
            this._emit({ kind: 'enter', module: generation.module, root: record.root, mode });
            const evaluate = () => {
                if (callback) {
                    callback();
                } else if (record.assignment) {
                    evaluator.evaluateTypesForStatement(record.assignment);
                } else {
                    return evaluator.getTypeOfExpression(
                        record.expression,
                        record.flags ?? EvalFlags.None,
                        record.context
                    );
                }
                return evaluator.getTypeOfExpression(record.expression, record.flags ?? EvalFlags.None, record.context);
            };
            result = nestedSpeculative ? evaluate() : this._isolate!(record.root, evaluate, retain);
            completed = true;
        } finally {
            diagnostics = sink.fetchAndClear();
            generation.file.diagnosticSink = previousSink;
            this._active = parent;
            this._emit({
                kind: 'trial',
                root: record.root,
                mode,
                result,
                diagnostics,
                failed: !!result?.typeErrors || diagnostics.some((d) => d.category === DiagnosticCategory.Error),
                retained: retain,
                nestedSpeculative,
                exception: !completed,
            });
        }
        return {
            result,
            diagnostics,
            failed: !!result.typeErrors || diagnostics.some((d) => d.category === DiagnosticCategory.Error),
        };
    }

    private _build(generation: Generation, record: LocalOverloadOperation): Outcome {
        const cached = generation.outcomes.get(record);
        if (cached) {
            return cached;
        }
        if (!this._active && !generation.building.size && !generation.preparing) {
            // A cold read can ask code flow about earlier calls that do not
            // return. Their speculative checks may restore earlier assignments.
            // Complete those static local records before entering a trial, so
            // reentry restores owned outcomes rather than discovering new ones
            // inside somebody else's speculative context.
            generation.preparing = true;
            try {
                for (const prior of generation.admission.records.values()) {
                    if (prior.admitted && prior.fn === record.fn && prior.root.start < record.root.start) {
                        this._build(generation, prior);
                    }
                }
            } finally {
                generation.preparing = false;
            }
        }
        if (!this._active && !generation.building.size) {
            for (const slot of generation.interrupted) {
                slot.used = 0;
                slot.attempts = 0;
                generation.work.retryReservations++;
            }
            generation.interrupted.clear();
        }
        const reservation = generation.slots.get(this._key(record.root, record.flags));
        assert(reservation && !generation.interrupted.has(reservation));
        assert(!generation.building.has(record));
        generation.building.add(record);
        try {
            const inputs = this._inputs(generation, record);
            const baseline = this._trial(generation, record, 'baseline', inputs);
            const alias =
                !!record.target &&
                !record.annotated &&
                record.expression === inputs.alternative?.node &&
                !baseline.failed;
            const successes: Outcome['successes'] = [];
            let cutoff = false;
            if (
                !alias &&
                !record.reader &&
                (!record.target || !baseline.failed || record.annotated) &&
                !baseline.result.isIncomplete
            ) {
                const alternative = inputs.alternative?.value.type;
                try {
                    let candidates: readonly Type[] = [];
                    if (record.seed && !baseline.failed) {
                        if (record.seed.automatic) {
                            // Discovery runs inside the same private ordinary cache
                            // and diagnostic transaction as the complete operation.
                            const discovery = this._trial(
                                generation,
                                record,
                                'candidate',
                                inputs,
                                undefined,
                                () => {
                                    candidates = record.seed!.candidates(this._evaluator());
                                },
                                false,
                                reservation
                            );
                            if (discovery.failed || discovery.result.isIncomplete) {
                                candidates = [];
                            }
                        } else {
                            candidates = record.seed.candidates(this._evaluator());
                        }
                    } else if (alternative && isOverloadResult(alternative)) {
                        candidates = alternative.priv.candidates;
                    }
                    if (candidates.length > this._limits.candidates) {
                        throw new CandidateCutoff();
                    }
                    for (const candidate of candidates) {
                        assert(!isOverloadResult(candidate), 'Fixed seeds must be ordinary root alternatives');
                        if (reservation.used >= reservation.limit) {
                            throw new CandidateCutoff();
                        }
                        assert(reservation.attempts < this._limits.candidates);
                        reservation.attempts++;
                        const outcome = this._trial(
                            generation,
                            record,
                            'candidate',
                            inputs,
                            candidate,
                            undefined,
                            false,
                            reservation
                        );
                        if (outcome.result.isIncomplete) {
                            throw new CandidateCutoff();
                        }
                        if (!outcome.failed) {
                            successes.push({ candidate, outcome });
                        }
                    }
                } catch (error) {
                    if (!(error instanceof CandidateCutoff)) {
                        throw error;
                    }
                    successes.length = 0;
                    cutoff = true;
                }
            }
            let canonical = baseline.result;
            if (record.reader) {
                canonical = this._trial(generation, record, 'reader', inputs).result;
            } else if (alias) {
                canonical = inputs.alternative!.value;
            } else if (successes.length) {
                const source = inputs.alternative?.value.type;
                const uncertainty =
                    record.seed?.uncertainty ??
                    (source && isOverloadResult(source) ? source.priv.uncertaintyKind : TypeCategory.Any);
                canonical = {
                    ...baseline.result,
                    type: OverloadResultType.create(
                        successes.map((s) => s.outcome.result.type),
                        baseline.result.type,
                        uncertainty
                    ),
                };
            }
            let value: TypeResult | undefined;
            if (record.target) {
                value =
                    record.annotated && successes.length
                        ? successes[0].outcome.result
                        : !baseline.failed
                        ? canonical
                        : undefined;
            }
            const outcome = { baseline, canonical, value, inputs, successes };
            generation.outcomes.set(record, outcome);
            this._emit({ kind: 'value', root: record.root, canonical, baseline: baseline.result, cutoff });
            return outcome;
        } catch (error) {
            generation.interrupted.add(reservation);
            throw error;
        } finally {
            generation.building.delete(record);
        }
    }

    private _variant(generation: Generation, record: LocalOverloadOperation, node: ExpressionNode, flags: EvalFlags) {
        let variants = generation.variants.get(node);
        if (!variants) {
            variants = new Map();
            generation.variants.set(node, variants);
        }
        let variant = variants.get(flags);
        if (!variant) {
            variant = this._expressionRecord(record, node, flags);
            variants.set(flags, variant);
            this.roots.set(node, variant.ids);
        }
        return variant;
    }

    private _expressionRecord(
        record: LocalOverloadOperation,
        node: ExpressionNode,
        flags: EvalFlags,
        context?: InferenceContext
    ) {
        const nodes = collectOverloadResultNodes(node, this._limits.rootNodes);
        const ordinaryContext =
            context &&
            (isOverloadResult(context.expectedType) ||
                (context.returnTypeOverride && isOverloadResult(context.returnTypeOverride)))
                ? {
                      ...context,
                      expectedType: isOverloadResult(context.expectedType)
                          ? context.expectedType.priv.baselineType
                          : context.expectedType,
                      returnTypeOverride:
                          context.returnTypeOverride && isOverloadResult(context.returnTypeOverride)
                              ? context.returnTypeOverride.priv.baselineType
                              : context.returnTypeOverride,
                  }
                : context;
        return {
            ...record,
            root: node,
            statement: node,
            expression: node,
            nodes,
            ids: new Set(nodes.map((n) => n.id)),
            assignment: undefined,
            target: undefined,
            annotated: false,
            reader: record.reader && node === record.expression,
            seed: record.seed && nodes.includes(record.seed.node) ? record.seed : undefined,
            flags,
            context: ordinaryContext,
        };
    }

    private _queryOutcome(generation: Generation, record: LocalOverloadOperation): TypeResult {
        const outcome = this._build(generation, record);
        if (!isOverloadResult(outcome.canonical.type) && !outcome.inputs.alternative) {
            // A declined operation still owns its diagnostics. Restore ordinary
            // subnode caches privately rather than bypassing evaluation or
            // replaying its diagnostics into a public query's live sink.
            return this._trial(generation, record, 'materialize-baseline', outcome.inputs, undefined, undefined, true)
                .result;
        }
        return outcome.canonical;
    }

    private _query(node: ExpressionNode, flags: EvalFlags, context?: InferenceContext): TypeResult | undefined {
        const isCanonicalContext =
            (flags === EvalFlags.None || flags === EvalFlags.NoSpecialize) &&
            (!context || node.nodeType === ParseNodeType.Name);
        if (this._active) {
            // Diagnostic readers also evaluate type arguments. Leave their
            // flag-sensitive validation to the ordinary evaluator in this owner.
            return this._active.mode === 'reader' && isCanonicalContext
                ? this._active.inputs.get(node)?.value
                : undefined;
        }
        const generation = this._ensure(node);
        const record = generation?.admission.byNode.get(node);
        if (!generation || !record?.admitted || !record.valueNodes.has(node)) {
            return undefined;
        }
        if (!isCanonicalContext) {
            // Context-dependent requests are complete ordinary operations, not
            // canonical memo entries. Their actual flags and context never key a
            // persistent table or change the context-free published value.
            const contextual = this._expressionRecord(record, node, flags, context);
            const prior = this.roots.get(node);
            this.roots.set(node, contextual.ids);
            try {
                generation.work.contextualRequests++;
                const result = this._trial(
                    generation,
                    contextual,
                    'context',
                    this._inputs(generation, contextual)
                ).result;
                this._emit({ kind: 'context', node, flags, context, result });
                return result;
            } finally {
                if (prior) {
                    this.roots.set(node, prior);
                } else {
                    this.roots.delete(node);
                }
            }
        }
        // Name evaluation does not use an expected type. Its value is the
        // canonical reaching definition under both supported value flags.
        if (node.nodeType === ParseNodeType.Name) {
            if (node.parent?.nodeType === ParseNodeType.MemberAccess && node.parent.d.member === node) {
                // A member token represents its enclosing access, not a local.
                return this._query(node.parent, flags, context);
            }
            const definition = this._definition(generation, node);
            const value = definition?.admitted ? this._build(generation, definition).value : undefined;
            if (value && !isOverloadResult(value.type)) {
                this._queryOutcome(generation, record);
            }
            return value && isOverloadResult(value.type) ? value : undefined;
        }
        if (flags === EvalFlags.None && (node === record.expression || node === record.statement)) {
            return this._queryOutcome(generation, record);
        }
        if (
            flags === EvalFlags.NoSpecialize ||
            node.nodeType === ParseNodeType.Call ||
            node.nodeType === ParseNodeType.MemberAccess ||
            node.nodeType === ParseNodeType.Ternary
        ) {
            return this._queryOutcome(generation, this._variant(generation, record, node, flags));
        }
        return undefined;
    }
}
