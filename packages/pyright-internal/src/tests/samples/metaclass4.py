# This sample covers the case where a metaclass (a class that derives
# from "type") is directly instantiated to create a new class,
# and that class is then used as a base class for another class.


class MyMeta(type):
    def do_something(self, p1: str, p2: int):
        pass


MyCustomClass = MyMeta("MyCustomClass", (object,), {})

reveal_type(MyCustomClass, expected_text="type[MyCustomClass]")


class DerivedCustomClass(MyCustomClass):
    pass


DerivedCustomClass.do_something("hi", 3)

# This should generate an error because the second
# argument is the wrong type.
DerivedCustomClass.do_something("hi", "no")

instance = DerivedCustomClass()
