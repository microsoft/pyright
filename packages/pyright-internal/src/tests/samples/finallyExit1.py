# This sample tests that pyright's parser correctly identifies
# illegal exits from a finally block as specified in PEP 765.


def func1():
    try:
        return
    finally:
        # This should generate an error if using Python 3.14 or later.
        return


def func2():
    try:
        return
    finally:

        def inner():
            return


def func3():
    while True:
        try:
            return
        finally:
            if 1 < 1:
                # This should generate an error if using Python 3.14 or later.
                break

            if 1 > 2:
                # This should generate an error if using Python 3.14 or later.
                continue

    for x in (1, 2):
        try:
            return
        finally:
            if 1 < 1:
                # This should generate an error if using Python 3.14 or later.
                break

            if 1 > 2:
                # This should generate an error if using Python 3.14 or later.
                continue


def func4():
    try:
        return
    finally:
        while 1 < 2:
            if 1 < 1:
                break

            if 1 > 2:
                continue


def func5():
    try:
        return
    finally:
        for x in (1, 2):
            if 1 < 1:
                break

            if 1 > 2:
                continue
