# This sample tests the case where a metaclass defines a customer
# __call__ method, thus overriding the __new__ method on classes
# that are created from it.


class FactoryMetaClass1(type):
    def __call__(cls, **kwargs):
        return cls()


class BaseFactory1:
    def __new__(cls, *args, **kwargs):
        raise RuntimeError("You cannot instantiate BaseFactory")


class Factory1(BaseFactory1, metaclass=FactoryMetaClass1):
    ...


v1 = Factory1()
reveal_type(v1, expected_text="Factory1")


class FactoryMetaClass2(type):
    ...


class BaseFactory2:
    def __new__(cls, *args, **kwargs):
        raise RuntimeError("You cannot instantiate BaseFactory")


class Factory2(BaseFactory2, metaclass=FactoryMetaClass2):
    ...


v2 = Factory2()
reveal_type(v2, expected_text="NoReturn")
