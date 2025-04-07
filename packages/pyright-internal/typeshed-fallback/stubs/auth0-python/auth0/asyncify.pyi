from auth0.authentication import Users as Users
from auth0.authentication.base import AuthenticationBase as AuthenticationBase
from auth0.rest import RestClientOptions as RestClientOptions
from auth0.rest_async import AsyncRestClient as AsyncRestClient

def asyncify(cls): ...
