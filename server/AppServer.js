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

    self.oldest_violation_per_policy = {};

    function getStatus(duration) {
        //TODO: use thresholds.json here instead of hard code
        if (duration > 75) return 'major_outage';
        if (duration > 50) return 'partial_outage';
        if (duration > 25) return 'degraded_performance';

        // default to operational
        return 'operational';
    }

    function main() {
        // check for any open violations
        console.log("Checking for open New Relic violations...");

        self.client.get(self.nr_url + "/alerts_violations.json?only_open=true", self.nr_args,
            function (data, response) {
                if (data.violations) {
                    var violations = data.violations;
                    self.oldest_violation_per_policy = {};
                    console.log("Violations: ", violations.length);

                    if (violations.length > 0) {
                        // parsed response body as js object
                        for (var i = 0; i < violations.length; i++) {
                            var violation = violations[i];
                            //console.log("violation: ", violation);
                            var policy_name = violation.policy_name.toLowerCase();

                            // Save the oldest violation for this policy
                            if (self.oldest_violation_per_policy[policy_name]) {
                                var oldest = self.oldest_violation_per_policy[policy_name];
                                //console.log("checking if this violation is older: ", violation.duration, oldest.duration);
                                if (violation.duration > oldest.duration) {
                                    //console.log("Setting to oldest: ", violation);
                                    self.oldest_violation_per_policy[policy_name] = violation;
                                }
                            }
                            else {
                                self.oldest_violation_per_policy[policy_name] = violation;
                            }
                        }

                        console.log("Policies with open violations: ", Object.getOwnPropertyNames(self.oldest_violation_per_policy));
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

                            var oldest_violation = self.oldest_violation_per_policy[component.name.toLowerCase()];
                            if (oldest_violation) {
                                console.log("Found component matching policy violation, name: ", component.name);
                                console.log("Violation duration, component status: ", oldest_violation.duration, component.status);

                                var new_status = getStatus(oldest_violation.duration);

                                if (component.status != new_status) {
                                    // update status of component based on violation rules
                                    updateSPIOComponentStatus(component, new_status);
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
                        console.log("Status updated successfully for component: ", component.name, status);
                    }
                    else {
                        console.log("Error updating status for component: ", component.name, status, response.statusCode);
                    }
                }
            );
        }
    }

    setInterval(main, conf.POLL_INTERVAL);
};

if (NODEJS) module.exports = AppServer;
