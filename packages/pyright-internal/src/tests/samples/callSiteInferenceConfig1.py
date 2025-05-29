# This sample tests the enableCallSiteReturnTypeInference config option
# when it is set to false.

def func(a, b):
    """Function with unannotated parameters."""
    if isinstance(a, int) and isinstance(b, int):
        return a + b
    return str(a) + str(b)

# With enableCallSiteReturnTypeInference = false,
# the return type should be Unknown regardless of argument types
result1 = func(1, 2)
reveal_type(result1, expected_text="Unknown")

result2 = func("hello", "world")
reveal_type(result2, expected_text="Unknown")