# Contributing

This project welcomes contributions and suggestions. Most contributions require you to agree to a Contributor License Agreement (CLA) declaring that you have the right to, and actually do, grant us the rights to use your contribution. For details, visit https://cla.microsoft.com.

If you are considering adding a new feature, it is recommended that you start by submitting an enhancement request so project maintainers can discuss, determine whether such an enhancement would be accepted, and provide input on the best way to implement the enhancement.

When you submit a pull request, a CLA-bot will automatically determine whether you need to provide a CLA and decorate the PR appropriately (e.g., label, comment). Simply follow the instructions provided by the bot. You will only need to do this once across all repositories using our CLA.

This project has adopted the [Microsoft Open Source Code of Conduct](https://opensource.microsoft.com/codeofconduct/). For more information see the [Code of Conduct FAQ](https://opensource.microsoft.com/codeofconduct/faq/) or contact [opencode@microsoft.com](mailto:opencode@microsoft.com) with any additional questions or comments.

## Measuring performance changes

To check whether a change affects type-checking performance, use `build/perfCompare.py`. It builds the production CLI bundle at each of two or more commits and times repeated runs over a fixed corpus, reporting robust paired deltas. Example:

```
python build/perfCompare.py --metric cpu --num-runs 50 --corpus <path-to-python-project> main HEAD
```

See the script's `--help` and module docstring for options and methodology.
