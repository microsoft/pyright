from email.message import EmailMessage
from email.policy import EmailPolicy


class CustomMessage(EmailMessage):
    pass


def check() -> None:
    reveal_type(EmailPolicy(), expected_text="EmailPolicy[EmailMessage[Any, Any]]")
    reveal_type(
        EmailPolicy(max_line_length=None, utf8=True, refold_source="long"),
        expected_text="EmailPolicy[EmailMessage[Any, Any]]",
    )
    reveal_type(
        EmailPolicy(message_factory=CustomMessage),
        expected_text="EmailPolicy[CustomMessage]",
    )
    reveal_type(
        EmailPolicy[CustomMessage](message_factory=CustomMessage),
        expected_text="EmailPolicy[CustomMessage]",
    )
