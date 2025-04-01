# This sample tests the case where a TypeVarTuple is used in a class
# and a `Self` type is involved.


class Parent[*Ts]:
    def __init__(self, *args: *Ts): ...

    def method(self):
        Child(self)


class Child(Parent[*tuple[Parent, ...]]): ...
