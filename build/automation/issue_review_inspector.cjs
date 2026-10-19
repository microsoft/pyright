// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

const fs = require('node:fs');
const inspector = require('node:inspector');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

exports.capture = async function capture(manifest, report) {
    if (!manifest.breakpoints.length) {
        return () => {};
    }
    const support = require.resolve('source-map-support', { paths: [manifest.dependency_root] });
    const { SourceMapConsumer } = require(require.resolve('source-map', { paths: [path.dirname(support)] }));
    const consumer = await new SourceMapConsumer(JSON.parse(fs.readFileSync(manifest.bundle + '.map', 'utf8')));
    const session = new inspector.Session();
    const requested = new Map();
    const post = (method, params = {}) =>
        new Promise((resolve, reject) => {
            session.post(method, params, (error, result) => (error ? reject(error) : resolve(result)));
        });
    session.connect();
    try {
        await post('Debugger.enable');
        session.on('Debugger.paused', ({ params }) => {
            try {
                for (const id of params.hitBreakpoints || []) {
                    const breakpoint = requested.get(id);
                    if (!breakpoint || report.hits.length >= 20) {
                        continue;
                    }
                    const frame = params.callFrames[0];
                    const hit = {
                        file: breakpoint.file,
                        requested_line: breakpoint.line,
                        actual_source: consumer.originalPositionFor({
                            line: frame.location.lineNumber + 1,
                            column: frame.location.columnNumber,
                        }),
                        function_name: frame.functionName,
                        evaluations: [],
                    };
                    report.hits.push(hit);
                    for (const expression of breakpoint.expressions) {
                        session.post(
                            'Debugger.evaluateOnCallFrame',
                            {
                                callFrameId: frame.callFrameId,
                                expression,
                                returnByValue: true,
                                throwOnSideEffect: true,
                                timeout: 1000,
                            },
                            (error, result) => {
                                hit.evaluations.push({ expression, error: error ? String(error) : null, result });
                            }
                        );
                    }
                    session.post('Debugger.removeBreakpoint', { breakpointId: id });
                }
            } catch (error) {
                report.errors.push(String(error));
            } finally {
                session.post('Debugger.resume', {}, (error) => {
                    if (error) {
                        report.errors.push(String(error));
                    }
                });
            }
        });
        for (const breakpoint of manifest.breakpoints) {
            const suffix = '/src/' + breakpoint.file.replace(/\\/g, '/');
            const matches = consumer.sources.filter((source) => decodeURI(source).endsWith(suffix));
            if (matches.length !== 1) {
                throw new Error(`Expected one mapped source for ${breakpoint.file}; found ${matches.length}`);
            }
            const source = matches[0];
            const current = fs.readFileSync(path.join(manifest.source_root, breakpoint.file), 'utf8');
            if (consumer.sourceContentFor(source).replace(/\r\n/g, '\n') !== current.replace(/\r\n/g, '\n')) {
                throw new Error(`Build/source mismatch for ${breakpoint.file}; rebuild before RCA`);
            }
            const position = consumer.generatedPositionFor({
                source,
                line: breakpoint.line,
                column: 0,
                bias: SourceMapConsumer.LEAST_UPPER_BOUND,
            });
            if (position.line === null) {
                throw new Error(`No executable source mapping for ${breakpoint.file}:${breakpoint.line}`);
            }
            const url = pathToFileURL(manifest.bundle).href;
            const escaped = url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const target =
                process.platform === 'win32'
                    ? {
                          urlRegex:
                              '^' +
                              escaped.replace(
                                  /[a-z]/gi,
                                  (letter) => `[${letter.toLowerCase()}${letter.toUpperCase()}]`
                              ) +
                              '$',
                      }
                    : { url };
            const result = await post('Debugger.setBreakpointByUrl', {
                ...target,
                lineNumber: position.line - 1,
                columnNumber: position.column,
            });
            requested.set(result.breakpointId, breakpoint);
            report.mapped_breakpoints.push({ ...breakpoint, generated: position, breakpoint_id: result.breakpointId });
        }
        return () => session.disconnect();
    } catch (error) {
        session.disconnect();
        throw error;
    }
};
