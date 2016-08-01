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
            "Authorization": "OAuth " + conf.SPIO_API_KEY,
            "Content-Type": "application/x-www-form-urlencoded"
        }
    };

    self.violation_policy_names = {};

    function main() {
        // check for any open violations
        console.log("Checking for open New Relic violations...");

        self.client.get(self.nr_url + "/alerts_violations.json?only_open=true", self.nr_args,
            function (data, response) {
                if (data.violations) {
                    var violations = data.violations;
                    self.violation_policy_names = {};
                    console.log("Violations: ", violations.length);

                    if (violations.length > 0) {
                        // parsed response body as js object
                        for (var i = 0; i < violations.length; i++) {
                            var violation = violations[i];
                            self.violation_policy_names[violation.policy_name.toLowerCase()] = 1;
                        }

                        console.log("Policies with open violations: ", self.violation_policy_names);
                    }
                    else {
                        console.log("No open violations.");
                    }

                    // Now update SPIO components based on open violations
                    updateSPIOComponents();
                }
                else {
                    console.log("Invalid response from New Relic API. Status Code: " + response.statusCode);
                }
            }
        );

        function updateSPIOComponents() {
            console.log("Updating statuspage.io components...");

            // now update the statuspage.io component based on any matching policy-components names
            self.client.get(self.spio_url + "/components.json", self.spio_get_args,
                function (data, response) {
                    if (response.statusCode === 200) {
                        for (var i = 0; i < data.length; i++) {
                            var component = data[i];

                            if (self.violation_policy_names[component.name.toLowerCase()]) {
                                console.log("Found component matching policy violation, name: ", component.name);

                                if (component.status != 'partial_outage') {
                                    // update status of component based on violation rules
                                    updateSPIOComponentStatus(component, 'partial_outage');
                                }
                            }
                            else if (component.status != 'operational') {
                                // No violation for this component so set it back to operational
                                updateSPIOComponentStatus(component, 'operational');
                            }
                        }
                    }
                    else {
                        console.log("Invalid response from statuspage.io API. Status code: " + response.statusCode);
                    }
                }
            );
        }

        function updateSPIOComponentStatus(component, status) {
            console.log("Setting components status: ", component.name, status);
            self.spio_patch_args.data = "component[status]=" + status;
            self.client.patch(self.spio_url + "/components/" + component.id + ".json", self.spio_patch_args,
                function (data, response) {
                    if (response.statusCode === 200) {
                        console.log("Status updated successfully for component: ", component.name);
                    }
                    else {
                        console.log("Error updating status for component: ", component.name, response.statusCode);
                    }
                }
            );
        }
    }

    setInterval(main, conf.POLL_INTERVAL);
};

if (NODEJS) module.exports = AppServer;
