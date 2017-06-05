var spc = require('./../server/StatuspageController.js');
var IrcPlugin = require('./test_plugin.js');

var config = {
    NR_API_KEY: 'nrapi',
    SPIO_PAGE_ID: 'pageid',
    SPIO_API_KEY: 'spioapi',
    POLL_INTERVAL: 3000,
    PORT: 3000,
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
