# Generic redeclarations must still reject incompatible signatures and scopes.


def incompatible(condition: bool) -> None:
    if condition:
        # This should generate an error because the return type differs.
        def result[T](value: T) -> list[T]:
            return [value]

        # This should generate an error because the TypeVar bound differs.
        def bounded[T: int](value: T) -> T:
            return value

        # This should generate an error because the TypeVar constraints differ.
        def constrained[T: (int, str)](value: T) -> T:
            return value

        # This should generate an error because the parameter names differ.
        def named[T](value: T) -> T:
            return value

        # This should generate an error because the type parameter default differs.
        def defaulted[T = int](value: T | None = None) -> T | None:
            return value
    else:
        def result[T](value: T) -> set[T]:
            return {value}

        def bounded[T: str](value: T) -> T:
            return value

        def constrained[T: (int, bytes)](value: T) -> T:
            return value

        def named[T](other: T) -> T:
            return other

        def defaulted[U = str](value: U | None = None) -> U | None:
            return value


def parameter_optionality(condition: bool) -> None:
    if condition:
        def required_first[T](value: T, required: int) -> T:
            return value

        def optional_first[T](value: T, optional: int = 0) -> T:
            return value
    else:
        def required_first[U](value: U, required: int = 0) -> U:
            return value

        def optional_first[U](value: U, optional: int) -> U:
            return value


def outer[T](condition: bool) -> None:
    if condition:
        # This should generate an error because T belongs to the outer function.
        def captured(value: T) -> T:
            return value
    else:
        # This should also generate an error because T shadows the outer type parameter.
        def captured[T](value: T) -> T:
            return value


# This should generate an error because the functions share a statement suite.
def repeated[T](value: T) -> T:
    return value


def repeated[T](value: T) -> T:
    return value
