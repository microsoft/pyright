# This source ensures that a multi-part import statement without an alias
# implicitly imports all modules in the multi-part chain.

import html.entities

x = html.escape
