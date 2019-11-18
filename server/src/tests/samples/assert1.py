# This sample tests the ability to detect errant assert calls
# that are always true - the "reportAssertAlwaysTrue" option.

# This should generate a warning
assert (1 != 2, "Error message")

