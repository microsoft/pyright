# This sample tests the type analyzer's reporting of issues
# with parameter default initializer expressions.

def foo(
        a = None,
        # This should generate an error
        b = dict(),
        # This should generate an error
        c = max(3, 4)):
    return 3
