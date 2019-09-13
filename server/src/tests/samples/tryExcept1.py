# This sample tests the name binder's handling of
# try/except/raise statements


def func1():
    
    try:
        pass
    except:
        raise
    
    # This should generate an error because it's
    # a "naked" raise statement.
    raise


def foo(x, y) -> bool:
    try:
        z = x / y
    except Exception as e:
        return False
    except:
        raise Exception()
    else:
        return True

    # This should not generate an error
    # because this code is unreachable.
    return 'hello'


