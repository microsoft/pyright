/*
 * reportPullRequestCheck.js
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 */

module.exports = async ({ github, context, name, headSha, status, conclusion, summary, checkId }) => {
    const externalId = `pyright-follow-up:${name}`;
    const output = { title: name, summary };
    if (checkId) {
        await github.rest.checks.update({
            ...context.repo,
            check_run_id: Number(checkId),
            status: 'completed',
            conclusion,
            completed_at: new Date().toISOString(),
            output,
        });
        return;
    }

    const checks = await github.paginate(github.rest.checks.listForRef, {
        ...context.repo,
        ref: headSha,
        check_name: name,
        filter: 'latest',
        per_page: 100,
    });
    const existing = checks.find((check) => check.external_id === externalId);
    // PR-open reporting can race with a fast Validation run. Never reset an active or finished check.
    if (existing && (status === 'queued' || (status === 'completed' && existing.status !== 'queued'))) {
        return;
    }
    const parameters = {
        ...context.repo,
        name,
        external_id: externalId,
        status,
        ...(conclusion ? { conclusion } : {}),
        ...(status === 'in_progress' ? { started_at: new Date().toISOString() } : {}),
        ...(status === 'completed' ? { completed_at: new Date().toISOString() } : {}),
        details_url: `${context.serverUrl}/${context.repo.owner}/${context.repo.repo}/actions/runs/${context.runId}`,
        output,
    };
    // Each execution gets its own check so a cancelled older run cannot finish a newer run's check.
    const { data } =
        existing?.status === 'queued'
            ? await github.rest.checks.update({ ...parameters, check_run_id: existing.id })
            : await github.rest.checks.create({ ...parameters, head_sha: headSha });
    return data.id;
};
