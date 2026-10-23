from grpc.aio import ServicerContext
from grpc_health.v1 import health_pb2, health_pb2_grpc

class HealthServicer(health_pb2_grpc.HealthServicer):
    def __init__(self) -> None: ...
    async def Check(
        self,
        request: health_pb2.HealthCheckRequest,
        context: ServicerContext[health_pb2.HealthCheckRequest, health_pb2.HealthCheckResponse],
    ) -> health_pb2.HealthCheckResponse: ...
    async def Watch(
        self,
        request: health_pb2.HealthCheckRequest,
        context: ServicerContext[health_pb2.HealthCheckRequest, health_pb2.HealthCheckResponse],
    ) -> None: ...
    async def set(self, service: str, status: int) -> None: ...
    async def enter_graceful_shutdown(self) -> None: ...
