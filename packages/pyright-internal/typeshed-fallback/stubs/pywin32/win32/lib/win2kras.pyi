from typing import Any

def __getattr__(name: str) -> Any: ...  # incomplete

RASEAPF_Logon: int
RASEAPF_NonInteractive: int
RASEAPF_Preview: int

def GetEapUserIdentity(*args, **kwargs): ...  # incomplete
