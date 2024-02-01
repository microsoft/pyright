# This sample tests the handling of unpack operators
# used in argument expressions when used in conjunction with
# tuples and *args parameters.


def func1(a: int, b: int):
    pass


def func2(*args: int):
    pass


fixed_tuple_0 = ()
func1(*fixed_tuple_0, 2, 3)
func2(*fixed_tuple_0, 2)

fixed_tuple_1 = (1,)

# This should generate an error because there
# are too many parameters.
func1(*fixed_tuple_1, 2, 3)

func2(*fixed_tuple_1, 2, *fixed_tuple_0)

fixed_tuple_3 = (1, 3, 5)

# This should generate an error because there
# are too many parameters.
func1(*fixed_tuple_3, 2)

func2(*fixed_tuple_3, 2, *fixed_tuple_0)

unbounded_tuple: tuple[int, ...] = (1, 5, 3)

func2(*unbounded_tuple)
func2(*unbounded_tuple, 2)


def func3(*args: str): ...


def func4(v1: list[str] | None, v2: None, v3: list[str]):
    # This should generate an error.
    func3(*v1)

    # This should generate an error.
    func3(*v2)

    func3(*v3)
