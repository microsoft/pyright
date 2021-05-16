from _typeshed import AnyPath
from typing import NamedTuple, Optional, Union

class SndHeaders(NamedTuple):
    filetype: str
    framerate: int
    nchannels: int
    nframes: int
    sampwidth: Union[int, str]

def what(filename: AnyPath) -> Optional[SndHeaders]: ...
def whathdr(filename: AnyPath) -> Optional[SndHeaders]: ...
