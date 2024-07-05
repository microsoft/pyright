# This sample tests a piece of code that involves lots
# of cyclical dependencies for type resolution.


def needs_str(a: str) -> tuple[str, str]: ...


def xxx():
    v1 = ""
    v2 = ""
    v3 = ""

    v4 = None

    _ = v1
    v3, _ = v3, v2
    v4 = v3

    for _ in range(1):
        assert v4 is not None
        v1, v2 = needs_str(v4)
        v3 = v1
