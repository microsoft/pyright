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

# This should generate a diagnostic.
t

# This should generate a diagnostic.
(1, 2, 3)

# This should generate a diagnostic.
{1: 2}

# This should generate a diagnostic.
{1, 2, 3}

# This should generate a diagnostic.
[1, 2, 3]

[x for x in range(3)]
{x: x for x in range(3)}
{x for x in range(3)}
