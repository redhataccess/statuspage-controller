var NODEJS = typeof module !== 'undefined' && module.exports;

var Client = require('node-rest-client').Client;
var conf   = require('./private_conf.js');

/**
 * This module contains all of the app logic and state,
 * @constructor
 */
var AppServer = function () {
    //  Scope.
    var self = this;

    self.client = new Client();
    self.nr_url = "https://api.newrelic.com/v2";
    self.spio_url = "https://api.statuspage.io/v1/pages/" + conf.SPIO_PAGE_ID;

    self.nr_args = {
        headers: { "X-Api-Key": conf.NR_API_KEY } // request headers
    };

    self.spio_get_args = {
        headers: { "Authorization": "OAuth " + conf.SPIO_API_KEY }
    };

    self.spio_patch_args = {
        headers: {
            "Authorization": conf.SPIO_API_KEY,
            "Content-Type": "application/x-www-form-urlencoded"
        }
    };

    self.violation_policy_names = {};

    setInterval(function() {

        // check for any open violations
        console.log("Checking for violations");

        self.client.get(self.nr_url + "/alerts_violations.json?only_open=true", self.nr_args,
            function (data, response) {
                if (data.violations) {
                    var violations = data.violations;
                    self.violation_policy_names = {};

                    if (violations.length > 0) {
                        // parsed response body as js object
                        for (var i = 0; i < violations.length; i++) {
                            var violation = violations[i];
                            //console.log("policy: " + violation.policy_name);

                            self.violation_policy_names[violation.policy_name] = 1;
                        }

                        console.log(self.violation_policy_names);
                    }
                    else {
                        console.log("No violations");
                    }
                }
                else {
                    console.log("No violations in response");
                }
            }
        );

        // now update the statuspage.io component based on any matching policy-components names
        self.client.get(self.spio_url + "/components.json", self.spio_get_args,
            function (data, response) {
                //console.log(data);

                for (var i = 0; i < data.length; i++) {
                    var component = data[i];

                    if (self.violation_policy_names[component.name]) {
                        console.log("Found component matching policy violation");

                        // update status of component
                        self.spio_patch_args.data = "component[status]=major_outage";
                        self.client.patch(self.spio_url + "/components/" + component.id + ".json", self.spio_patch_args,
                            function (data, response) {
                                //console.log(data);
                            }
                        );
                    }
                    else {
                        // update status of component
                        self.spio_patch_args.data = "component[status]=operational";
                        self.client.patch(self.spio_url + "/components/" + component.id + ".json", self.spio_patch_args,
                            function (data, response) {
                                //console.log(data);
                            }
                        );
                    }
                }
            }
        );

    }, conf.POLL_INTERVAL);

};

if (NODEJS) module.exports = AppServer;
