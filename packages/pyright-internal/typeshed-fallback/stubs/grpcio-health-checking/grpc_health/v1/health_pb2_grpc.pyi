from typing import Any, Final

import grpc
from grpc import aio
from grpc_health.v1 import health_pb2

GRPC_GENERATED_VERSION: Final[str]
GRPC_VERSION: Final[str]

class HealthStub:
    def __init__(self, channel: grpc.Channel | aio.Channel) -> None: ...

class HealthServicer:
    # Generated methods are overridden by both synchronous and asynchronous servicers.
    def Check(self, request: health_pb2.HealthCheckRequest, context: Any) -> Any: ...
    def Watch(self, request: health_pb2.HealthCheckRequest, context: Any) -> Any: ...

def add_HealthServicer_to_server(servicer: HealthServicer, server: grpc.Server | aio.Server) -> None: ...

class Health:
    @staticmethod
    def Check(
        request,
        target,
        options=(),
        channel_credentials=None,
        call_credentials=None,
        insecure=False,
        compression=None,
        wait_for_ready=None,
        timeout=None,
        metadata=None,
    ): ...
    @staticmethod
    def Watch(
        request,
        target,
        options=(),
        channel_credentials=None,
        call_credentials=None,
        insecure=False,
        compression=None,
        wait_for_ready=None,
        timeout=None,
        metadata=None,
    ): ...
