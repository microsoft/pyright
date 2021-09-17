# This sample tests the type analyzer's reporting of issues
# with parameter default initializer expressions. This is
# covered by the reportCallInDefaultInitializer diagnostic rule.


def func1(
    a=None,
    # This should generate an error
    b=dict(),
    # This should generate an error
    c=max(3, 4),
):
    return 3


def func2(
    a=None,
    # This should generate an error
    b={},
    # This should generate an error
    c=[],
    # This should generate an error
    d={1, 2, 3},
    e=(1, 2, 3),
):
    return 3
