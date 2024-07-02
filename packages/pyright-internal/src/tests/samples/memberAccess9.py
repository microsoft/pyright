# This sample tests that the presence of a __getattr__ doesn't
# mean that an __init__ method is assumed.


class GetAttrTest:
    def __getattr__(self, name: str) -> int: ...


def test_get_attr() -> None:
    a = GetAttrTest()
