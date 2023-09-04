# This sample tests the detection of inaccessible exception handlers.


from typing import Union


def func1() -> None:
    pass


def func2():
    try:
        func1()
    except OSError:
        pass
    except Exception:
        pass
    except ():
        pass
    # This should generate an error.
    except PermissionError:
        pass


def func3():
    try:
        func1()
    except OSError:
        pass
    # This should generate an error.
    except (PermissionError, ProcessLookupError):
        pass
    # This should generate an error.
    except (PermissionError, ConnectionAbortedError):
        pass


def func4():
    try:
        func1()
    except OSError:
        pass
    except (UnboundLocalError, ConnectionAbortedError):
        pass


def func5():
    try:
        func1()
    except OSError:
        pass
    except:
        pass


def func6(u: Union[type[Exception], tuple[type[Exception], ...]]):
    try:
        ...
    except ValueError as e:
        ...
    except u as e:
        ...


def func7(u: type[Exception]):
    try:
        ...
    except ValueError as e:
        ...
    except u as e:
        ...
