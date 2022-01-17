# This sample tests the case where a callable type contains a
# callable type as an input parameter, and the latter callable
# contains generic types.

from typing import Callable, Generic, Optional, Tuple, TypeVar

Msg = TypeVar("Msg")
Reply = TypeVar("Reply")


class AsyncReplyChannel(Generic[Reply]):
    ...


class MailboxProcessor(Generic[Msg]):
    def post_and_async_reply(
        self, build_message: Callable[[AsyncReplyChannel[Reply]], Msg]
    ) -> Optional[Reply]:
        return None


agent: MailboxProcessor[Tuple[int, AsyncReplyChannel[str]]] = MailboxProcessor()
build_message: Callable[
    [AsyncReplyChannel[str]], Tuple[int, AsyncReplyChannel[str]]
] = lambda r: (42, r)
ret = agent.post_and_async_reply(build_message)

reveal_type(ret, expected_text="str | None")
