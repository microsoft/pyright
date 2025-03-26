from _typeshed import Incomplete

from braintree.resource import Resource

class PayPalPaymentResource(Resource):
    def __init__(self, gateway, attributes) -> None: ...
    @staticmethod
    def update(request): ...
    @staticmethod
    def update_signature() -> list[Incomplete]: ...
