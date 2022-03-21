import email.message
from email.policy import Policy
from typing import Union

__all__ = ["MIMEBase"]

_ParamsType = Union[str, None, tuple[str, str | None, str]]

class MIMEBase(email.message.Message):
    def __init__(self, _maintype: str, _subtype: str, *, policy: Policy | None = ..., **_params: _ParamsType) -> None: ...
