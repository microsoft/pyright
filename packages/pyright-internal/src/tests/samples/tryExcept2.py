# This sample tests basic handling of nested finally clauses.


def func1(i: int) -> None:
    pass


def func2():
    aaa = 3
    try:
        try:
            return
        finally:
            pass
    finally:
        func1(aaa)
