# This sample verifies that the type checker properly handles
# lambdas with position-only and keyword-only markers.

from typing import Callable

foo1: Callable[[int], int] = lambda x, /: x + 1

# This should generate an error because there are too few
# parameters provided by the lambda.
foo2: Callable[[int, int], int] = lambda x, /: x + 1

# This should generate an error because there are too many
# parameters provided by the lambda.
foo3: Callable[[int, int], int] = lambda x, /, y, z: x + 1

# This should generate an error because there is no named
# parameter y.
foo4: Callable[[int, int], int] = lambda x, *, y: x + y + 1

# This should generate an error because there are too few
# parameters provided by the lambda.
foo5: Callable[[int, int, int], int] = lambda x, *, y: x + y + 1

# This should generate an error because there are too many
# parameters provided by the lambda.
foo6: Callable[[int], int] = lambda x, *, y: x + y + 1

foo7: Callable[[int, str], int] = lambda *args: 1

# This should generate an error because there are too many
# parameters provided by the lambda.
foo8: Callable[[int, str], int] = lambda a, b, c, *args: 1
