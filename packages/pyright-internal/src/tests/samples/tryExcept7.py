# This sample tests the syntax handling for Python 3.11 exception groups
# as described in PEP 654.


def func1():

    try:
        pass

    # This should generate an error if using Python 3.10 or earlier.
    except* BaseException:
        pass

    # This should generate an error if using Python 3.10 or earlier.
    except*:
        pass
