/// <reference path="fourslash.ts" />
// @asynctest: true

// @filename: quickActionOrganizeImportTest1.py
//// import time
//// import os
//// import sys

helper.verifyCommand(
    {
        title: 'Quick action order imports 1',
        command: Consts.Commands.orderImports,
        arguments: ['quickActionOrganizeImportTest1.py']
    },
    {
        ['quickActionOrganizeImportTest1.py']: `import os
import sys
import time`
    }
);
