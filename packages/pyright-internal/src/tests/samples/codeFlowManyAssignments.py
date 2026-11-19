from typing import Literal, Never, assert_type


def stop() -> Never:
    raise RuntimeError


def check(value: int) -> None:
    current: int | str = value
    deleted = value
    del deleted
    (
        a00, a01, a02, a03, a04, a05, a06, a07,
        a08, a09, a10, a11, a12, a13, a14, a15,
        a16, a17, a18, a19, a20, a21, a22, a23,
        a24, a25, a26, a27, a28, a29, a30, a31,
        a32, a33,
    ) = (1,) * 34
    current = "latest"
    (
        b00, b01, b02, b03, b04, b05, b06, b07,
        b08, b09, b10, b11, b12, b13, b14, b15,
        b16, b17, b18, b19, b20, b21, b22, b23,
        b24, b25, b26, b27, b28, b29, b30, b31,
        b32, b33,
    ) = (2,) * 34

    assert_type(current, Literal["latest"])
    assert_type(a00, Literal[1])
    assert_type(b33, Literal[2])

    # This should generate an error.
    print(deleted)


def check_call_boundary(value: str | None) -> str:
    if value is None:
        stop()
        (
            a00, a01, a02, a03, a04, a05, a06, a07,
            a08, a09, a10, a11, a12, a13, a14, a15,
            a16, a17, a18, a19, a20, a21, a22, a23,
            a24, a25, a26, a27, a28, a29, a30, a31,
            a32, a33,
        ) = (1,) * 34

    return value
