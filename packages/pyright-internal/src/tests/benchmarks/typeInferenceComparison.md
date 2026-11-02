# Type inference comparison benchmark

This benchmark generates a deterministic Python corpus containing `reveal_type` calls, runs the current Pyright source tree and Pyrefly over the same file, and writes a Markdown comparison report.

Run it from `packages/pyright-internal`:

```powershell
pnpm run benchmark:type-inference
```

The default run generates 1,000 cases and invokes Pyrefly through `uvx`. The generated corpus and report are written under:

```text
src/tests/benchmarks/.generated/type-inference-comparison/
```

Useful options:

```powershell
pnpm run benchmark:type-inference -- --cases 5000
pnpm run benchmark:type-inference -- --python-version 3.13
pnpm run benchmark:type-inference -- --output C:\temp\typechecker-report
pnpm run benchmark:type-inference -- --pyrefly-command pyrefly
```

`PYREFLY_COMMAND` can also select a Pyrefly executable.

## Reading the report

The report classifies normalized identical types as equivalent. It identifies narrower outputs when one result contains fewer `Any`, `Unknown`, or `object` components, or preserves more `Literal` components. Other concrete differences are left for semantic adjudication.

The generated report also groups disagreements into semantic families and gives the strongest Pyrefly-side argument for each. This is important because widening can be an intentional policy: declared annotations can act as abstraction boundaries, mutable generic arguments often should not retain incidental literals, and stable public types may be more useful than value-sensitive local types.

Specificity is not the same as correctness. A type checker can produce a narrower but unsound type, so the report deliberately avoids treating every narrower result as a win. A switch decision should combine this report with:

- typing specification and runtime adjudication of concrete differences;
- comparison over representative production repositories;
- false-positive and false-negative diagnostic review;
- configuration, suppression, import resolution, and IDE feature parity;
- repeated warm performance and memory measurements.
