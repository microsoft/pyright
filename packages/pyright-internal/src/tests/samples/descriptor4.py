# This sample tests type narrowing when a descriptor is accessed
# through a subclass. The type of the instance should not be narrowed
# to Never after an assertion involving the descriptor value.

import typing

T = typing.TypeVar("T", bound=typing.Any)


class SQLCoreOperations(typing.Generic[T]):
    pass


class ORMDescriptor(typing.Generic[T]):
    @typing.overload
    def __get__(
        self, instance: typing.Any, owner: typing.Literal[None]
    ) -> "ORMDescriptor[T]": ...

    @typing.overload
    def __get__(
        self, instance: typing.Literal[None], owner: typing.Any
    ) -> SQLCoreOperations[T]: ...

    @typing.overload
    def __get__(self, instance: object, owner: typing.Any) -> T: ...

    def __get__(
        self, instance: object, owner: typing.Any
    ) -> "typing.Union[ORMDescriptor[T], SQLCoreOperations[T], T]": ...


class MappedColumn(ORMDescriptor[T]):
    pass


class User:
    email: MappedColumn[str | None]


u = User()
reveal_type(u, expected_text="User")
reveal_type(u.email, expected_text="str | None")
assert u.email is None
reveal_type(u, expected_text="User")  # Should remain "User", not "Never"


# Test with direct descriptor type as well
class User2:
    email2: ORMDescriptor[str | None]


u2 = User2()
reveal_type(u2, expected_text="User2")
reveal_type(u2.email2, expected_text="str | None")
assert u2.email2 is None
reveal_type(u2, expected_text="User2")  # Should remain "User2", not "Never"


# Test negative case (is not None)
def func1(u3: User):
    if u3.email is not None:
        reveal_type(u3, expected_text="User")
        reveal_type(u3.email, expected_text="str")
    else:
        reveal_type(u3, expected_text="User")
        reveal_type(u3.email, expected_text="None")
