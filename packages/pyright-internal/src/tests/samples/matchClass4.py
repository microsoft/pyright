# This sample tests the case where a subject is narrowed against a
# class pattern that includes a type() or subclass thereof and
# the subject contains a type[T].


class MyMeta(type):
    pass


class A:
    pass


class B(A, metaclass=MyMeta):
    pass


def func1(subj: type[A]):
    match subj:
        case type():
            reveal_type(subj, expected_text="type[A]")
        case _:
            reveal_type(subj, expected_text="Never")


def func2(subj: type[A]):
    match subj:
        case MyMeta():
            reveal_type(subj, expected_text="type[A]")
        case _:
            reveal_type(subj, expected_text="type[A]")


def func3(subj: type[B]):
    match subj:
        case MyMeta():
            reveal_type(subj, expected_text="type[B]")
        case _:
            reveal_type(subj, expected_text="Never")


def func4(subj: type[B] | type[int]):
    match subj:
        case MyMeta():
            reveal_type(subj, expected_text="type[B] | type[int]")
        case _:
            reveal_type(subj, expected_text="type[int]")
