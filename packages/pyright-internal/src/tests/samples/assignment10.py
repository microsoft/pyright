# This sample tests some cases where types are narrowed on assignment.


class A:
    instance: "A" | None

    def __init__(self) -> None:
        self.foo: bool

    @classmethod
    def method1(cls) -> bool:
        if cls.instance is None:
            cls.instance = cls()
        return cls.instance.foo
