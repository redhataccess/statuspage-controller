var spc = require('./../server/StatuspageController.js');
var IrcPlugin = require('./test_plugin.js');

var config = {
    NR_API_KEY: 'nrapi',
    SPIO_PAGE_ID: 'pageid',
    SPIO_API_KEY: 'spioapi',
    POLL_INTERVAL: 3000,
    PORT: 3000,
    HTPASSWD_FILE: 'data/users.htpasswd',
    TLS: {
        key: 'data/selfsigned.key',
        cert: 'data/selfsigned.crt',
    },
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

var plugin_config = {
    host: 'irc.host.com',
    nick: 'statusbot',
    channels: [
        '#mychannel'
    ]
};

var p = new IrcPlugin(plugin_config);

var spcInstance = new spc(config);

spcInstance.addPlugin(p);

spcInstance.start();
