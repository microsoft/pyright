from _typeshed import Incomplete

from auth0.rest import RestClientOptions as RestClientOptions

from .actions import Actions as Actions
from .attack_protection import AttackProtection as AttackProtection
from .blacklists import Blacklists as Blacklists
from .branding import Branding as Branding
from .client_credentials import ClientCredentials as ClientCredentials
from .client_grants import ClientGrants as ClientGrants
from .clients import Clients as Clients
from .connections import Connections as Connections
from .custom_domains import CustomDomains as CustomDomains
from .device_credentials import DeviceCredentials as DeviceCredentials
from .email_templates import EmailTemplates as EmailTemplates
from .emails import Emails as Emails
from .grants import Grants as Grants
from .guardian import Guardian as Guardian
from .hooks import Hooks as Hooks
from .jobs import Jobs as Jobs
from .log_streams import LogStreams as LogStreams
from .logs import Logs as Logs
from .organizations import Organizations as Organizations
from .prompts import Prompts as Prompts
from .resource_servers import ResourceServers as ResourceServers
from .roles import Roles as Roles
from .rules import Rules as Rules
from .rules_configs import RulesConfigs as RulesConfigs
from .stats import Stats as Stats
from .tenants import Tenants as Tenants
from .tickets import Tickets as Tickets
from .user_blocks import UserBlocks as UserBlocks
from .users import Users as Users
from .users_by_email import UsersByEmail as UsersByEmail

class Auth0:
    actions: Incomplete
    attack_protection: Incomplete
    blacklists: Incomplete
    branding: Incomplete
    client_credentials: Incomplete
    client_grants: Incomplete
    clients: Incomplete
    connections: Incomplete
    custom_domains: Incomplete
    device_credentials: Incomplete
    email_templates: Incomplete
    emails: Incomplete
    grants: Incomplete
    guardian: Incomplete
    hooks: Incomplete
    jobs: Incomplete
    log_streams: Incomplete
    logs: Incomplete
    organizations: Incomplete
    prompts: Incomplete
    resource_servers: Incomplete
    roles: Incomplete
    rules_configs: Incomplete
    rules: Incomplete
    stats: Incomplete
    tenants: Incomplete
    tickets: Incomplete
    user_blocks: Incomplete
    users_by_email: Incomplete
    users: Incomplete
    def __init__(self, domain: str, token: str, rest_options: RestClientOptions | None = None) -> None: ...
