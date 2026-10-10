# This sample tests conditional narrowing after asymmetric descriptor assignments.

from typing import assert_type


class Getter:
    def __get__(self, instance: object, owner: object = None) -> int | None:
        return None


class InheritedDescriptor(Getter):
    def __set__(self, instance: object, value: int | str | None) -> None:
        pass


class DirectDescriptor:
    def __get__(self, instance: object, owner: object = None) -> int | None:
        return None

    def __set__(self, instance: object, value: int | str | None) -> None:
        pass


class InheritedContainer:
    value = InheritedDescriptor()


class DirectContainer:
    value = DirectDescriptor()


class PropertyContainer:
    @property
    def value(self) -> int | None:
        return None

    @value.setter
    def value(self, new_value: int | str | None) -> None:
        pass


def inherited_guard(container: InheritedContainer, value: int | None) -> int:
    container.value = value
    assert_type(container.value, int | None)
    if container.value is not None:
        assert_type(container.value, int)
        return container.value + 1
    else:
        assert_type(container.value, None)
        return 0


def direct_guard(container: DirectContainer, value: int | None) -> int:
    container.value = value
    assert_type(container.value, int | None)
    if container.value is not None:
        assert_type(container.value, int)
        return container.value + 1
    else:
        assert_type(container.value, None)
        return 0


def property_guard(container: PropertyContainer, value: int | None) -> int:
    container.value = value
    assert_type(container.value, int | None)
    if container.value is not None:
        assert_type(container.value, int)
        return container.value + 1
    else:
        assert_type(container.value, None)
        return 0


def reset_guard(container: InheritedContainer) -> None:
    if container.value is not None:
        assert_type(container.value, int)
        container.value = "reset"
        assert_type(container.value, int | None)

        # This should generate an error because the write invalidates the earlier guard.
        _ = container.value + 1

        if container.value is not None:
            assert_type(container.value, int)
            _ = container.value + 1


def branch_guard(container: InheritedContainer, condition: bool) -> None:
    if condition:
        container.value = "parsed"
    else:
        container.value = 1

    assert_type(container.value, int | None)
    if container.value is not None:
        assert_type(container.value, int)


def loop_guard(container: InheritedContainer) -> None:
    while container.value is not None:
        assert_type(container.value, int)
        container.value = "next"
        assert_type(container.value, int | None)
        if container.value is not None:
            assert_type(container.value, int)


class GenericGetter[T]:
    def __get__(self, instance: object, owner: object = None) -> T | None:
        return None


class GenericDescriptor[T](GenericGetter[T]):
    def __set__(self, instance: object, value: T | str | None) -> None:
        pass


class GenericContainer[T]:
    value: GenericDescriptor[T] = GenericDescriptor()


def generic_guard[T](container: GenericContainer[T]) -> T | None:
    container.value = "parsed"
    assert_type(container.value, T | None)
    if container.value is not None:
        assert_type(container.value, T)
        return container.value
    return None


def invalid_write(container: InheritedContainer) -> None:
    # This should generate an error because the setter does not accept bytes.
    container.value = b"invalid"
