# Ecosystem Benchmark Baselines

This directory is reserved for checked-in smoke benchmark baselines generated from `main` branch commits.

`ecosystem-smoke-main.json` should be updated only from a deliberate main-branch run. PR comparisons can use that file as the default baseline when no fresher CI artifact is supplied.

Full ecosystem reports and exploratory local runs should stay under `.generated/benchmark-results/` or CI artifacts rather than being checked in here.
