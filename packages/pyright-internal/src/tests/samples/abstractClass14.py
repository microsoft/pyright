# A custom metaclass __call__ can bypass the factory's __new__, so its
# return annotation must not suppress abstract-instantiation diagnostics.

from abc import ABCMeta, abstractmethod


class Product:
    pass


class Meta(ABCMeta):
    def __call__(cls) -> "Factory":
        return object.__new__(Factory)


class Factory(metaclass=Meta):
    def __new__(cls) -> Product:
        return Product()

    @abstractmethod
    def absent(self) -> None: ...


# This should generate an error because Meta.__call__ allocates Factory.
Factory()


class InheritedMeta(Meta):
    pass


class InheritedFactory(Factory, metaclass=InheritedMeta):
    pass


# This should generate an error for an inherited __call__ as well.
InheritedFactory()


class DefaultMeta(ABCMeta):
    pass


class DefaultFactory(metaclass=DefaultMeta):
    def __new__(cls) -> Product:
        return Product()

    @abstractmethod
    def absent(self) -> None: ...


# Inheriting type.__call__ still permits the concrete factory pattern.
DefaultFactory()
