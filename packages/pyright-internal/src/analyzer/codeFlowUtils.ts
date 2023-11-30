/*
 * codeFlowUtils.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Utility functions that operate on code flow nodes and graphs.
 */

import { convertOffsetToPosition } from '../common/positionUtils';
import { ParseNode } from '../parser/parseNodes';
import { getFileInfo } from './analyzerNodeInfo';
import {
    FlowAssignment,
    FlowCall,
    FlowCondition,
    FlowExhaustedMatch,
    FlowFlags,
    FlowLabel,
    FlowNarrowForPattern,
    FlowNode,
    FlowPostFinally,
    FlowPreFinallyGate,
    FlowVariableAnnotation,
    FlowWildcardImport,
} from './codeFlowTypes';

export function formatControlFlowGraph(flowNode: FlowNode) {
    const enum BoxCharacter {
        lr = '─',
        ud = '│',
        dr = '╭',
        dl = '╮',
        ul = '╯',
        ur = '╰',
        udr = '├',
        udl = '┤',
        dlr = '┬',
        ulr = '┴',
        udlr = '╫',
    }

    const enum Connection {
        None = 0,
        Up = 1 << 0,
        Down = 1 << 1,
        Left = 1 << 2,
        Right = 1 << 3,

        UpDown = Up | Down,
        LeftRight = Left | Right,
        UpLeft = Up | Left,
        UpRight = Up | Right,
        DownLeft = Down | Left,
        DownRight = Down | Right,
        UpDownLeft = UpDown | Left,
        UpDownRight = UpDown | Right,
        UpLeftRight = Up | LeftRight,
        DownLeftRight = Down | LeftRight,
        UpDownLeftRight = UpDown | LeftRight,

        NoChildren = 1 << 4,
    }

    interface FlowGraphNode {
        id: number;
        flowNode: FlowNode;
        edges: FlowGraphEdge[];
        text: string;
        lane: number;
        endLane: number;
        level: number;
        circular: boolean;
    }

    interface FlowGraphEdge {
        source: FlowGraphNode;
        target: FlowGraphNode;
    }

    const links: Record<number, FlowGraphNode> = Object.create(/* o */ null);
    const nodes: FlowGraphNode[] = [];
    const edges: FlowGraphEdge[] = [];
    const root = buildGraphNode(flowNode, new Set());

    for (const node of nodes) {
        node.text = renderFlowNode(node.flowNode, node.circular);
        computeLevel(node);
    }

    const height = computeHeight(root);
    const columnWidths = computeColumnWidths(height);
    computeLanes(root, 0);
    return renderGraph();

    function getAntecedents(f: FlowNode): FlowNode[] {
        if (f.flags & (FlowFlags.LoopLabel | FlowFlags.BranchLabel)) {
            return (f as FlowLabel).antecedents;
        }

        if (
            f.flags &
            (FlowFlags.Assignment |
                FlowFlags.VariableAnnotation |
                FlowFlags.WildcardImport |
                FlowFlags.TrueCondition |
                FlowFlags.FalseCondition |
                FlowFlags.TrueNeverCondition |
                FlowFlags.FalseNeverCondition |
                FlowFlags.NarrowForPattern |
                FlowFlags.ExhaustedMatch |
                FlowFlags.Call |
                FlowFlags.PreFinallyGate |
                FlowFlags.PostFinally)
        ) {
            const typedFlowNode = f as
                | FlowAssignment
                | FlowVariableAnnotation
                | FlowWildcardImport
                | FlowCondition
                | FlowExhaustedMatch
                | FlowCall
                | FlowPreFinallyGate
                | FlowPostFinally;
            return [typedFlowNode.antecedent];
        }

        return [];
    }

    function getChildren(node: FlowGraphNode) {
        const children: FlowGraphNode[] = [];
        for (const edge of node.edges) {
            if (edge.source === node) {
                children.push(edge.target);
            }
        }
        return children;
    }

    function getParents(node: FlowGraphNode) {
        const parents: FlowGraphNode[] = [];
        for (const edge of node.edges) {
            if (edge.target === node) {
                parents.push(edge.source);
            }
        }
        return parents;
    }

    function buildGraphNode(flowNode: FlowNode, seen: Set<FlowNode>): FlowGraphNode {
        const id = flowNode.id;
        let graphNode = links[id];

        if (graphNode && seen.has(flowNode)) {
            graphNode = {
                id: -1,
                flowNode,
                edges: [],
                text: '',
                lane: -1,
                endLane: -1,
                level: -1,
                circular: true,
            };
            nodes.push(graphNode);
            return graphNode;
        }
        seen.add(flowNode);

        if (!graphNode) {
            links[id] = graphNode = {
                id,
                flowNode,
                edges: [],
                text: '',
                lane: -1,
                endLane: -1,
                level: -1,
                circular: false,
            };

            nodes.push(graphNode);

            const antecedents = getAntecedents(flowNode);
            for (const antecedent of antecedents) {
                buildGraphEdge(graphNode, antecedent, seen);
            }
        }

        seen.delete(flowNode);
        return graphNode;
    }

    function buildGraphEdge(source: FlowGraphNode, antecedent: FlowNode, seen: Set<FlowNode>) {
        const target = buildGraphNode(antecedent, seen);
        const edge: FlowGraphEdge = { source, target };
        edges.push(edge);
        source.edges.push(edge);
        target.edges.push(edge);
    }

    function computeLevel(node: FlowGraphNode): number {
        if (node.level !== -1) {
            return node.level;
        }
        let level = 0;
        for (const parent of getParents(node)) {
            level = Math.max(level, computeLevel(parent) + 1);
        }
        return (node.level = level);
    }

    function computeHeight(node: FlowGraphNode): number {
        let height = 0;
        for (const child of getChildren(node)) {
            height = Math.max(height, computeHeight(child));
        }
        return height + 1;
    }

    function computeColumnWidths(height: number) {
        const columns: number[] = fill(Array(height), 0);
        for (const node of nodes) {
            columns[node.level] = Math.max(columns[node.level], node.text.length);
        }
        return columns;
    }

    function computeLanes(node: FlowGraphNode, lane: number) {
        if (node.lane === -1) {
            node.lane = lane;
            node.endLane = lane;
            const children = getChildren(node);
            for (let i = 0; i < children.length; i++) {
                if (i > 0) lane++;
                const child = children[i];
                computeLanes(child, lane);
                if (child.endLane > node.endLane) {
                    lane = child.endLane;
                }
            }
            node.endLane = lane;
        }
    }

    function getHeader(flags: FlowFlags) {
        if (flags & FlowFlags.Start) return 'Start';
        if (flags & FlowFlags.BranchLabel) return 'Branch';
        if (flags & FlowFlags.LoopLabel) return 'Loop';
        if (flags & FlowFlags.Unbind) return 'Unbind';
        if (flags & FlowFlags.Assignment) return 'Assign';
        if (flags & FlowFlags.TrueCondition) return 'True';
        if (flags & FlowFlags.FalseCondition) return 'False';
        if (flags & FlowFlags.Call) return 'Call';
        if (flags & FlowFlags.Unreachable) return 'Unreachable';
        if (flags & FlowFlags.WildcardImport) return 'Wildcard';
        if (flags & FlowFlags.PreFinallyGate) return 'PreFinal';
        if (flags & FlowFlags.PostFinally) return 'PostFinal';
        if (flags & FlowFlags.VariableAnnotation) return 'Annotate';
        if (flags & FlowFlags.TrueNeverCondition) return 'TrueNever';
        if (flags & FlowFlags.FalseNeverCondition) return 'FalseNever';
        if (flags & FlowFlags.NarrowForPattern) return 'Pattern';
        if (flags & FlowFlags.ExhaustedMatch) return 'Exhaust';
        throw new Error();
    }

    function getParseNode(f: FlowNode): ParseNode | undefined {
        if (f.flags & FlowFlags.Assignment) {
            return (f as FlowAssignment).node;
        }

        if (f.flags & FlowFlags.WildcardImport) {
            return (f as FlowWildcardImport).node;
        }

        if (f.flags & (FlowFlags.TrueCondition | FlowFlags.FalseCondition)) {
            return (f as FlowCondition).expression;
        }

        if (f.flags & FlowFlags.NarrowForPattern) {
            return (f as FlowNarrowForPattern).statement;
        }

        if (f.flags & FlowFlags.Call) {
            return (f as FlowCall).node;
        }

        return undefined;
    }

    function getNodeText(f: FlowNode): string | undefined {
        const parseNode = getParseNode(f);

        if (!parseNode) {
            return undefined;
        }

        const fileInfo = getFileInfo(parseNode);
        const startPos = convertOffsetToPosition(parseNode.start, fileInfo.lines);

        return `[${startPos.line + 1}:${startPos.character + 1}]`;
    }

    function renderFlowNode(flowNode: FlowNode, circular: boolean) {
        const text = `${getHeader(flowNode.flags)}@${flowNode.id}${getNodeText(flowNode) || ''}`;
        return circular ? `Circular(${text})` : text;
    }

    function renderGraph() {
        const columnCount = columnWidths.length;
        const laneCount = nodes.reduce((x, n) => Math.max(x, n.lane), 0) + 1;
        const lanes: string[] = fill(Array(laneCount), '');
        const grid: (FlowGraphNode | undefined)[][] = columnWidths.map(() => Array(laneCount));
        const connectors: Connection[][] = columnWidths.map(() => fill(Array(laneCount), 0));

        // Build connectors.
        for (const node of nodes) {
            grid[node.level][node.lane] = node;
            const children = getChildren(node);
            for (let i = 0; i < children.length; i++) {
                const child = children[i];
                let connector: Connection = Connection.Right;
                if (child.lane === node.lane) connector |= Connection.Left;
                if (i > 0) connector |= Connection.Up;
                if (i < children.length - 1) connector |= Connection.Down;
                connectors[node.level][child.lane] |= connector;
            }
            if (children.length === 0) {
                connectors[node.level][node.lane] |= Connection.NoChildren;
            }
            const parents = getParents(node);
            for (let i = 0; i < parents.length; i++) {
                const parent = parents[i];
                let connector: Connection = Connection.Left;
                if (i > 0) connector |= Connection.Up;
                if (i < parents.length - 1) connector |= Connection.Down;
                connectors[node.level - 1][parent.lane] |= connector;
            }
        }

        // Fill in missing connectors.
        for (let column = 0; column < columnCount; column++) {
            for (let lane = 0; lane < laneCount; lane++) {
                const left = column > 0 ? connectors[column - 1][lane] : 0;
                const above = lane > 0 ? connectors[column][lane - 1] : 0;
                let connector = connectors[column][lane];
                if (!connector) {
                    connector = Connection.None;

                    if (left & Connection.Right) {
                        connector |= Connection.LeftRight;
                    }
                    if (above & Connection.Down) {
                        connector |= Connection.UpDown;
                    }
                    connectors[column][lane] = connector;
                }
            }
        }

        for (let column = 0; column < columnCount; column++) {
            for (let lane = 0; lane < lanes.length; lane++) {
                const connector = connectors[column][lane];
                const fill = connector & Connection.Left ? BoxCharacter.lr : ' ';
                const node = grid[column][lane];
                if (!node) {
                    if (column < columnCount - 1) {
                        writeLane(lane, repeat(fill, columnWidths[column] + 1));
                    }
                } else {
                    writeLane(lane, node.text);
                    if (column < columnCount - 1) {
                        writeLane(lane, ' ');
                        writeLane(lane, repeat(fill, columnWidths[column] - node.text.length));
                    }
                }
                writeLane(lane, getBoxCharacter(connector));
                writeLane(
                    lane,
                    connector & Connection.Right && column < columnCount - 1 && !grid[column + 1][lane]
                        ? BoxCharacter.lr
                        : ' '
                );
            }
        }

        return `${lanes.join('\n')}\n`;

        function writeLane(lane: number, text: string) {
            lanes[lane] += text;
        }
    }

    function getBoxCharacter(connector: Connection) {
        switch (connector) {
            case Connection.UpDown:
                return BoxCharacter.ud;
            case Connection.LeftRight:
                return BoxCharacter.lr;
            case Connection.UpLeft:
                return BoxCharacter.ul;
            case Connection.UpRight:
                return BoxCharacter.ur;
            case Connection.DownLeft:
                return BoxCharacter.dl;
            case Connection.DownRight:
                return BoxCharacter.dr;
            case Connection.UpDownLeft:
                return BoxCharacter.udl;
            case Connection.UpDownRight:
                return BoxCharacter.udr;
            case Connection.UpLeftRight:
                return BoxCharacter.ulr;
            case Connection.DownLeftRight:
                return BoxCharacter.dlr;
            case Connection.UpDownLeftRight:
                return BoxCharacter.udlr;
        }
        return ' ';
    }

    function fill<T>(array: T[], value: T) {
        if (array.fill) {
            array.fill(value);
        } else {
            for (let i = 0; i < array.length; i++) {
                array[i] = value;
            }
        }
        return array;
    }

    function repeat(ch: string, length: number) {
        if (ch.repeat) {
            return length > 0 ? ch.repeat(length) : '';
        }
        let s = '';
        while (s.length < length) {
            s += ch;
        }
        return s;
    }
}
