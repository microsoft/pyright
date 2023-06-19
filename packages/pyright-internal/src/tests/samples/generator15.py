# This sample tests that the parser emits an error when a generator
# is used as an argument without parentheses.


from typing import Any


def func1(*x: Any) -> None:
    pass

func1(x for x in [0, 1])

func1((x for x in [0, 1]), 1)

func1((x for x in [0, 1]),)

func1(1, (x for x in [0, 1]))

# This should generate an error.
func1(x for x in [0, 1], 1)

# This should generate an error.
func1(x for x in [0, 1],)

# This should generate an error.
func1(1, x for x in [0, 1])
