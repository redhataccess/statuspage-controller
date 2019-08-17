const spc = require('./../server/StatuspageController.js');
const PluginExample = require('./example_plugin.js');

const config = {
    NR_API_KEY: process.env.NR_API_KEY,
    SPIO_PAGE_ID: process.env.SPIO_PAGE_ID,
    SPIO_API_KEY: process.env.SPIO_API_KEY,
    POLL_INTERVAL: 10000,
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

const plugin = new PluginExample(plugin_config);

const spcInstance = new spc(config);

spcInstance.addPlugin(plugin);

spcInstance.start();
