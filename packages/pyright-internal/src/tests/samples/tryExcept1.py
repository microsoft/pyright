# This sample tests the name binder's handling of
# try/except/raise statements

from typing import Literal


def func1():

    try:
        pass
    except:
        raise

    raise


def func2(x, y) -> bool:
    try:
        z = x / y
    except Exception as e:
        t1: Literal["Exception"] = reveal_type(e)
        return False
    except (RuntimeError, NameError) as e:
        t2: Literal["RuntimeError | NameError"] = reveal_type(e)
        return False
    except:
        raise Exception()
    else:
        return True

    # This should not generate an error
    # because this code is unreachable.
    return "hello"


def func3():
    # This should generate an error because there is no
    # except or finally clause.
    try:
        pass
    