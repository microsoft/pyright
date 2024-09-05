# This sample tests the handling of an unpacked TypedDict passed as
# an argument to a function.

from typing import TypedDict, Unpack


class TD1(TypedDict):
    arg1: int
    arg2: str


class TD2(TD1):
    arg3: float


def func1(arg1: int, arg2: str):
    pass


def func2(arg1: int, arg2: str, arg3: float):
    pass


def func3(arg1: int, arg2: str, **kwargs: float):
    pass


def func4(arg1: int, arg2: str, **kwargs: int):
    pass


def func5(arg1: int, arg2: str, **kwargs: object):
    pass


td1: TD1 = {"arg1": 10, "arg2": "something"}
td2: TD2 = {"arg1": 10, "arg2": "something", "arg3": 3.4}

func1(**td1)

# This should generate an error because "arg1" is already assigned
func1(arg1=3, **td1)

# This should generate an error because "arg3" isn't provided
func1(**td2)

# This should generate an error because "arg3" isn't matched
func2(**td1)

func2(**td2)


# This should generate an error because the extra entries
# in the TD are of type object.
func3(**td1)

# This should generate an error because the extra entries
# in the TD are of type object.
func3(**td2)

# This should generate an error because the extra entries
# in the TD are of type object.
func4(**td1)

func5(**td1)
func5(**td2)

# This should generate two errors because "arg3" cannot be matched
# due to the type of the **kwargs parameter. Also, the extra entries
# in the TD are of type object.
func4(**td2)


class Options(TypedDict, total=False):
    opt1: bool
    opt2: str


def func6(code: str | None = None, **options: Unpack[Options]):
    pass


func6(**{})
func6(**{"opt1": True})
func6(**{"opt2": "hi"})
