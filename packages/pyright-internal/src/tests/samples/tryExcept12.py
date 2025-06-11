# This sample tests that multi-exception lists are parsed correctly
# based on PEP 758 in Python 3.14.

def func1():
    try:
        pass
    # This should generate an error for Python 3.13 or earlier.
    except ZeroDivisionError, TypeError:
        raise

def func2():
    try:
        pass
    # This should generate an error because an "as" clause always requires parens.
    except ZeroDivisionError, TypeError as e:
        raise
