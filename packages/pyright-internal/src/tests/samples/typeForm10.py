# pyright: reportMissingModuleSource=false

from typing_extensions import TypeForm


class Meta(type):
    def __get__[T: Meta](
        cls: T,
        instance: object | None,
        owner: type | None = None,
    ) -> T:
        return cls


class Owner:
    class A(metaclass=Meta):
        pass

    class B(metaclass=Meta):
        pass


t1: TypeForm[Owner.A | Owner.B] = Owner.A
t2: TypeForm[Owner.A | Owner.B] = Owner.B
t3: TypeForm[Owner.A | Owner.B] = Owner.A | Owner.B
