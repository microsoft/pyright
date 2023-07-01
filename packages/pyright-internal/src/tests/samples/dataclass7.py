# This sample tests the synthesized comparison operators for dataclasses.

from dataclasses import dataclass


@dataclass(order=True)
class DC1:
    a: str
    b: int


@dataclass(order=True)
class DC2:
    a: str
    b: int


dc1_1 = DC1("hi", 2)
dc1_2 = DC1("hi", 2)

if dc1_1 < dc1_2:
    print("")

if dc1_1 <= dc1_2:
    print("")

if dc1_1 > dc1_2:
    print("")

if dc1_1 >= dc1_2:
    print("")

if dc1_1 == dc1_2:
    print("")

if dc1_1 != dc1_2:
    print("")

if dc1_1 == None:
    print("")

if dc1_1 != None:
    print("")

dc2_1 = DC2("hi", 2)

# This should generate an error because the types are
# incompatible.
if dc1_1 < dc2_1:
    print("")

if dc1_1 != dc2_1:
    print("")
