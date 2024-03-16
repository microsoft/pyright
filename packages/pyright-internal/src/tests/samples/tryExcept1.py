# This sample tests the name binder's handling of
# try/except/raise statements


from typing import TypeVar


def func1():
    try:
        pass
    except:
        raise

    raise


def func2(x, y) -> bool:
    try:
        z = x / y
    except (RuntimeError, NameError) as e:
        reveal_type(e, expected_text="RuntimeError | NameError")
        return False
    except Exception as e:
        reveal_type(e, expected_text="Exception")
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

class Exception1(BaseException): ...

base_exceptions = (RuntimeError, NameError)

class Exception2(*base_exceptions): ...

def func4():
    try:
        pass
    except Exception1:
        pass
    except Exception2:
        pass


def func5():
    try:
        return 1
    # This should generate an error.
    except int:
        pass
    # This should generate an error.
    except (NotImplementedError, str):
        pass
    # This should generate an error.
    except [Exception, ValueError]:
        pass
    except BaseException:
        pass


T = TypeVar("T", bound=BaseException)

def func6(*errors: type[T]):
    try:
        return 1
    except errors as e:
        return e
