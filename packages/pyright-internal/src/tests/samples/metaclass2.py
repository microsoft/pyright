# This sample verifies that the type checker allows access
# to class variables provided by a metaclass.

from enum import Enum
from typing import Mapping


class Fruit(Enum):
    apple = 1
    orange = 2
    pear = 3


def requires_fruit_mapping(a: Mapping[str, Fruit]):
    pass


requires_fruit_mapping(Fruit.__members__)

aaa = len(Fruit)

for i in Fruit:
    print(i)


class Meta(type):
    inst_var1: int

    def __init__(self):
        self.inst_var1 = 1

    def method1(cls, some_param: str):
        pass


class MyClass1(metaclass=Meta):
    pass


MyClass1.method1("some argument")
reveal_type(MyClass1.inst_var1, expected_text="int")


class MyClass2(metaclass=Meta):
    # This should generate an error
    inst_var1 = ""


class MyClass3(metaclass=Meta):
    def __init__(self):
        # This should generate an error
        self.inst_var1 = ""
