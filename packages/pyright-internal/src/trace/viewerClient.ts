/// <reference lib="dom" />
/*
 * viewerClient.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 */

import type { ViewerModel } from './viewerModel';

// This self-contained function is served as compiled JavaScript. It has no runtime
// imports or artifact interpolation; all captured strings go through textContent.
export function viewerMain() {
    type Responses = {
        summary: ReturnType<ViewerModel['summary']>;
        timeline: ReturnType<ViewerModel['timeline']>;
        event: ReturnType<ViewerModel['event']>;
        entity: ReturnType<ViewerModel['entity']>;
        graph: ReturnType<ViewerModel['graph']>;
        pairs: ReturnType<ViewerModel['pairs']>;
        comparison: ReturnType<ViewerModel['comparison']>;
    };
    let cursor = 0;
    let end = 0;
    let selectedId = '';
    let timelineOffset = 0;
    let selectedPair = -1;
    let cursorRevision = 0;
    let entityRevision = 0;
    let timelineRevision = 0;
    let comparisonRevision = 0;
    const byId = (id: string) => {
        const element = document.getElementById(id);
        if (!element) {
            throw new Error(`Missing viewer control: ${id}`);
        }
        return element;
    };
    const input = (id: string) => {
        const element = byId(id);
        if (!(element instanceof HTMLInputElement || element instanceof HTMLSelectElement)) {
            throw new Error(`Invalid input control: ${id}`);
        }
        return element;
    };
    const text = (value: unknown) => (typeof value === 'string' ? value : JSON.stringify(value, null, 2));
    const short = (id: string) => id.slice(id.lastIndexOf(':') + 1);
    const sourceLabel = (value: unknown) => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            return 'source not recorded';
        }
        const source = value as { path?: unknown; start?: unknown; length?: unknown };
        const name = typeof source.path === 'string' ? source.path.split(/[\\/]/).pop() : 'source';
        return typeof source.start === 'number' && typeof source.length === 'number'
            ? `${name} | UTF-16 offsets [${source.start}, ${source.start + source.length})`
            : `${name} | offsets unobserved`;
    };
    const el = <K extends keyof HTMLElementTagNameMap>(tag: K, content?: unknown, className?: string) => {
        const element = document.createElement(tag);
        if (content !== undefined) {
            element.textContent = text(content);
        }
        if (className) {
            element.className = className;
        }
        return element;
    };
    const showError = (error: unknown) => {
        const target = byId('error');
        target.hidden = false;
        target.textContent = error instanceof Error ? error.message : String(error);
    };
    const run = (action: () => Promise<void>) => {
        byId('error').hidden = true;
        action().catch(showError);
    };
    const button = (label: string, action: () => Promise<void>, className?: string) => {
        const element = el('button', label, className);
        element.type = 'button';
        element.addEventListener('click', () => run(action));
        return element;
    };
    async function api<K extends keyof Responses>(
        route: K,
        params: Record<string, string | number> = {}
    ): Promise<Responses[K]> {
        const url = new URL(`api/${route}`, window.location.href);
        for (const [key, value] of Object.entries(params)) {
            if (value !== '') {
                url.searchParams.set(key, String(value));
            }
        }
        const response = await fetch(url, { headers: { 'X-Pyright-Trace-Viewer': '1' }, credentials: 'omit' });
        if (!response.ok) {
            throw new Error(`Viewer ${response.status}: ${(await response.json()).error}`);
        }
        return response.json() as Promise<Responses[K]>;
    }
    const link = (id: string, at = cursor, label?: string) => {
        const result = button(label ?? short(id), () => selectEvent(at, id), 'ref-link');
        result.title = id;
        result.dataset.entity = id;
        result.dataset.seq = String(at);
        return result;
    };
    function pages(
        target: HTMLElement,
        value: { total: number; offset: number; limit: number },
        load: (offset: number) => Promise<void>
    ) {
        target.replaceChildren();
        const previous = button('Previous', () => load(Math.max(0, value.offset - value.limit)));
        previous.disabled = value.offset === 0;
        const next = button('Next', () => load(value.offset + value.limit));
        next.disabled = value.offset + value.limit >= value.total;
        target.append(
            previous,
            el(
                'span',
                `${value.total ? value.offset + 1 : 0}-${Math.min(value.offset + value.limit, value.total)} of ${
                    value.total
                }`
            ),
            next
        );
    }
    function fieldsTable(fields: { key: string; value: unknown; ref?: string | null }[], at: number) {
        const table = el('table', undefined, 'fields');
        for (const field of fields) {
            const row = el('tr');
            const cell = el('td');
            if (field.ref) {
                cell.append(link(field.ref, at, field.ref));
            } else {
                cell.append(el('pre', field.value));
            }
            row.append(el('th', field.key), cell);
            table.append(row);
        }
        return table;
    }
    async function loadTimeline(offset = 0) {
        const revision = ++timelineRevision;
        const value = await api('timeline', {
            offset,
            kind: input('kind').value,
            query: input('query').value,
            role: input('role').value,
            span: input('scope').value,
        });
        if (revision !== timelineRevision) {
            return;
        }
        timelineOffset = offset;
        const target = byId('timeline');
        target.replaceChildren();
        for (const row of value.items) {
            const item = button(
                `${'  '.repeat(Math.min(row.depth, 8))}${row.depth ? `depth ${row.depth} / ` : ''}#${row.seq} ${
                    row.kind
                } - ${text(row.label)}`,
                () => selectEvent(row.seq),
                `row${row.seq === cursor ? ' selected' : ''}`
            );
            item.dataset.seq = String(row.seq);
            item.append(el('small', `${text(row.role)} | ${short(row.span)} | ${sourceLabel(row.source)}`));
            item.title = text(row.source);
            target.append(item);
        }
        if (!value.total) {
            target.append(el('p', 'No recorded events match these filters.'));
        }
        pages(byId('timeline-pages'), value, loadTimeline);
    }
    async function selectEvent(seq: number, identity?: string) {
        const revision = ++cursorRevision;
        ++entityRevision;
        cursor = seq;
        input('cursor').value = String(cursor);
        byId('cursor-label').textContent = `of ${end}; graph and fields at sequence ${cursor}`;
        for (const row of byId('timeline').querySelectorAll<HTMLButtonElement>('[data-seq]')) {
            row.classList.toggle('selected', row.dataset.seq === String(cursor));
        }
        byId('graph').replaceChildren(el('p', 'Loading at selected sequence...'));
        byId('entity-details').replaceChildren();
        byId('history').replaceChildren();
        byId('edge-list').replaceChildren();
        byId('graph-note').textContent = '';
        byId('field-pages').replaceChildren();
        byId('history-pages').replaceChildren();
        const event = seq === 0 ? undefined : await api('event', { seq });
        if (revision !== cursorRevision) {
            return;
        }
        const target = byId('event-details');
        target.replaceChildren();
        if (event) {
            target.append(el('p', `#${event.seq} ${event.kind} ${text(event.label)}`), el('pre', event.source));
            if (event.site) {
                const detail = el('details');
                detail.append(el('summary', 'Recorded native hook / offsets'), el('pre', event.site));
                target.append(detail);
            }
            target.append(el('p', 'Recorded event navigation links, not memory or dependency edges.', 'muted'));
            for (const ref of event.referenceLinks) {
                const control = link(ref.id, seq, `${ref.path}: ${short(ref.id)}`);
                control.dataset.referencePath = ref.path;
                target.append(control);
            }
            if (event.referenceClipping.length) {
                target.append(
                    el(
                        'p',
                        `Event references clipped: ${event.referenceClipping.join(
                            ', '
                        )}. Other references may be unexpanded. See viewer limits.`,
                        'warning'
                    )
                );
            }
            if (event.span) {
                target.append(link(event.span, seq, `Occurrence ${short(event.span)}`));
                target.append(
                    button('Filter timeline to this occurrence (inclusive)', async () => {
                        input('scope').value = event.span;
                        input('query').value = '';
                        input('kind').value = '';
                        await loadTimeline();
                    })
                );
            }
            const details = el('details');
            details.append(el('summary', 'Event payload (bounded display)'), el('pre', event.data));
            target.append(details);
        } else {
            target.append(el('p', 'Before first recorded event; no observed state.'));
        }
        selectedId = identity ?? event?.references[0] ?? event?.span ?? selectedId;
        if (selectedId) {
            await showEntity(selectedId);
        } else {
            byId('graph').replaceChildren(
                el('p', 'This event has no recorded entity reference. Select an occurrence or enter an identity.')
            );
        }
    }
    async function showEntity(id: string, historyOffset = 0, fieldOffset = 0) {
        const revision = ++entityRevision;
        const at = cursor;
        selectedId = id;
        input('entity-id').value = id;
        const [entity, graph] = await Promise.all([
            api('entity', { id, at, historyOffset, fieldOffset }),
            api('graph', { id, at, relation: input('relation').value, hops: input('hops').value }),
        ]);
        if (revision !== entityRevision || at !== cursor) {
            return;
        }
        const target = byId('entity-details');
        target.replaceChildren(
            el('p', `${entity.id} | ${entity.category}`),
            el(
                'p',
                entity.state
                    ? `Observed v${entity.state.version} at #${entity.state.observedSeq} (version introduced #${entity.state.seq}); snapshot complete: ${entity.state.complete}. Writer: ${entity.state.writer}`
                    : 'State unknown at this sequence.'
            ),
            el('p', entity.meaning, 'muted'),
            fieldsTable(entity.fields.items, at)
        );
        if (entity.state?.complete === false) {
            target.append(
                el('p', 'Partial/opaque snapshot: omitted fields or children do not imply absence.', 'warning')
            );
        }
        pages(byId('field-pages'), entity.fields, (offset) => showEntity(id, historyOffset, offset));
        const history = byId('history');
        history.replaceChildren();
        for (const observation of entity.history.items) {
            const item = button(
                `#${observation.seq} observed v${observation.version} | ${text(observation.cause)}${
                    observation.afterCursor ? ' [after cursor; click to move forward]' : ''
                }`,
                () => selectEvent(observation.seq, id),
                `row${observation.afterCursor ? ' history-future' : ''}`
            );
            item.dataset.seq = String(observation.seq);
            history.append(item);
        }
        if (!entity.history.total) {
            history.append(el('p', 'No object-state observations recorded for this identity.'));
        }
        pages(byId('history-pages'), entity.history, (offset) => showEntity(id, offset, fieldOffset));
        drawGraph(graph);
    }
    function drawGraph(graph: Responses['graph']) {
        byId('graph-note').textContent = `${graph.meaning} ${graph.nodes.length} nodes / ${graph.edges.length} edges; ${
            graph.hops
        }-hop local expansion${
            graph.capped ? ' CAPPED (more recorded edges/nodes omitted)' : ''
        }. Unobserved/opaque fields and events beyond capture coverage remain unknown.`;
        const svgEl = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>) => {
            const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
            for (const [name, value] of Object.entries(attrs)) {
                node.setAttribute(name, String(value));
            }
            return node;
        };
        const width = 820;
        const height = Math.max(300, Math.ceil((graph.nodes.length - 1) / 2) * 68 + 40);
        const svg = svgEl('svg', {
            viewBox: `0 0 ${width} ${height}`,
            role: 'group',
            'aria-label': 'Recorded object/state relationship graph',
        });
        const positions = new Map<string, { x: number; y: number }>();
        graph.nodes.forEach((node, index) => {
            positions.set(
                node.id,
                index === 0
                    ? { x: width / 2, y: height / 2 }
                    : { x: index % 2 ? 115 : width - 115, y: Math.floor((index - 1) / 2) * 68 + 46 }
            );
        });
        const defs = svgEl('defs', {});
        const marker = svgEl('marker', {
            id: 'arrow',
            viewBox: '0 0 10 10',
            refX: 9,
            refY: 5,
            markerWidth: 6,
            markerHeight: 6,
            orient: 'auto-start-reverse',
        });
        marker.append(svgEl('path', { d: 'M 0 0 L 10 5 L 0 10 z', fill: '#acbccb' }));
        defs.append(marker);
        svg.append(defs);
        const edgeList = byId('edge-list');
        edgeList.replaceChildren();
        graph.edges.forEach((edge, index) => {
            const from = positions.get(edge.from)!;
            const to = positions.get(edge.to)!;
            const self = edge.from === edge.to;
            const delta = from.x < to.x ? 95 : -95;
            const offset = ((index % 5) - 2) * 9;
            const path = svgEl('path', {
                d: self
                    ? `M ${from.x + 20} ${from.y - 22} c 100 -80 120 50 74 30`
                    : `M ${from.x + delta} ${from.y} Q ${(from.x + to.x) / 2} ${(from.y + to.y) / 2 + offset} ${
                          to.x - delta
                      } ${to.y}`,
                class: `edge ${edge.relation}`,
                fill: 'none',
                'marker-end': 'url(#arrow)',
            });
            const title = svgEl('title', {});
            title.textContent = `${edge.relation}: ${edge.from} -> ${edge.to} ${text(edge.field)} at #${edge.seq}`;
            path.append(title);
            svg.append(path);
            const row = el('div');
            row.append(
                link(edge.from, graph.at),
                el('span', ` -- ${edge.relation} ${text(edge.field)} --> `),
                link(edge.to, graph.at),
                button(`#${edge.seq}`, () => selectEvent(edge.seq, edge.to))
            );
            edgeList.append(row);
        });
        graph.nodes.forEach((node) => {
            const position = positions.get(node.id)!;
            const group = svgEl('g', {
                class: `node${node.id === graph.root ? ' root' : ''}${node.version === null ? ' unknown' : ''}`,
                transform: `translate(${position.x - 95} ${position.y - 23})`,
                tabindex: 0,
                role: 'button',
                'aria-label': `${node.id}, ${node.category}, observed version ${node.version ?? 'unknown'}`,
                'data-entity': node.id,
            });
            group.append(svgEl('rect', { width: 190, height: 46, rx: 6 }));
            const title = svgEl('title', {});
            title.textContent = `${node.id}\n${node.label}\nSnapshot complete: ${node.complete ?? 'unknown'}`;
            const first = svgEl('text', { x: 8, y: 18 });
            first.textContent = `${short(node.id)} | ${node.category.slice(0, 18)}`;
            const second = svgEl('text', { x: 8, y: 34 });
            second.textContent =
                node.version === null
                    ? 'state unobserved'
                    : `observed v${node.version} at #${node.observedSeq}${node.complete === false ? ' (partial)' : ''}`;
            group.append(title, first, second);
            group.addEventListener('click', () => run(() => showEntity(node.id)));
            group.addEventListener('keydown', (event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    run(() => showEntity(node.id));
                }
            });
            svg.append(group);
        });
        byId('graph').replaceChildren(svg);
    }
    async function loadPairs(offset = 0) {
        const pairs = await api('pairs', { offset });
        const target = byId('pairs');
        target.replaceChildren();
        if (!pairs.total) {
            target.append(
                el(
                    'p',
                    'No baseline/candidate trials in this artifact. Timeline and observed graph remain available for ordinary analysis.'
                )
            );
        }
        for (const pair of pairs.items) {
            const item = button(
                `Pair ${pair.index + 1}: ${short(pair.baseline)} baseline / ${short(
                    pair.replay
                )} candidate | ${sourceLabel(pair.source)}`,
                () => loadComparison(pair.index),
                'row'
            );
            item.dataset.pair = String(pair.index);
            target.append(item);
        }
        pages(byId('pair-pages'), pairs, loadPairs);
    }
    async function loadComparison(index: number, offset = 0) {
        const revision = ++comparisonRevision;
        const value = await api('comparison', { index, offset });
        if (revision !== comparisonRevision) {
            return;
        }
        selectedPair = index;
        for (const row of byId('pairs').querySelectorAll<HTMLElement>('[data-pair]')) {
            row.classList.toggle('selected', row.dataset.pair === String(index));
        }
        const target = byId('comparison');
        target.replaceChildren(el('h3', `Pair ${selectedPair + 1}`));
        const sides = el('div', undefined, 'sides');
        value.sides.forEach((side, sideIndex) => {
            const section = el('div', undefined, 'side');
            section.append(
                el('h3', sideIndex === 0 ? 'Baseline' : 'Candidate (actual replay)'),
                link(side.span, side.entry.seq, side.span),
                el('p', side.entry.source),
                el('p', side.meaning, 'muted')
            );
            for (const boundary of side.boundaries) {
                if (boundary.seq !== null) {
                    const seq = boundary.seq;
                    const item = button(
                        `${boundary.phase} #${seq} | checkpoint ${short(String(boundary.span))}; owner trial ${short(
                            side.span
                        )}`,
                        () => selectEvent(seq),
                        'boundary'
                    );
                    item.dataset.boundary = `${sideIndex}-${boundary.phase}`;
                    item.dataset.seq = String(seq);
                    section.append(item);
                } else {
                    section.append(
                        el('p', `${boundary.phase}: UNKNOWN (missing, aborted, ambiguous or truncated)`, 'warning')
                    );
                }
            }
            section.append(el('h3', 'First actual TypeResult'));
            if (side.firstResult) {
                const result = side.firstResult;
                section.append(el('p', `First-result own-field snapshot complete: ${text(result.snapshotComplete)}`));
                section.append(
                    result.id
                        ? link(result.id, result.seq, `${result.id} at #${result.seq}`)
                        : el('p', `Return at #${result.seq}; identity unobserved`),
                    fieldsTable(result.fields, result.seq)
                );
                section.append(
                    el(
                        'p',
                        'Native isIncomplete, when recorded, is distinct from snapshot completeness. Equal Types do not merge TypeResult identities.',
                        'muted'
                    )
                );
            } else {
                section.append(el('p', 'First result unknown; not reconstructed from a later cache read.', 'warning'));
            }
            section.append(el('h3', 'Trial outcome / private diagnostics'));
            if (side.outcome) {
                const outcome = side.outcome;
                section.append(el('p', `failed: ${text(outcome.failed)} (observed trial outcome)`));
                if (outcome.id) {
                    section.append(link(outcome.id, outcome.seq, 'Outcome fields'));
                }
                if (outcome.diagnostics) {
                    section.append(link(outcome.diagnostics, outcome.seq, 'Private diagnostics collection'));
                    section.append(
                        el(
                            'p',
                            `Diagnostic collection snapshot complete: ${text(
                                outcome.diagnosticsSnapshotComplete
                            )}; individual diagnostics and children may be partial.`,
                            'muted'
                        )
                    );
                }
                for (const diagnostic of side.diagnostics) {
                    const detail = el('details');
                    detail.append(
                        el('summary', diagnostic.id ?? 'Diagnostic (unobserved identity)'),
                        fieldsTable(diagnostic.fields, diagnostic.seq)
                    );
                    if (diagnostic.id) {
                        detail.append(link(diagnostic.id, diagnostic.seq, 'Inspect diagnostic'));
                    }
                    section.append(detail);
                }
                if (side.diagnosticsCapped) {
                    section.append(
                        el(
                            'p',
                            'Diagnostic preview capped at 20; inspect collection fields/history for more.',
                            'warning'
                        )
                    );
                }
            } else {
                section.append(el('p', 'Trial return/outcome unknown.', 'warning'));
            }
            const counts = el('details');
            counts.append(
                el('summary', `Inclusive native counts${side.countsCapped ? ' (100-key display cap)' : ''}`),
                fieldsTable(
                    side.counts.map((item) => ({ key: item.name, value: item.count })),
                    side.entry.seq
                )
            );
            section.append(counts);
            sides.append(section);
        });
        target.append(sides, el('h3', 'Six owned boundary observations'), el('p', value.meaning, 'muted'));
        const wrapper = el('div', undefined, 'changes');
        const table = el('table', undefined, 'fields');
        const heading = el('tr');
        for (const name of ['Entity', ...value.order, 'Observed changes']) {
            heading.append(el('th', name));
        }
        table.append(heading);
        for (const change of value.changes.items) {
            const row = el('tr');
            row.append(el('td', short(change.entity)));
            change.versions.forEach((version, boundaryIndex) => {
                const cell = el('td');
                const seq = change.observationSequences[boundaryIndex];
                if (version !== null && seq !== null) {
                    const control = link(
                        change.entity,
                        seq,
                        `v${version} observed #${seq}${change.complete[boundaryIndex] ? '' : ' (partial)'}`
                    );
                    control.title = `${change.entity}; boundary observation #${seq}; version introduced #${change.stateSequences[boundaryIndex]}`;
                    cell.append(control);
                } else {
                    cell.textContent = 'unknown';
                }
                row.append(cell);
            });
            row.append(
                el(
                    'td',
                    `baseline: ${change.baselineChange}; unwind: ${change.unwindChange}; between trials: ${change.betweenTrials}; replay: ${change.replayChange}; observed own-field change survived unwind: ${change.observedMutationSurvived}`
                )
            );
            table.append(row);
        }
        wrapper.append(table);
        target.append(wrapper);
        pages(byId('comparison-pages'), value.changes, (next) => loadComparison(index, next));
    }
    const submit = (id: string, action: () => Promise<void>) =>
        byId(id).addEventListener('submit', (event) => {
            event.preventDefault();
            run(action);
        });
    submit('filters', () => loadTimeline());
    submit('cursor-form', () => selectEvent(Number(input('cursor').value), selectedId || undefined));
    submit('entity-form', () => showEntity(input('entity-id').value));
    for (const id of ['relation', 'hops']) {
        input(id).addEventListener('change', () => {
            if (selectedId) {
                run(() => showEntity(selectedId));
            }
        });
    }
    run(async () => {
        const summary = await api('summary');
        end = summary.end;
        input('cursor').setAttribute('max', String(end));
        byId('artifact').textContent = summary.label;
        const status =
            summary.status && typeof summary.status === 'object' && !Array.isArray(summary.status)
                ? summary.status
                : {};
        byId('status').textContent = `Capture ${text(status.status ?? 'unknown')}; tracing exhausted: ${text(
            status.exhausted ?? 'unknown'
        )}; dropped records: ${text(status.dropped ?? 'unknown')}; graph gaps: ${text(status.gaps ?? 'unknown')}`;
        byId('coverage-body').append(
            el('p', summary.warning),
            el('h3', 'Capture footer'),
            el('pre', summary.status),
            el('h3', 'Recorded adapter coverage'),
            el('pre', summary.coverage),
            el('h3', 'Provenance (bounded display)'),
            el('pre', summary.provenance),
            el('h3', 'Viewer display limits'),
            el('pre', summary.limits)
        );
        const kinds = input('kind');
        kinds.replaceChildren();
        kinds.append(el('option', 'All events'));
        (kinds.firstElementChild as HTMLOptionElement).value = '';
        for (const kind of summary.kinds) {
            const option = el('option', kind === 'enter' ? 'enter (occurrences)' : kind);
            option.value = kind;
            kinds.append(option);
        }
        kinds.value = 'enter';
        await Promise.all([loadTimeline(timelineOffset), loadPairs()]);
        const firstOccurrence = byId('timeline').querySelector<HTMLButtonElement>('[data-seq]');
        await selectEvent(Number(firstOccurrence?.dataset.seq ?? 1));
    });
}
