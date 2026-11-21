/*
 * reportPullRequestCheck.js
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 */

module.exports = async ({
    github,
    context,
    name,
    headSha,
    status,
    conclusion,
    summary,
    checkId,
    statusId,
    targetUrl,
    useCommitStatus,
}) => {
    if (useCommitStatus) {
        return reportCommitStatus({ github, context, name, headSha, status, conclusion, summary, statusId, targetUrl });
    }

    // Workflow runs started before the status migration may still report a check ID.
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
    // Queue reporting can race with a fast Validation run. Never reset an active or finished check.
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

async function reportCommitStatus({
    github,
    context,
    name,
    headSha,
    status,
    conclusion,
    summary,
    statusId,
    targetUrl,
}) {
    if (!name || !headSha || !summary) {
        throw new Error('A name, head SHA, and summary are required to report a commit status');
    }

    const queuedDescription = 'Waiting for Validation to pass.';
    const statuses = await github.paginate(github.rest.repos.listCommitStatusesForRef, {
        ...context.repo,
        ref: headSha,
        per_page: 100,
    });
    const existing = statuses.find((entry) => entry.context.toLowerCase() === name.toLowerCase());
    if (statusId !== undefined) {
        const id = Number(statusId);
        if (!Number.isSafeInteger(id) || id <= 0) {
            throw new Error('The commit status ID is invalid');
        }
        // The workflow concurrency group serializes this comparison and the new status.
        if (!existing || existing.id !== id) {
            return;
        }
    } else if (
        existing &&
        (status === 'queued' ||
            (status === 'completed' && (existing.state !== 'pending' || existing.description !== queuedDescription)))
    ) {
        return;
    }

    let state;
    if (statusId !== undefined || status === 'completed') {
        switch (conclusion) {
            case 'success':
            case 'skipped':
                state = 'success';
                break;
            case 'failure':
                state = 'failure';
                break;
            case 'cancelled':
                state = 'error';
                break;
            default:
                throw new Error(`Unsupported commit status conclusion: ${conclusion}`);
        }
    } else if (status === 'queued' || status === 'in_progress') {
        state = 'pending';
    } else {
        throw new Error(`Unsupported commit status phase: ${status}`);
    }

    const { data } = await github.rest.repos.createCommitStatus({
        ...context.repo,
        sha: headSha,
        context: name,
        state,
        description: status === 'queued' ? queuedDescription : summary,
        target_url:
            targetUrl ??
            `${context.serverUrl}/${context.repo.owner}/${context.repo.repo}/actions/runs/${context.runId}`,
    });
    return data.id;
}
