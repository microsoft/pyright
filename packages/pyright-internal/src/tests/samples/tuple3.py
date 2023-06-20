# This sample tests the assignment of heterogeneous tuples
# to homogeneous tuple types.


def func1(values: tuple[str, ...]):
    ...


# This should generate an error
func1(("", False))

# This should generate an error
func1((False, ""))
