# This sample tests for the proper detection of
# an unbound variable within a finally statement
# in cases where a "bare" exception clause is used
# and not used.


def func1():
    try:
        _ = "text".index("a")
    except:
        var = 1
    else:
        var = 2
    finally:
        print(var)


def func2():
    try:
        _ = "text".index("a")
    except NameError:
        var = 1
    else:
        var = 2
    finally:
        # This should generate a "possibly unbound" error.
        print(var)
