from typing import Any

import email.message
import email.policy


def takes_default(policy: email.policy.EmailPolicy[email.message.EmailMessage[Any, Any]]) -> None:
    pass


class RFC822Policy(email.policy.EmailPolicy):
    utf8 = True
    mangle_from_ = False
    max_line_length = 0

    def header_store_parse(self, name: str, value: str) -> tuple[str, str]:
        return (name, value)


reveal_type(email.policy.EmailPolicy(), expected_text='EmailPolicy[EmailMessage[Any, Any]]')
reveal_type(RFC822Policy(), expected_text='RFC822Policy')

takes_default(email.policy.EmailPolicy())
takes_default(RFC822Policy())


class CustomMessage(email.message.EmailMessage):
    pass


class CustomPolicy(email.policy.EmailPolicy[CustomMessage]):
    pass


def takes_custom(policy: email.policy.EmailPolicy[CustomMessage]) -> None:
    pass


# This should generate an error because a custom message type requires a factory.
CustomPolicy()
custom_policy = CustomPolicy(message_factory=CustomMessage)
takes_custom(custom_policy)

reveal_type(custom_policy, expected_text='CustomPolicy')
reveal_type(
    email.policy.EmailPolicy[CustomMessage](message_factory=CustomMessage),
    expected_text='EmailPolicy[CustomMessage]',
)


class RFC822Message(email.message.EmailMessage):
    def __init__(self) -> None:
        super().__init__(policy=RFC822Policy())


message = RFC822Message()
