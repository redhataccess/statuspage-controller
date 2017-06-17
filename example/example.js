const spc = require('./../server/StatuspageController.js');
const IrcPlugin = require('./example_plugin.js');

const config = {
    NR_API_KEY: 'nrapi',
    SPIO_PAGE_ID: 'pageid',
    SPIO_API_KEY: 'spioapi',
    // POLL_INTERVAL: 60000,
    // PORT: 3000,
    // DEBUG: false,
    // HTPASSWD_FILE: 'data/users.htpasswd',
    // TLS: {
    //     key: 'data/selfsigned.key',
    //     cert: 'data/selfsigned.crt',
    // },
    THRESHOLDS: [
        {
            "duration": 10,
            "status": "degraded_performance"
        },
        {
            "duration": 60,
            "status": "partial_outage"
        },
        {
            "duration": 90,
            "status": "major_outage"
        }
    ]
};

const plugin_config = {
    host: 'irc.host.com',
    nick: 'statusbot',
    channels: [
        '#mychannel'
    ]
};

const p = new IrcPlugin(plugin_config);

const spcInstance = new spc(config);

spcInstance.addPlugin(p);

spcInstance.start();
