from email.mime.nonmultipart import MIMENonMultipart
from email.policy import Policy
from typing import Callable, Union

__all__ = ["MIMEAudio"]

_ParamsType = Union[str, None, tuple[str, str | None, str]]

class MIMEAudio(MIMENonMultipart):
    def __init__(
        self,
        _audiodata: str | bytes,
        _subtype: str | None = ...,
        _encoder: Callable[[MIMEAudio], None] = ...,
        *,
        policy: Policy | None = ...,
        **_params: _ParamsType,
    ) -> None: ...
