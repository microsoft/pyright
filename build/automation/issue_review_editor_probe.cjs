// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

const fs = require('node:fs');
const path = require('node:path');

async function bounded(promise, label, milliseconds = 30000) {
    let timer;
    try {
        return await Promise.race([
            promise,
            new Promise((_, reject) => {
                timer = setTimeout(() => reject(new Error(`${label} timed out`)), milliseconds);
            }),
        ]);
    } finally {
        clearTimeout(timer);
    }
}

function logs(profile) {
    const output = [];
    function visit(directory) {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
            const file = path.join(directory, entry.name);
            if (entry.isDirectory()) {
                visit(file);
            } else if (entry.name.endsWith('.log')) {
                const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
                for (let index = 0; index < lines.length; index++) {
                    if (
                        /pythonPath|Python version|Pyright language server|Python extension|Error|Traceback/i.test(
                            lines[index]
                        )
                    ) {
                        output.push({
                            file: path.relative(profile, file),
                            line: index + 1,
                            text: lines[index].slice(0, 4000),
                        });
                    }
                }
            }
        }
    }
    const directory = path.join(profile, 'logs');
    if (fs.existsSync(directory)) {
        visit(directory);
    }
    return output.slice(-200);
}

exports.run = async function run() {
    const vscode = require('vscode');
    const manifest = JSON.parse(fs.readFileSync(process.env.PYRIGHT_RCA_EDITOR_MANIFEST, 'utf8'));
    const report = {
        id: manifest.id,
        case: manifest.case,
        pid: process.pid,
        host_version: vscode.version,
        startup: { VIRTUAL_ENV: process.env.VIRTUAL_ENV, PATH: process.env.PATH },
        extensions: vscode.extensions.all.map((extension) => ({
            id: extension.id,
            version: extension.packageJSON.version,
            feature_flags: extension.packageJSON.featureFlags || null,
        })),
        mapped_breakpoints: [],
        hits: [],
        errors: [],
        logs: [],
        complete: false,
        failure_observed: false,
    };
    let disconnect;
    try {
        disconnect = await require('./issue_review_inspector.cjs').capture(manifest, report);
        const python = vscode.extensions.getExtension('ms-python.python');
        const pyright = vscode.extensions.getExtension('ms-pyright.vscode-pyright');
        if (!python || !pyright || vscode.workspace.workspaceFolders?.length !== 1) {
            throw new Error('Need the actual Python/Pyright extensions and exactly one owned workspace');
        }
        const scope = vscode.workspace.workspaceFolders[0].uri;
        report.pyright_active_before_probe = pyright.isActive;
        const document = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(scope, 'main.py'));
        await vscode.window.showTextDocument(document);
        await bounded(pyright.activate(), 'Pyright activation');
        await bounded(python.activate(), 'Python activation');
        // Let the product request configuration first; do not select or inject an interpreter.
        const deadline = Date.now() + 30000;
        do {
            report.logs = logs(manifest.profile);
            const commands = await vscode.commands.getCommands(true);
            const showOutput = commands.find(
                (command) => command.includes('output.show.') && command.endsWith('-Pyright')
            );
            if (showOutput) {
                await bounded(vscode.commands.executeCommand(showOutput), 'Showing owned Pyright output');
            }
            for (const document of vscode.workspace.textDocuments) {
                if (document.uri.scheme === 'output' && document.uri.toString().includes('Pyright')) {
                    document
                        .getText()
                        .split(/\r?\n/)
                        .forEach((text, index) => {
                            report.logs.push({ file: document.uri.toString(), line: index + 1, text });
                        });
                }
            }
            if (
                report.logs.some((entry) => entry.text.includes('Received pythonPath from Python extension:')) &&
                report.logs.some((entry) => entry.text.includes('Setting pythonPath for service'))
            ) {
                break;
            }
            await new Promise((resolve) => setTimeout(resolve, 1000));
        } while (Date.now() < deadline);
        if (!python.exports?.settings?.getExecutionDetails) {
            throw new Error('Installed Python extension does not expose the legacy getExecutionDetails API');
        }
        report.execution_details = await bounded(
            python.exports.settings.getExecutionDetails(scope),
            'Python execution details'
        );
        report.feature_flags = python.packageJSON.featureFlags || null;
        if (python.exports.environments?.getActiveEnvironmentPath) {
            const active = python.exports.environments.getActiveEnvironmentPath(scope);
            report.active_environment = active;
            if (python.exports.environments.resolveEnvironment) {
                report.resolved_environment = await bounded(
                    python.exports.environments.resolveEnvironment(active),
                    'Resolving active Python environment'
                );
            }
        }
        report.forwarded_paths = report.logs
            .filter((entry) => entry.text.includes('Received pythonPath from Python extension:'))
            .map((entry) => entry.text.split('Received pythonPath from Python extension:')[1].trim());
        const samePath = (left, right) =>
            typeof left === 'string' &&
            (process.platform === 'win32'
                ? path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase()
                : path.resolve(left) === path.resolve(right));
        report.api_path_is_directory = samePath(report.execution_details?.execCommand?.[0], manifest.environment);
        report.server_paths = report.logs
            .map((entry) => /Setting pythonPath for service "[^"]*": "(.*)"/.exec(entry.text)?.[1])
            .filter((value) => value !== undefined);
        report.failure_observed =
            report.forwarded_paths.some((value) => samePath(value, manifest.environment)) &&
            report.server_paths.some((value) => samePath(value, manifest.environment));
        report.expected_executable_forwarded = report.forwarded_paths.some((value) =>
            samePath(value, manifest.expected_executable)
        );
        report.complete = report.forwarded_paths.length > 0 && report.server_paths.length > 0;
        if (!report.complete) {
            report.available_output_commands = (await vscode.commands.getCommands(true)).filter((command) =>
                command.includes('output.show.')
            );
            throw new Error('No actual Pyright interpreter handoff was observed; API-only values are partial evidence');
        }
    } catch (error) {
        report.errors.push(String(error.stack || error));
        throw error;
    } finally {
        if (disconnect) {
            disconnect();
        }
        fs.writeFileSync(manifest.artifact, JSON.stringify(report, null, 2));
    }
};
