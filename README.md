#Status Page Controller
Automates actions on a Statuspage.io page based on New Relic Alerts. 

It will change the status of status page components if the component names matches the exact name of a New Relic Alert Policy.

For Example, if you have a New Relic alert policy named "Downloads" and a Statuspage.io component named "Downloads",
If a New Relic incident is created for the "Downloads" policy, status page controller will update the matching
"Downloads" component in Statuspage.io.

It currently degrades the component status based on the age of the incident using thresholds.json
1. yellow = Incident is at least 10 minutes old
2. orange = Incident is at least 20 minutes old
3. red = incident is 30+ minutes old

##Install

    npm install statuspage-controller

##Usage

With the default config

    var StatuspageController = require('statuspage-controller')
    var spc = new StatuspageController();
    spc.start();
      
This usage will use all config defaults and expect the following environment variables to be set in order to work:
* NR_API_KEY - Your New Relic API key
* SPIO_PAGE_ID - Your Statuspage.io Page ID
* SPIO_API_KEY - Your Statuspage.io API key

You can also specify a config object

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

##Basic Design
![statuspagecontrolerdesign](https://cloud.githubusercontent.com/assets/3926730/17302336/c955254c-57e9-11e6-8ed9-af3062e0cd07.png)

##Sync vs Push
Both New Relic and StatusPage.io have ways to automate via push.  New Relic alerts can post to a webhook, or send an email, and StatusPage.io components can be updated with a unique email.  The problem with this method is that if a message is ever lost, then the state between New Relic and StatusPage.io will get out of sync.

By synchronizing both systems with their APIs, the states between the two will always be kept in sync, even if an alert message is never received.  It also updates states faster than email.  As soon as a violation is created it will be picked up on the next sync.  If Status Controller ever goes down, the next time it is started it will sync the statuses to their current state.

## Building the client view
This is an experimental feature that is not fully implmenented yet.

    npm run build-client

That will create a `dist` directory, ready to be served.
