# Status Page Controller
Automates actions on a Statuspage.io page based on New Relic Alerts. 

![statuspagecontrolerdesign](https://cloud.githubusercontent.com/assets/3926730/17302336/c955254c-57e9-11e6-8ed9-af3062e0cd07.png)

It will change the status of status page components if the component names matches the exact name of a New Relic Alert Policy.

For Example, if you have a New Relic alert policy named "Downloads" and a Statuspage.io component named "Downloads",
If a New Relic incident is created for the "Downloads" policy, status page controller will update the matching
"Downloads" component in Statuspage.io based on the following default thresholds:

1. yellow = Incident is at least 10 minutes old
2. orange = Incident is at least 20 minutes old
3. red = incident is 30+ minutes old

NOTE: the above can be configured, see below.

## Install

    npm install statuspage-controller

## Usage

### With the default config

    var StatuspageController = require('statuspage-controller')
    var spc = new StatuspageController();
    spc.start();
      
This usage will use all config defaults and expect the following environment variables to be set in order to work:
* NR_API_KEY - Your New Relic API key
* SPIO_PAGE_ID - Your Statuspage.io Page ID
* SPIO_API_KEY - Your Statuspage.io API key

### Specify a config object:

    var StatuspageController = require('statuspage-controller')
    var config = {
        POLL_INTERVAL: 10000,
        PORT: 8080,
        NR_API_KEY: process.env.NR_API_KEY,
        SPIO_PAGE_ID: process.env.SPIO_PAGE_ID,
        SPIO_API_KEY: process.env.SPIO_API_KEY,
    };
    var spc = new StatuspageController(config);
    spc.start();
    
### Configuring with custom thresholds:

    var config = {
        POLL_INTERVAL: 10000,
        PORT: 8080,
        NR_API_KEY: process.env.NR_API_KEY,
        SPIO_PAGE_ID: process.env.SPIO_PAGE_ID,
        SPIO_API_KEY: process.env.SPIO_API_KEY,
        THRESHOLDS: [
            {
                "duration": 600,
                "status": "degraded_performance"
            },
            {
                "duration": 1200,
                "status": "partial_outage"
            },
            {
                "duration": 1800,
                "status": "major_outage"
            }
        ]
    };
    var spc = new StatuspageController(config);
    spc.start();

Thresholds are in seconds.  The above will change the component to degraded_performance after 600 seconds, and so on.
You can have just one threshold if you want to change the component status to a single status after a given time. 
For example, if you wanted to go strait to major outage after 10 minutes then you would do:

    THRESHOLDS: [
        {
            "duration": 600,
            "status": "major_outage"
        }
    ]

## API
In order to use the built in API you will have to configure 2 things:
1. Basic Auth.  You'll need to configure an htpasswrd file with user(s) created with `htpasswd` command.
2. SSL cert files for https.
 
### Basic Auth
1. Either have htpasswd command installed with apache, or [npm-htpasswd](https://www.npmjs.com/package/htpasswd)
2. Create a user and new htpasswd file: `htpasswd -c /path/to/users.htpasswd myuser`
3. Point the config at the password file: `HTPASSWD_FILE: '/path/to/users.htpasswd`

### SSL
1. Either use an existing key and cert of create self-signed cert using the following method:
`openssl req -x509 -nodes -days 365 -newkey rsa:2048 -keyout /path/to/selfsigned.key -out /path/to/selfsigned.crt`
2. Point the config at your key and cert files using the `tls` object:
`TLS: {key: '/path/to/selfsigned.key', cert: '/path/to/selfsigned.crt'`

### Full Example
    var StatuspageController = require('statuspage-controller')
    var config = {
        POLL_INTERVAL: 10000,
        PORT: 8080,
        NR_API_KEY: process.env.NR_API_KEY,
        SPIO_PAGE_ID: process.env.SPIO_PAGE_ID,
        SPIO_API_KEY: process.env.SPIO_API_KEY,
        HTPASSWD_FILE: '/path/to/users.htpasswd',
        TLS: {
            key:  "/path/to/selfsigned.key",
            cert: "/path/to/selfsigned.crt",
        }
    };
    var spc = new StatuspageController(config);
    spc.start();

**Basic auth and SSL are required to use the API** If these are not configured or fail the API server will not be started.

## Sync vs Push
Both New Relic and StatusPage.io have ways to automate via push.  New Relic alerts can post to a webhook, or send an email, and StatusPage.io components can be updated with a unique email.  The problem with this method is that if a message is ever lost, then the state between New Relic and StatusPage.io will get out of sync.

By synchronizing both systems with their APIs, the states between the two will always be kept in sync, even if an alert message is never received.  It also updates states faster than email.  As soon as a violation is created it will be picked up on the next sync.  If Status Controller ever goes down, the next time it is started it will sync the statuses to their current state.

