# This sample tests that type errors within a finally clause are
# property detected.


def func1() -> None:
    file = None
    try:
        raise ValueError()
    except Exception:
        return None
    finally:
        # This should generate an error.
        file.name
