# Browser playground

Build the standalone worker and demonstration page from the repository root:

```sh
pnpm run build:browser
```

Serve `packages/pyright/dist/playground` using a static HTTP server, then open
`index.html`. The page sends LSP document changes to a Web Worker and displays
Pyright diagnostics. Python code is not executed or sent to an analysis service.
The worker downloads bundled standard-library stubs from the same static site.
Required stub download failures are reported rather than replaced with empty
type information.

All asset URLs are relative to the page and worker. The output can be hosted
under a prefix such as `/pyright/playground/` without a separate application
backend or cross-origin isolation headers. Deployment is separate from the
build.

## Runtime boundaries

The browser filesystem, URI case-sensitivity adapter, JSON-RPC transport,
object-URL cancellation, and process shim live in
`packages/pyright-internal/src/browser`. The browser server supplies these
services to `PyrightServerBase` instead of creating Node filesystem watchers,
temporary files, background threads, or an interpreter host. Type checking and
missing-import diagnostics remain enabled.

The demonstration edits one open virtual file. It has no package installation,
Python execution, persisted workspace, or multi-file editing UI. The filesystem
serves an indexed read-only set of static stubs, not the user's local disk.
Third-party packages are not included. The build includes typeshed's license
alongside its standard-library stubs and Pyright's license at the output root.

Cancellation uses revocable object URLs so synchronous analysis can observe a
cancelled request without shared memory. The demonstration's restart button
terminates and replaces the worker. Browser heap statistics are not portable;
the process shim reports zero rather than pretending to measure memory usage.
Large-workspace memory limits and recovery require separate validation.

## Development checks

From `packages/pyright-internal`, run:

```sh
node node_modules/jest/bin/jest.js browserServer.test browserCancellation.test --runInBand
```

This exercises initialization, a standard-library import, a real type error,
editing the error away, and missing-import diagnostics through LSP using the
browser filesystem and host. It uses an in-process transport and mocked static
HTTP reads. The cancellation test verifies synchronous observation of a revoked
object URL. These tests do not replace a smoke check of the built worker in a browser.

### Automated browser smoke test

Install Playwright's Chromium once, then run the test from the repository root:

```sh
pnpm --dir packages/pyright exec playwright install chromium
pnpm run test:browser
```

The command builds the distribution, serves it on an automatically selected
loopback port at `/pyright/playground/`, and runs a headless browser. It checks
worker startup, standard-library types, diagnostics after edits, missing imports,
and worker restart without cross-origin isolation. The test owns and closes its
static server; no separate server or analysis backend is required.

To use an installed Edge browser instead of downloading Chromium, set
`PLAYWRIGHT_CHANNEL=msedge` before running the command. Failure screenshots and
traces are saved under `packages/pyright/test-results/browser`.
