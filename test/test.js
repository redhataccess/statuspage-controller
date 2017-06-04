var spc = require('./../server/StatuspageController.js');

var config = {
    POLL_INTERVAL: 10000,
    PORT: 3000,
};

var spcInstance = new spc(config);

spcInstance.start();
