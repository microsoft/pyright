/*
 * checkAuthorResponsibility.js
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Checks a pull request's description for the PR template's author responsibility box.
 */

const POLICY_SHA = 'adbc99c67880f5846da08aa64264d01632b79eb4';
const MARKER = `<!-- author-responsibility:${POLICY_SHA} -->`;
const NAME = 'Author responsibility';
const BOX_TEXT = 'I personally reviewed and understand this entire pull request';
const TEMPLATE_LINE = `- [x] ${BOX_TEXT}`;

let policyMergedAt;

function textOf(html) {
    return html
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

// Returns the checkbox's <input> tag, or undefined if the description has no box.
// Each task list item's own content ends where a nested list or the next item starts.
function findBox(html) {
    return [
        ...html.matchAll(
            /<li class="task-list-item[^"]*">(?:\s*<p[^>]*>)?\s*(<input [^>]*>)([\s\S]*?)(?=<\/?li[\s>]|<[uo]l[\s>])/g
        ),
    ].find(([, , content]) => textOf(content).startsWith(BOX_TEXT))?.[1];
}

async function evaluate({ github, context, pullNumber }) {
    const { owner, repo } = context.repo;
    // The "full" format adds `body_html`, the rendered description.
    const { data: pullRequest } = await github.rest.pulls.get({
        owner,
        repo,
        pull_number: pullNumber,
        mediaType: { format: 'full' },
    });
    if (pullRequest.user.type === 'Bot') {
        return { pullRequest, result: { state: 'success', description: 'Not required for bots.', exempt: true } };
    }
    if (policyMergedAt === undefined) {
        const { data: policyCommit } = await github.rest.repos.getCommit({ owner, repo, ref: POLICY_SHA });
        policyMergedAt = Date.parse(policyCommit.commit.committer.date);
    }
    if (Date.parse(pullRequest.created_at) < policyMergedAt) {
        return { pullRequest, result: { state: 'success', description: 'Opened before the AI policy.', exempt: true } };
    }

    const box = findBox(pullRequest.body_html ?? '');
    if (box === undefined) {
        return {
            pullRequest,
            result: {
                state: 'failure',
                description: 'The author responsibility box is missing.',
                problem: `Add \`${TEMPLATE_LINE}\` to the PR description.`,
            },
        };
    }
    if (!/\schecked[\s=>]/.test(box)) {
        return {
            pullRequest,
            result: {
                state: 'failure',
                description: 'The author responsibility box is unchecked.',
                problem: 'Check the "Author responsibility" box in the PR description.',
            },
        };
    }
    return { pullRequest, result: { state: 'success', description: 'The author responsibility box is checked.' } };
}

module.exports = { MARKER, NAME, evaluate };
