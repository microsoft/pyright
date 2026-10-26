# This sample tests the inferred return type of a function that
# accesses an attribute through a descriptor or a __getattr__ or
# __setattr__ method whose type depends on a call to that function.

from typing import Any


def func1():
    b = ClassB()
    b.x = "a"
    return b.x


def func2():
    return ClassD().x


def func3():
    f = ClassF()
    f.x = "a"
    return f.x


def func4():
    g = ClassG()
    g.y = "a"
    return g.y


def func5():
    h = ClassH()
    h.y = "a"
    return h.y


def set1(self: Any, obj: Any, value: str) -> None:
    pass


def get1(self: Any, obj: Any, objtype: Any = None) -> int:
    return 1


def getattr1(self: Any, name: str) -> int:
    return 1


def setattr1(self: Any, name: str, value: str) -> None:
    pass


def make1(flag: bool):
    return set1 if flag or func1() else set1


def make2(flag: bool):
    return get1 if flag or func2() else get1


def make3(flag: bool):
    return get1 if flag or func3() else get1


def make4(flag: bool):
    return getattr1 if flag or func4() else getattr1


def make5(flag: bool):
    return setattr1 if flag or func5() else setattr1


class ClassA:
    def __get__(self, obj: Any, objtype: Any = None) -> int:
        return 1

    __set__ = make1(True)


class ClassB:
    x = ClassA()


class ClassC:
    __get__ = make2(True)


class ClassD:
    x = ClassC()


class ClassE:
    __get__ = make3(True)

    def __set__(self, obj: Any, value: str) -> None:
        pass


class ClassF:
    x = ClassE()


class ClassG:
    __getattr__ = make4(True)

    def __setattr__(self, name: str, value: str) -> None:
        pass


class ClassH:
    def __getattr__(self, name: str) -> int:
        return 1

    __setattr__ = make5(True)


reveal_type(func1, expected_text="() -> int")
reveal_type(func2, expected_text="() -> int")
reveal_type(func3, expected_text="() -> int")
reveal_type(func4, expected_text="() -> int")
reveal_type(func5, expected_text="() -> int")
