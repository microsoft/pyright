from _typeshed import Incomplete

from braintree.graphql.types.payment_options import PaymentOptions

class CustomerRecommendations:
    payment_options: Incomplete
    def __init__(self, payment_options: list[PaymentOptions]) -> None: ...
