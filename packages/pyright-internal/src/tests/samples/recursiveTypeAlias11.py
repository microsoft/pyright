# This sample tests the case where a recursive type alias makes use of
# a bound or constrained TypeVar.


from typing import Any, Generic, TypeVar

""" Test bound TypeVar """


class ClassA1:
    pass


T1 = TypeVar("T1", bound=ClassA1)


class ClassA2(ClassA1, Generic[T1]):
    pass


class ClassA3(ClassA1):
    pass


TA1 = ClassA2["TA1"] | ClassA3


""" Test constrained TypeVar """


class ClassB1:
    pass


T2 = TypeVar("T2", "ClassB2[Any] | ClassB3", int)


class ClassB2(ClassB1, Generic[T2]):
    pass


class ClassB3(ClassB1):
    pass


TA2 = ClassB2["TA2"] | ClassB3
