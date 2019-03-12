from typing import Dict, Union
from urllib.response import addinfourl

# Stubs for urllib.error

class URLError(IOError):
    reason = ...  # type: Union[str, BaseException]
class HTTPError(URLError, addinfourl):
    code = ...  # type: int
    headers = ...  # type: Dict[str, str]
    def __init__(self, url, code, msg, hdrs, fp) -> None: ...
class ContentTooShortError(URLError): ...
