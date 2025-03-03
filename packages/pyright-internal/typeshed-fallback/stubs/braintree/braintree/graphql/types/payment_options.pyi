from _typeshed import Incomplete

from braintree.graphql.enums import RecommendedPaymentOption

class PaymentOptions:
    payment_option: Incomplete
    recommended_priority: Incomplete
    def __init__(self, payment_option: RecommendedPaymentOption, recommended_priority: int) -> None: ...
