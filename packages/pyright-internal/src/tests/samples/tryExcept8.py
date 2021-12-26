# This sample tests the detection of inaccessible exception handlers.


def func1() -> None:
    pass


def func2():
    try:
        func1()
    except OSError:
        pass
    except Exception:
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
