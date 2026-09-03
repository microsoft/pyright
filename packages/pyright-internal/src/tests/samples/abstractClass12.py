from abc import ABC, abstractmethod
from typing import Callable, Generic, Protocol, TypeVar, cast


T = TypeVar("T")


class Decorator(Generic[T]):
    def decorate(self, cls: type[T]) -> type[T]:
        return cls


class MethodGenericDecorator:
    def decorate(self, cls: type[T]) -> type[T]:
        return cls


class ProtocolBase(Protocol):
    value: str

    @abstractmethod
    def method(self) -> None: ...


protocol_decorator: Decorator[ProtocolBase] = Decorator()
method_generic_decorator = MethodGenericDecorator()


@protocol_decorator.decorate
class AbstractProtocolImpl(ProtocolBase):
    pass


# This should generate an error because the decorated class is abstract.
AbstractProtocolImpl()
reveal_type(AbstractProtocolImpl, expected_text="type[ProtocolBase]")


@method_generic_decorator.decorate
class AbstractMethodGenericProtocolImpl(ProtocolBase):
    pass


# This should generate an error because the decorated class is abstract.
AbstractMethodGenericProtocolImpl()
reveal_type(AbstractMethodGenericProtocolImpl, expected_text="type[AbstractMethodGenericProtocolImpl]")


@protocol_decorator.decorate
class ConcreteProtocolImpl(ProtocolBase):
    value = ""

    def method(self) -> None:
        pass


ConcreteProtocolImpl()
reveal_type(ConcreteProtocolImpl, expected_text="type[ProtocolBase]")


class ABCBase(ABC):
    @abstractmethod
    def method(self) -> None: ...


abc_decorator: Decorator[ABCBase] = Decorator()


@abc_decorator.decorate
class AbstractABCImpl(ABCBase):
    pass


# This should generate an error because the decorated class is abstract.
AbstractABCImpl()
reveal_type(AbstractABCImpl, expected_text="type[ABCBase]")


@abc_decorator.decorate
class ConcreteABCImpl(ABCBase):
    def method(self) -> None:
        pass


ConcreteABCImpl()
reveal_type(ConcreteABCImpl, expected_text="type[ABCBase]")


@method_generic_decorator.decorate
class AbstractMethodGenericABCImpl(ABCBase):
    pass


# This should generate an error because the decorated class is abstract.
AbstractMethodGenericABCImpl()
reveal_type(AbstractMethodGenericABCImpl, expected_text="type[AbstractMethodGenericABCImpl]")


class Replacement:
    pass


def replace(cls: type[object]) -> type[Replacement]:
    return Replacement


@replace
class ReplacedAbstractClass(ABC):
    @abstractmethod
    def method(self) -> None: ...


# The decorator intentionally returns a different, concrete class.
ReplacedAbstractClass()
reveal_type(ReplacedAbstractClass, expected_text="type[Replacement]")


class ConcreteSibling(ABCBase):
    def method(self) -> None:
        pass


def replace_with_sibling(cls: type[ABCBase]) -> type[ABCBase]:
    return ConcreteSibling


@replace_with_sibling
class SiblingReplacedAbstractClass(ABCBase):
    pass


# A non-generic decorator can intentionally return another subclass.
SiblingReplacedAbstractClass()
reveal_type(SiblingReplacedAbstractClass, expected_text="type[ABCBase]")


class Materializer(Generic[T]):
    def decorate(self, cls: type[T]) -> type[T]:
        return cast(type[T], ConcreteSibling)


materializer: Materializer[ABCBase] = Materializer()


@materializer.decorate
class MaterializedAbstractClass(ABCBase):
    pass


# A generic decorator with an identity-shaped annotation can return another class.
MaterializedAbstractClass()
reveal_type(MaterializedAbstractClass, expected_text="type[ABCBase]")


class ReassigningMaterializer(Generic[T]):
    def decorate(self, cls: type[T]) -> type[T]:
        cls = cast(type[T], ConcreteSibling)
        return cls


reassigning_materializer: ReassigningMaterializer[ABCBase] = ReassigningMaterializer()


@reassigning_materializer.decorate
class ReassignedAbstractClass(ABCBase):
    pass


# Returning a reassigned parameter doesn't preserve the decorated class.
ReassignedAbstractClass()
reveal_type(ReassignedAbstractClass, expected_text="type[ABCBase]")


@abc_decorator.decorate
@replace_with_sibling
class StackedReplacedAbstractClass(ABCBase):
    pass


# An identity decorator above a replacement decorator doesn't restore identity.
StackedReplacedAbstractClass()
reveal_type(StackedReplacedAbstractClass, expected_text="type[ABCBase]")


candidate: type[ABCBase] = ConcreteSibling
(AbstractABCImpl if bool() else candidate)()


def test_rebound_class_name() -> None:
    @abc_decorator.decorate
    class ReboundAbstractClass(ABCBase):
        pass

    ReboundAbstractClass = candidate
    ReboundAbstractClass()


def test_future_rebound_class_name() -> None:
    @abc_decorator.decorate
    class FutureReboundAbstractClass(ABCBase):
        pass

    # This should generate an error because the later assignment isn't active yet.
    FutureReboundAbstractClass()
    FutureReboundAbstractClass = candidate


F = TypeVar("F", bound=Callable[..., object])


def replace_function(func: F) -> F:
    return cast(F, materializer.decorate)


class FunctionDecoratedDecorator(Generic[T]):
    @replace_function
    def decorate(self, cls: type[T]) -> type[T]:
        return cls


function_decorated_decorator: FunctionDecoratedDecorator[ABCBase] = FunctionDecoratedDecorator()


@function_decorated_decorator.decorate
class FunctionDecoratedAbstractClass(ABCBase):
    pass


# The function decorator replaces the apparent identity decorator.
FunctionDecoratedAbstractClass()
reveal_type(FunctionDecoratedAbstractClass, expected_text="type[ABCBase]")
