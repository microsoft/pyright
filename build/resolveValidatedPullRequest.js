/*
 * resolveValidatedPullRequest.js
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 */

module.exports = async ({ github, context, core, requireSuccess = true }) => {
    const run = context.payload.workflow_run;
    if (
        run.name !== 'Validation' ||
        run.path !== '.github/workflows/validation.yml' ||
        run.event !== 'pull_request' ||
        (requireSuccess && run.conclusion !== 'success') ||
        run.repository.full_name !== `${context.repo.owner}/${context.repo.repo}`
    ) {
        core.notice('Only successful pull request Validation runs can start follow-up checks');
        return;
    }

    const headOwner = run.head_repository?.owner?.login;
    if (!headOwner || !run.head_branch || !run.head_sha) {
        core.setFailed('The Validation run is missing pull request head information');
        return;
    }
    const pullRequests = await github.paginate(github.rest.pulls.list, {
        ...context.repo,
        state: 'open',
        head: `${headOwner}:${run.head_branch}`,
        per_page: 100,
    });
    const matchingPullRequests = pullRequests.filter(
        (pr) => pr.head.sha === run.head_sha && pr.head.repo?.id === run.head_repository.id
    );
    if (matchingPullRequests.length !== 1) {
        core.notice(`Expected one current open pull request for Validation, found ${matchingPullRequests.length}`);
        return;
    }

    const { data: pullRequest } = await github.rest.pulls.get({
        ...context.repo,
        pull_number: matchingPullRequests[0].number,
    });
    if (
        pullRequest.state !== 'open' ||
        pullRequest.head.sha !== run.head_sha ||
        pullRequest.head.repo?.id !== run.head_repository.id
    ) {
        core.notice('The pull request changed after Validation');
        return;
    }
    const files = await github.paginate(github.rest.pulls.listFiles, {
        ...context.repo,
        pull_number: pullRequest.number,
        per_page: 100,
    });
    return { pullRequest, files };
};
