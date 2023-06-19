# This sample tests that builtins can be overridden at the module level
# without generating a "possibly unbound" error.

if input():
    print = lambda *x: None

print("")
