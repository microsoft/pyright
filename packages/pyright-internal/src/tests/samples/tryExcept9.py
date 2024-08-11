# This sample tests the case where a finally clause contains some conditional
# logic that narrows the type of an expression. This narrowed type should
# persist after the finally clause.


def func1():
    file = None
    try:
        file = open("test.txt")
    except Exception:
        return None
    finally:
        if file:
            file.close()

    # This should evaluate to "TextIOWrapper", but the current
    # logic is not able to evaluate different types for file
    # based on whether it's an exception or non-exception case.
    reveal_type(file, expected_text="TextIOWrapper[_WrappedBuffer] | None")


def func2():
    file = None
    try:
        file = open("test.txt")
    except Exception:
        pass
    finally:
        if file:
            file.close()

    reveal_type(file, expected_text="TextIOWrapper[_WrappedBuffer] | None")


def func3():
    file = None
    try:
        file = open("test.txt")
    finally:
        pass

    reveal_type(file, expected_text="TextIOWrapper[_WrappedBuffer]")
