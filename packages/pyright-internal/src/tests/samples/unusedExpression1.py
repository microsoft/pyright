# This sample tests the reportUnusedExpression diagnostic rule.

t = 1


# This should generate a diagnostic.
-4

# This should generate a diagnostic.
4j

# This should generate a diagnostic.
4j + 4

# This should generate a diagnostic.
False

# This should generate a diagnostic.
t == 1

# This should generate a diagnostic.
t != 2

# This should generate a diagnostic.
t <= t

# This should generate a diagnostic.
not t

# This should generate a diagnostic.
None
