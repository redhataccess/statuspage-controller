var NODEJS = typeof module !== 'undefined' && module.exports;

var Client = require('node-rest-client').Client;
var conf   = require('./conf.js');
var _      = require('lodash');

/**
 * This module contains all of the app logic and state,
 * @constructor
 */
var AppServer = function (app) {
    //  Scope.
    var self = this;
    self.app = app;


    // Define API
    self.routes = {};
    self.routes['/api/healthcheck'] = function (req, res) {
        // Make sure we can communicate with New Relic api


        // Make sure we can communicate with statuspage.io api

        res.setHeader('Content-Type', 'application/json');
        res.send("{}");
    };

    //  Add handlers for the app (from the routes).
    for (var r in self.routes) {
        if (self.routes.hasOwnProperty(r)) {
            self.app.get(r, self.routes[r]);
        }
    }

    console.log("nr api key: ", process.env.NR_API_KEY);
    console.log("sp page id: ", process.env.SPIO_PAGE_ID);
    console.log("sp api key: ", process.env.SPIO_API_KEY);

    self.client = new Client();
    self.nr_url = "https://api.newrelic.com/v2";
    self.spio_url = "https://api.statuspage.io/v1/pages/" + process.env.SPIO_PAGE_ID;

    self.nr_args = {
        headers: { "X-Api-Key": process.env.NR_API_KEY } // request headers
    };

    self.spio_get_args = {
        headers: { "Authorization": "OAuth " + process.env.SPIO_API_KEY }
    };

    self.spio_patch_args = {
        headers: {
            "Authorization": "OAuth " + process.env.SPIO_API_KEY,
            "Content-Type": "application/x-www-form-urlencoded"
        }
    };

    self.oldest_violation_per_policy = {};

    function getStatus(duration) {
        var rules = _.orderBy(require('./thresholds.json'), 'duration', 'desc');

        var rule = {};
        for (var i = 0, l = rules.length; i < l; ++i) {
            if (duration > rules[i].duration) {
                rule = rules[i];
                break;
            }
        }

        // default to operational
        return rule.status || 'operational';
    }

    function main() {
        // check for any open violations
        console.log("Checking for open New Relic violations...");
        var currentPage = 1;

        // reset policies
        self.oldest_violation_per_policy = {};

        self.client.get(self.nr_url + "/alerts_violations.json?only_open=true&page=" + currentPage, self.nr_args,
            parseViolations
        );

        function parseViolations(data, response) {
            console.log("Current page: ", currentPage);

            if (data.violations) {
                var violations = data.violations;
                console.log("Violations total: ", violations.length);

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

                    // recursively get and parse the next page
                    currentPage++;
                    self.client.get(self.nr_url + "/alerts_violations.json?only_open=true&page=" + currentPage, self.nr_args,
                        parseViolations
                    );
                }
                else {
                    console.log("No open violations.");
                    // Now update SPIO components based on open violations
                    updateSPIOComponents();
                }
            }
            else {
                console.log("Invalid response from New Relic API. Status Code: " + response.statusCode);
            }
        }

        function updateSPIOComponents() {
            console.log("Synchronizing statuspage.io components...");

            // now update the statuspage.io component based on any matching policy-components names
            self.client.get(self.spio_url + "/components.json", self.spio_get_args,
                function (data, response) {
                    if (response.statusCode === 200) {
                        for (var i = 0; i < data.length; i++) {
                            var component = data[i];

                            //console.log("Component: ", component);

                            var oldest_violation = self.oldest_violation_per_policy[component.name.toLowerCase()];
                            if (oldest_violation) {
                                console.log("Found component matching policy name: ", component.name);
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
