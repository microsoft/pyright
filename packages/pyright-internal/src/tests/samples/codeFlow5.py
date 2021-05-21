# This sample verifies that a builtin symbol that is used
# prior to being redefined in the same file isn't flagged
# as an error.

int_ = int
int = 3


max_ = max
max = lambda a, b: a if a > b else b
