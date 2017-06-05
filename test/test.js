var spc = require('./../server/StatuspageController.js');
var logPlugin = require('./test_plugin.js');

var config = {
    NR_API_KEY: 'nrapi',
    SPIO_PAGE_ID: 'pageid',
    SPIO_API_KEY: 'spioapi',
    POLL_INTERVAL: 3000,
    PORT: 3000,
};

var p = new logPlugin();

var spcInstance = new spc(config);

spcInstance.addPlugin(p);

spcInstance.start();
