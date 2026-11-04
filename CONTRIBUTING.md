# Contributing

This project welcomes contributions and suggestions. Most contributions require you to agree to a Contributor License Agreement (CLA) declaring that you have the right to, and actually do, grant us the rights to use your contribution. For details, visit https://cla.microsoft.com.

If you are considering adding a new feature, it is recommended that you start by submitting an enhancement request so project maintainers can discuss, determine whether such an enhancement would be accepted, and provide input on the best way to implement the enhancement.

When you submit a pull request, a CLA-bot will automatically determine whether you need to provide a CLA and decorate the PR appropriately (e.g., label, comment). Simply follow the instructions provided by the bot. You will only need to do this once across all repositories using our CLA.

This project has adopted the [Microsoft Open Source Code of Conduct](https://opensource.microsoft.com/codeofconduct/). For more information see the [Code of Conduct FAQ](https://opensource.microsoft.com/codeofconduct/faq/) or contact [opencode@microsoft.com](mailto:opencode@microsoft.com) with any additional questions or comments.

## Development setup

Install [Node.js](https://nodejs.org/en/) 24 with npm; the [validation workflow](.github/workflows/validation.yml)
records the exact Node.js version used in CI. Clone the repository and run the following from its root:

```bash
npm run installPinnedPackageManager
pnpm run install:all
```

The bootstrap script installs the pnpm version pinned by `packageManager` in [package.json](package.json).
Use pnpm for workspace dependency installation, builds, and tests; npm is only needed to bootstrap pnpm.
Commit dependency changes with the updated [pnpm lockfile](pnpm-lock.yaml).
For a reproducible installation without lockfile changes, use `pnpm install --frozen-lockfile`.

If pnpm is already available through Corepack or another installation, compare `pnpm --version` with
the pin in [package.json](package.json). When they match, skip the bootstrap and run `pnpm run install:all`.
The bootstrap can otherwise fail with `EEXIST` when a Corepack shim already occupies the pnpm executable
path; do not force-overwrite it. Configure the existing package-manager installation to use the pinned version.

Local installs use the default npm registry. The authenticated internal feed is configured separately
for trusted Azure DevOps jobs by the [npm authentication template](build/templates/npmAuthenticate.yml).

## Building and testing

Run these commands from the repository root:

```bash
# Compile the core TypeScript library.
pnpm --dir packages/pyright-internal run build

# Build the test server and run the test suite.
pnpm test

# Reuse the existing test-server build for subsequent test runs.
pnpm --dir packages/pyright-internal run test:norebuild

# Run a single test file after building the test server.
pnpm --dir packages/pyright-internal exec jest typeEvaluator1.test --runInBand --forceExit

# Run formatting, lint, and dependency consistency checks.
pnpm run check
```

Rebuild the test server with `pnpm --dir packages/pyright-internal run webpack:testserver` after changing
its sources, or use `pnpm test` to rebuild it automatically.
CI limits macOS tests to one Jest worker and a Node.js heap of half the runner's RAM to avoid swapping
on the 7 GiB hosted runners. The percentage-based heap limit overrides the test script's fixed 8 GiB
limit; local runs and other CI platforms retain their existing defaults.
Mac CI uploads test output and JSON results as `macos-test-logs-<attempt>` artifacts and publishes
timing and failure summaries in workflow annotations.
See [building and debugging](docs/build-debug.md) for CLI builds, extension packaging, and VS Code debugging.

## Measuring performance changes

On macOS, keep the machine awake while timing tests with `caffeinate -dimsu pnpm test`.
Avoid closing the lid or manually sleeping the machine: sleep can inflate Jest's reported wall-clock
durations even when tests pass.

To check whether a change affects Pyright's type-checking performance, use `build/perfCompare.py`. It builds the production CLI bundle at each of two or more commits and times repeated runs over a fixed corpus, reporting robust paired deltas. Example:

```
python build/perfCompare.py --metric cpu --num-runs 50 --corpus <path-to-python-project> main HEAD
```

See the script's `--help` and module docstring for options and methodology.

To compare the local Pyright build's speed and peak memory with the latest PyPI release or with
Pyrefly, ty, mypy, and Zuban on the pinned corpus, use `build/benchmark/typecheck_benchmark.py`.
Pull requests that change analyzer sources run the hosted regression benchmark after Validation
succeeds. Both the benchmark and mypy_primer wait for the tests to pass and, for external contributors,
for a maintainer to approve workflows to run. Maintainers can run the benchmark again by commenting
`/benchmark`. See [the benchmark README](build/benchmark/README.md) for the developer and maintainer
workflows, prerequisites, and methodology.
