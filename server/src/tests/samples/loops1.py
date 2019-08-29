# This sample tests the type checker's ability to handle type
# inferrences within loop constructs.

def bar(a: list):
    pass

def func1():
    data = None

    for x in [2, 3]:
        if not data:
            data = [1, 2]
        else:
            # This should not generate an error because the
            # type checker should be able to determine that
            # data must be a list at this point in the code.
            bar(data)
    else:
        # This should generate an error because the
        # type checker should be able to determine that
        # data must contain None at this point.
        bar(data)


x = 20 + 20

def func2():
    data = None

    while x:
        if not data:
            data = [1, 2]
        else:
            # This should not generate an error because the
            # type checker should be able to determine that
            # data must be a list at this point in the code.
            bar(data)
    else:
        # This should generate an error because the
        # type checker should be able to determine that
        # data must contain None at this point.
        bar(data)
  