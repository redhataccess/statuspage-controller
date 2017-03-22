////////////////////////////////////////////////////////////////////
// rename this file to private_conf.js and set your keys and id here
// WARNING: Keep this file private and secure!
//
// NOTE: You will also need to configure your environment with the
//       following environment variables:
//    NR_API_KEY    // New Relic API Key
//    SPIO_API_KEY  // statuspage.io API Key
//    SPIO_PAGE_ID  // statuspage.io Page ID
////////////////////////////////////////////////////////////////////

var NODEJS = typeof module !== 'undefined' && module.exports;

var SPC = SPC || {};

SPC.Conf = {
    POLL_INTERVAL : 10000  // How often to check for violations in ms
};

if (NODEJS) module.exports = SPC.Conf;
