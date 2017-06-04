var Client = require('node-rest-client').Client;
var _ = require('lodash');
var http = require('http');
var express = require('express');

// Patch console.x methods in order to add timestamp information
require("console-stamp")(console, {pattern: "mm/dd/yyyy HH:MM:ss.l"});

/**
 * Statuspage Controller automates actions on a statuspage.io status page based on New Relic Alerts
 *
 * NOTE: If you don't provide api keys will attempt to sue these environment variables:
 *    NR_API_KEY    // New Relic API Key
 *    SPIO_API_KEY  // statuspage.io API Key
 *    SPIO_PAGE_ID  // statuspage.io Page ID
 *
 * @constructor
 *
 */
var StatuspageController = function (config) {

    config = config || {};

    //  Scope.
    var self = this;

    /**
     * Configuration settings.
     * @type {{}}
     */
    this.config = {
        POLL_INTERVAL: process.env.POLL_INTERVAL || config.POLL_INTERVAL || 30000,
        PORT:          process.env.PORT          || config.PORT          || 8080,
        NR_API_KEY:    process.env.NR_API_KEY    || config.NR_API_KEY,
        SPIO_PAGE_ID:  process.env.SPIO_PAGE_ID  || config.SPIO_PAGE_ID,
        SPIO_API_KEY:  process.env.SPIO_API_KEY  || config.SPIO_API_KEY,
    };

    function getStatus(duration) {
        //TODO: don't read thresholds.json every time, load it and cache it
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

        /**
         * Recursively pages through New Relic violations and parses them, then hands off to updateSPIOComponents
         * @param data
         * @param data.violations
         * @param data.violations.policy_name
         * @param response
         */
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

    /**
     *  terminator === the termination handler
     *  Terminate server on receipt of the specified signal.
     */
    self.terminator = function (sig) {
        if (typeof sig === "string") {
            console.log('Received %s - terminating sample server ...', sig);
            process.exit(1);
        }
        console.log('Node server stopped.');
    };


    /**
     *  Setup termination handlers (for exit and a list of signals).
     */
    self.setupTerminationHandlers = function () {
        //  Process on exit and signals.
        process.on('exit', function () {
            self.terminator(0);
        });

        ['SIGHUP', 'SIGINT', 'SIGQUIT', 'SIGILL', 'SIGTRAP', 'SIGABRT',
            'SIGBUS', 'SIGFPE', 'SIGUSR1', 'SIGSEGV', 'SIGUSR2', 'SIGTERM'
        ].forEach(function (element) {
            process.on(element, function () {
                self.terminator(element);
            });
        });
    };


    self.initializeVariables = function () {
        self.client = new Client();
        self.nr_url = "https://api.newrelic.com/v2";
        self.spio_url = "https://api.statuspage.io/v1/pages/" + self.config.SPIO_PAGE_ID;

        self.nr_args = {
            headers: {"X-Api-Key": self.config.NR_API_KEY} // request headers
        };

        self.spio_get_args = {
            headers: {"Authorization": "OAuth " + self.config.SPIO_API_KEY}
        };

        self.spio_patch_args = {
            headers: {
                "Authorization": "OAuth " + self.config.SPIO_API_KEY,
                "Content-Type": "application/x-www-form-urlencoded"
            }
        };

        self.oldest_violation_per_policy = {};
    };

    /**
     *  Initialize the server (express) and create the routes and register
     *  the handlers.
     */
    self.initializeServer = function () {
        self.app = express();
        self.httpServer = http.Server(self.app);

        // Set up express static content root
        self.app.use(express.static(__dirname + '/../' + (process.argv[2] || 'client')));

        // Define Routes
        self.routes = {};
        self.routes['/api/healthcheck'] = function (req, res) {
            //TODO: Make sure we can communicate with New Relic api
            //TODO: Make sure we can communicate with statuspage.io api
            res.setHeader('Content-Type', 'application/json');
            res.send("{}");
        };

        //  Add handlers for the app (from the routes).
        for (var r in self.routes) {
            if (self.routes.hasOwnProperty(r)) {
                self.app.get(r, self.routes[r]);
            }
        }
    };


    /**
     *  Initializes the server
     */
    self.initialize = function () {
        self.initializeVariables();

        self.setupTerminationHandlers();

        // Create the express server and routes.
        self.initializeServer();
    };


    /**
     *  Start the server
     */
    self.start = function () {
        if (!self.config.NR_API_KEY || !self.config.SPIO_PAGE_ID || !self.config.SPIO_API_KEY) {
            console.error("You are missing required API keys, make sure the following environment variables are set:");
            console.error("NR_API_KEY - Your New Relic API key");
            console.error("SPIO_PAGE_ID - Your Statuspage.io Page ID");
            console.error("SPIO_API_KEY - Your Statuspage.io API key");
            return;
        }

        console.log("Starting StatuspageController with the following config:");
        console.log("poll interval: ", self.config.POLL_INTERVAL);
        console.log("Port: ", self.config.PORT);
        console.log("New Relic API key: ", self.maskString(self.config.NR_API_KEY));
        console.log("StatusPage Page ID: ", self.maskString(self.config.SPIO_PAGE_ID));
        console.log("StatusPage API key: ", self.maskString(self.config.SPIO_API_KEY));

        // Start synchronizing
        setInterval(main, self.config.POLL_INTERVAL);

        //  Start the app on the specific interface (and port).
        self.httpServer.listen(self.config.PORT, function () {
            console.log('Node server started on http://localhost:%d ...', self.config.PORT);
        });
    };

    self.maskString = function (s) {
        return s ? '***' + s.substr(s.length - 4) : 'undefined';
    }


    // Initialize all variables and server
    self.initialize();
};

module.exports = StatuspageController;
