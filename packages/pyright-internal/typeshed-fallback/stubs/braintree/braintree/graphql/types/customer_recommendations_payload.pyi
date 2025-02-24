from _typeshed import Incomplete

from braintree.graphql.unions.customer_recommendations import CustomerRecommendations

class CustomerRecommendationsPayload:
    is_in_paypal_network: Incomplete
    recommendations: Incomplete
    def __init__(self, is_in_paypal_network: bool, recommendations: CustomerRecommendations) -> None: ...
