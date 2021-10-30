# This sample tests the handling of an unpacked TypedDict passed as
# an argument to a function.

from typing import TypedDict


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


func3(**td1)

func3(**td2)

func4(**td1)

# This should generate an error because "arg3" cannot be matched
# due to the type of the **kwargs parameter.
func4(**td2)
