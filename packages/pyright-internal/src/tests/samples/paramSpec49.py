# This sample tests the case where a function parameterized with a
# ParamSpec P is called with *args: P.args and **kwargs: P.kwargs.

from typing import Any, Generic, ParamSpec

P = ParamSpec("P")


class TaskDeclaration(Generic[P]):
    pass


class Dispatcher:
    def dispatch(
        self,
        task_declaration: TaskDeclaration[P],
        count: int,
        /,
        *args: P.args,
        **kwargs: P.kwargs,
    ) -> None:
        pass


class Queue:
    dispatcher: Dispatcher

    def method1(self, stub: TaskDeclaration[P]) -> Any:
        def inner0(*args: P.args, **kwargs: P.kwargs) -> None:
            self.dispatcher.dispatch(stub, 1, *args, **kwargs)

        def inner1(*args: P.args, **kwargs: P.kwargs) -> None:
            # This should generate an error because a positional argument
            # cannot appear after an unpacked keyword argument.
            self.dispatcher.dispatch(stub, 1, **kwargs, *args)

        def inner2(*args: P.args, **kwargs: P.kwargs) -> None:
            # This should generate an error because it's missing
            # a positional argument for 'count'.
            self.dispatcher.dispatch(stub, *args, **kwargs)

        def inner3(*args: P.args, **kwargs: P.kwargs) -> None:
            # This should generate an error because it has an
            # additional positional argument.
            self.dispatcher.dispatch(stub, 1, 1, *args, **kwargs)

        def inner4(*args: P.args, **kwargs: P.kwargs) -> None:
            # This should generate an error because it is missing
            # the *args argument.
            self.dispatcher.dispatch(stub, 1, **kwargs)

        def inner5(*args: P.args, **kwargs: P.kwargs) -> None:
            # This should generate an error because it is missing
            # the *kwargs argument.
            self.dispatcher.dispatch(stub, 1, *args)

        def inner6(*args: P.args, **kwargs: P.kwargs) -> None:
            # This should generate an error because it has an
            # extra *args argument.
            self.dispatcher.dispatch(stub, 1, *args, *args, **kwargs)

            # This should generate an error because it has an
            # extra **kwargs argument.
            self.dispatcher.dispatch(stub, 1, *args, **kwargs, **kwargs)
