# This sample tests basic handling of nested finally clauses.


def deallocate(i: int) -> None:
    pass

def test():
    aaa = 3
    try:
        try:
            return
        finally:
            pass
    finally:
        deallocate(aaa)
