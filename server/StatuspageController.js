'use strict';

const Client = require('node-rest-client').Client;
const _ = require('lodash');
const Hapi = require('hapi');
const fs = require('fs');
const httpAuth = require('http-auth');
const Joi = require('joi');


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
const StatuspageController = function (config) {
    //  Scope.
    const self = this;

    config = config || {};

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
        HTPASSWD_FILE: process.env.HTPASSWD_FILE || config.HTPASSWD_FILE,
        TLS:           config.TLS,
        THRESHOLDS:    config.THRESHOLDS || [
            {
                "duration": 600,
                "status": "degraded_performance"
            },
            {
                "duration": 1200,
                "status": "partial_outage"
            },
            {
                "duration": 1800,
                "status": "major_outage"
            }
        ]
    };

    function getStatus(duration) {
        const rules = _.orderBy(self.config.THRESHOLDS, 'duration', 'desc');

        let rule = {};
        for (let i = 0; i < rules.length; ++i) {
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
        let currentPage = 1;

        // reset incidents
        self.oldest_violation_per_policy = {};

        // kick off process by first refreshing the NR policy list, then getting violations
        self.getNRAlertPolicies(getViolations);

        function getViolations() {
            self.client.get(self.nr_url + "/alerts_violations.json?only_open=true&page=" + currentPage, self.nr_args,
                parseViolations
            );
        }

        /**
         * Recursively pages through New Relic violations and parses them, then hands off to updateSPIOComponents
         * @param data
         * @param data.violations
         * @param data.violations.policy_name
         * @param response
         */
        function parseViolations(data, response) {
            console.log("[alerts_violations] Current page: ", currentPage);

            if (data.violations) {
                const violations = data.violations;
                console.log("Violations on page: ", violations.length);

                if (violations.length > 0) {
                    // parsed response body as js object
                    for (let i = 0; i < violations.length; i++) {
                        const violation = violations[i];
                        //console.log("violation: ", violation);
                        const policy_name = violation.policy_name.toLowerCase();

                        // Save the oldest violation for this policy
                        if (self.oldest_violation_per_policy[policy_name]) {
                            const oldest = self.oldest_violation_per_policy[policy_name];
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
                    const incidentCount = Object.keys(self.oldest_violation_per_policy).length;
                    if (incidentCount > 0) {
                        console.log("Open New Relic incidents: ", incidentCount);
                    }
                    else {
                        console.log("No open New Relic incidents");
                    }

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
                        self._statupageComponents = {}; // refresh component list

                        for (let i = 0; i < data.length; i++) {
                            const component = data[i];
                            const componentName = component.name.toLowerCase();

                            self._statupageComponents[componentName] = component;

                            // Check if this component is linked
                            if (!self._alertPolicies[componentName]) {
                                console.log('Component not linked, skipping: ', componentName);
                                continue; // skip this component
                            }

                            // Check if this component is overridden
                            if (self._overrides[componentName]) {
                                console.log('Component is currently overridden, skipping: ', componentName, self._overrides[componentName]);
                                continue; // skip this component
                            }

                            // Component is linked and not overridden, sync status
                            const oldest_violation = self.oldest_violation_per_policy[componentName];
                            if (oldest_violation) {
                                console.log("Found component matching policy name: ", component.name);
                                console.log("Violation duration, component status: ", oldest_violation.duration, component.status);

                                const new_status = getStatus(oldest_violation.duration);

                                if (component.status !== new_status) {
                                    self.executePluginsStatusChange(component, new_status, oldest_violation);

                                    // update status of component based on violation rules
                                    self.updateSPIOComponentStatus(component, new_status);
                                }
                            }
                            else if (component.status !== 'operational') {
                                self.executePluginsStatusChange(component, 'operational');

                                // No violation for this component so set it back to operational
                                self.updateSPIOComponentStatus(component, 'operational');
                            }
                        }
                    }
                    else {
                        console.log("Invalid response from statuspage.io API. Status code: " + response.statusCode);
                    }
                }
            );
        }
    }

    self.getNRAlertPolicies = function (callback) {
        let currentPage = 1;
        self._alertPolicies = {};

        /**
         * Recursively pages through New Relic alert polices and saves them
         * @param data
         * @param data.policies
         * @param response
         */
        function parsePolicies(data, response) {
            console.log("[alerts_policies] Current page: ", currentPage);

            if (data.policies) {
                let policies = data.policies;


                if (policies.length > 0) {
                    // parsed response body as js object
                    for (let i = 0; i < policies.length; i++) {
                        const policy = policies[i];
                        const policy_name = policy.name.toLowerCase();
                        self._alertPolicies[policy_name] = policy;
                    }

                    // recursively get and parse the next page
                    currentPage++;
                    self.client.get(self.nr_url + "/alerts_policies.json?page=" + currentPage, self.nr_args,
                        parsePolicies
                    );
                }
                else {
                    console.log("NR Alert Policies total: ", Object.keys(self._alertPolicies).length);
                    if (typeof callback === 'function') {
                        callback(true);
                    }
                }
            }
            else {
                console.log("Invalid response from New Relic API. Status Code: " + response.statusCode);
                if (typeof callback === 'function') {
                    callback(false);
                }
            }
        }

        self.client.get(self.nr_url + "/alerts_policies.json?page=" + currentPage, self.nr_args,
            parsePolicies
        );
    };

    self.getStatuspageComponents = function (callback) {
        // now update the statuspage.io component based on any matching policy-components names
        self.client.get(self.spio_url + "/components.json", self.spio_get_args,
            function (data, response) {
                if (response.statusCode === 200) {
                    console.log("Statuspage.io components: ", data.length);

                    for (let i = 0; i < data.length; i++) {
                        const component = data[i];
                        const componentName = component.name.toLowerCase();

                        self._statupageComponents[componentName] = component;
                    }

                    if (typeof callback === 'function') {
                        callback(true); // successful
                    }
                }
                else {
                    console.log("[getStatuspageComponents] Invalid response from statuspage.io API. Status code: " + response.statusCode);
                    if (typeof callback === 'function') {
                        callback(false); // unsuccessful
                    }
                }
            }
        );
    };

    self.updateSPIOComponentStatus = function (component, status) {
        console.log("Setting components status: ", component.name, status);
        self.spio_patch_args.data = "component[status]=" + status;
        self.client.patch(self.spio_url + "/components/" + component.id + ".json", self.spio_patch_args,
            function (data, response) {
                if (response.statusCode === 200) {
                    console.log("Status updated successfully for component: ", component.name, status);
                }
                else {
                    console.error("Error updating status for component: ", component.name, status, response.statusCode);
                }
            }
        );
    };

    /**
     * Execute all plugin status change functions
     * @param component Status page component being updated
     * @param status new status
     * @param violation New Relic violation object
     */
    self.executePluginsStatusChange = function (component, status, violation) {
        self._plugins.forEach(function (plugin) {

            /** @namespace plugin.hookStatusChange */
            if (plugin && typeof plugin.hookStatusChange === "function") {
                plugin.hookStatusChange(component, status, violation);
            }
        });
    };

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

    self.addPlugin = function (plugin) {
        self._plugins.push(plugin);
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

        // New Relic alert polices
        self._alertPolicies = {};

        // Statuspage.io components
        self._statupageComponents = {};

        // Registered plugins
        self._plugins = [];

        // statuspage.io component overrides.  Automatic state changing won't be applied to these
        self._overrides = {};
    };

    self.validateApiConfig = function () {
        let valid = false;
        if (self.config.HTPASSWD_FILE && self.config.TLS) {
            if (self.config.TLS.key && self.config.TLS.cert) {
                valid = true;
            }
        }
        return valid;
    };

    /**
     *  Initialize the API server (hapi.js) and create the routes and register
     *  the handlers.
     */
    self.initializeApiServer = function () {
        // first validate the required configs: HTPASSWD and TLS
        if (self.validateApiConfig()) {
            try { // Create a server with a host and port
                self.server = new Hapi.Server();
                self.server.connection({
                    host: 'localhost',
                    port: self.config.PORT,
                    tls: {
                        key: fs.readFileSync(self.config.TLS.key),
                        cert: fs.readFileSync(self.config.TLS.cert),
                    }
                });

                // Setup auth.
                const basic = httpAuth.basic({
                    realm: "Statuspage Controller",
                    file: self.config.HTPASSWD_FILE,
                });

                // Register auth plugin.
                self.server.register(httpAuth.hapi());

                // Setup strategy.
                self.server.auth.strategy('http-auth', 'http', basic);

                // route handlers
                const healthCheckHandler = (request, reply) => {
                    console.log("[/api/healthcheck.json GET] received GET request");

                    let res = {
                        message: 'New Relic and statuspage.io connections established.',
                        ok: true,
                    };

                    // check new relic connection
                    self.getNRAlertPolicies((ok) => {
                        if (ok) {
                            // now check statuspage.io connection
                            self.getStatuspageComponents((ok) => {
                                if (!ok) {
                                    res.message = 'Trouble connecting to statuspage.io API, check your statuspage.io API key and Page Id.';
                                    res.ok = false;
                                }

                                let response = reply(res);
                                response.type('application/json');
                            });
                        }
                        else {
                            if (!ok) {
                                res.message = 'Trouble connecting to New Relic API, check your New Relic API key.';
                                res.ok = false;
                            }

                            let response = reply(res);
                            response.type('application/json');
                        }
                    });
                };

                const overridesGetHandler = (request, reply) => {
                    console.log("[/api/overrides.json GET] received GET request");

                    let response = reply(self._overrides);
                    response.type('application/json');
                };

                const overridesPostHandler = (request, reply) => {
                    let override = request.payload;

                    console.log("[/api/overrides.json POST] ", override);

                    const componentName = override.component_name.toLowerCase();

                    self._overrides[componentName] = override;

                    // remove the override after the given seconds
                    setTimeout(() => {
                        delete self._overrides[componentName]
                    }, override.seconds * 1000);

                    // Also optionally set the new status in statuspage.io
                    if (override.new_status) {
                        self.updateSPIOComponentStatus(self._statupageComponents[componentName], override.new_status);
                    }

                    let response = reply({
                        message: "Successfully added override",
                        component_name: override.component_name,
                        seconds: override.seconds,
                    });
                    response.type('application/json');
                };

                // routes
                // noinspection JSUnresolvedFunction
                const routes = [
                    {
                        method: 'GET',
                        path: '/api/healthcheck.json',
                        handler: healthCheckHandler,
                    },
                    {
                        method: 'GET',
                        path: '/api/overrides.json',
                        handler: overridesGetHandler,
                        config: {
                            auth: 'http-auth',
                        }
                    },
                    {
                        method: 'POST',
                        path: '/api/overrides.json',
                        handler: overridesPostHandler,
                        config: {
                            auth: 'http-auth',
                            validate: {
                                payload: {
                                    component_name: Joi.string().min(1).required(),
                                    seconds: Joi.number().min(0).max(2628000).required(), // 1 month max
                                    new_status: Joi.string().optional()
                                }
                            },
                        }
                    }
                ];

                self.server.route(routes);

                self.apiInitialized = true;
            } catch (e) {
                console.error('There was a problem initializing API: ', e);
                console.error('For help refer to the API documentation: https://github.com/redhataccess/statuspage-controller');
            }
        }
        else {
            console.error("Invalid API config. For help refer to the API documentation: https://github.com/redhataccess/statuspage-controller");
        }
    };


    /**
     *  Initializes the server
     */
    self.initialize = function () {
        self.initializeVariables();

        // Load all the currently defined alert polices from New Relic
        self.getNRAlertPolicies();

        // Load up statuspage.io components
        self.getStatuspageComponents();

        self.setupTerminationHandlers();

        // Create the express server and routes.
        self.initializeApiServer();
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

        if (self.apiInitialized) {
            // Start the server
            self.server.start((err) => {
                if (err) {
                    console.error('There was an error starting the api server: ', err);
                }
                else {
                    /** @namespace self.server.info.uri */
                    console.log('API Server running at:', self.server.info.uri);
                }
            });
        }
    };

    self.maskString = function (s) {
        return s ? '***' + s.substr(s.length - 4) : 'undefined';
    };


    // Initialize all variables and server
    self.initialize();
};

module.exports = StatuspageController;
