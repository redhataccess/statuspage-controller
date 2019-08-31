'use strict';

const _ = require('lodash');
const Hapi = require('hapi');
const fs = require('fs');
const httpAuth = require('http-auth');
const Joi = require('joi');
const NewRelicClient = require('./NewRelicClient');
const StatusPageClient = require('./StatusPageClient');

// Patch console.x methods in order to add timestamp information
require("console-stamp")(console, {pattern: "mm/dd/yyyy HH:MM:ss.l"});

/**
 * Statuspage Controller automates actions on a statuspage.io status page based on New Relic Alerts
 *
 * NOTE: If you don't provide api keys will attempt to sue these environment variables:
 *    NR_API_KEYS   // New Relic API Key(s)
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
        DEBUG:         config.DEBUG              || false,
        POLL_INTERVAL: process.env.POLL_INTERVAL || config.POLL_INTERVAL || 30000,
        PORT:          process.env.PORT          || config.PORT          || 8080,
        NR_API_KEYS:   process.env.NR_API_KEYS   || config.NR_API_KEYS,
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

    async function main() {
        // kick off process by first refreshing the NR policy list and status page components
        self.alertPolicies = await self.nrClient.getAlertPolicies(self.config.NR_API_KEYS);
        self.statupageComponents = await self.spClient.getStatusPageComponents();

        // Get open NR violations
        self.oldestViolationPerPolicy = await self.nrClient.getOldestViolationsPerPolicy(self.config.NR_API_KEYS);

        // Synchronize status page components based on NR incidents
        await syncStatusPageComponents();
    }

    async function syncStatusPageComponents() {
        console.log("[main] Synchronizing statuspage.io components...");

        const keys = Object.keys(self.statupageComponents);

        for (let i = 0; i < keys.length; i++) {
            const component = self.statupageComponents[keys[i]];
            const componentName = component.name.toLowerCase();
            let componentStatus = component.status;
            if (componentStatus) {
                componentStatus = componentStatus.toLowerCase();
            }

            // Check if this component is linked
            if (!self.alertPolicies[componentName]) {
                console.log('Component not linked, skipping: ', componentName);
                continue; // skip this component
            }

            // Check if this component is overridden
            if (self._overrides[componentName]) {
                console.log('Component is currently overridden, skipping: ', componentName, self._overrides[componentName]);
                continue; // skip this component
            }

            // Component is linked and not overridden, sync status
            const oldest_violation = self.oldestViolationPerPolicy[componentName];
            if (oldest_violation) {
                console.log("Found component matching policy name: ", component.name);
                console.log("Violation duration, component status: ", oldest_violation.duration, componentStatus);

                const new_status = getStatus(oldest_violation.duration);

                if (componentStatus !== new_status) {
                    self.executePluginsStatusChange(component, new_status, oldest_violation);

                    // update status of component based on violation rules
                    await self.spClient.updateComponentStatus(component, new_status);
                }
            } else if (componentStatus && componentStatus !== 'operational') {
                console.log("Changing component to operational: ", componentName);
                console.log("Current status: [" + componentStatus + "]");

                self.executePluginsStatusChange(component, 'operational');

                // No violation for this component so set it back to operational
                await self.spClient.updateComponentStatus(component, 'operational');
            }
        }
    }

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
            console.log('Received %s - terminating server ...', sig);
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
        self.oldestViolationPerPolicy = {};

        // New Relic alert polices
        self.alertPolicies = {};

        // New Relic API client
        self.nrClient = new NewRelicClient();

        // Status page API client
        self.spClient = new StatusPageClient(self.config.SPIO_PAGE_ID, self.config.SPIO_API_KEY);

        // Statuspage.io components
        self.statupageComponents = {};

        // Registered plugins
        self._plugins = [];

        // statuspage.io component overrides.  Automatic state changing won't be applied to these
        self._overrides = {};
    };

    self.validateApiConfig = function () {
        return true;  // nothing to validate yet
    };

    /**
     *  Initialize the API server (hapi.js) and create the routes and register
     *  the handlers.
     */
    self.initializeApiServer = function () {
        // first validate the required configs: HTPASSWD and TLS
        if (self.validateApiConfig()) {
            try { // Create a server with a host and port
                let options = {
                    port: self.config.PORT,
                };

                if (self.config.DEBUG) {
                    let debugTags = ['hapi', 'error', 'debug', 'info', 'warning', 'request', 'server', 'timeout',
                        'internal', 'implementation', 'tail', 'remove', 'last', 'add', 'received', 'handler',
                        'response', 'auth', 'pre', 'state', 'payload', 'validation', 'load', 'connection', 'client'];
                    options.debug = {
                        log: debugTags,
                        request: debugTags
                    }
                }

                // optionally add ssl
                if (self.config.TLS) {
                    options.tls = {
                        key: fs.readFileSync(self.config.TLS.key),
                        cert: fs.readFileSync(self.config.TLS.cert),
                    };
                }
                self.server = new Hapi.Server(options);

                let authScheme;

                if (self.config.HTPASSWD_FILE) {
                    // Setup auth.
                    authScheme = httpAuth.basic({
                        realm: "Statuspage Controller",
                        file: self.config.HTPASSWD_FILE,
                    });

                    // Register auth plugin.
                    self.server.register(httpAuth.hapi()).then(() => {});

                    // Setup strategy.
                    self.server.auth.strategy('http-auth', 'http', authScheme);

                    console.log('API using basic auth');
                }

                // route handlers
                const readyHandler = () => {
                    console.log("[/ready GET] received GET request");
                    return "ready";
                };

                const healthCheckHandler = async (request, h) => {
                    console.log("[/api/healthcheck.json GET] received GET request");

                    let res = {};

                    const isNRSuccess = await self.nrClient.checkNewRelicAPI(self.config.NR_API_KEYS);
                    const isSPSuccess = await self.spClient.checkStatusPageAPI();

                    if (isNRSuccess && isSPSuccess) {
                        res.message = 'New Relic and statuspage.io connections established.';
                        res.ok = true;
                    } else if (!isNRSuccess && !isSPSuccess) {
                        res.message = 'Trouble connecting to New Relic and Status Page APIs';
                        res.ok = false;
                    } else if (!isNRSuccess) {
                        res.message = 'Trouble connecting to New Relic API';
                        res.ok = false;
                    } else if (!isSPSuccess) {
                        res.message = 'Trouble connecting to Status Page API';
                        res.ok = false;
                    }

                    let response = h.response(res);
                    response.type('application/json');

                    return response;
                };

                const overridesGetHandler = (request, h) => {
                    console.log("[/api/overrides.json GET] received GET request");

                    let response = h.response(self._overrides);
                    response.type('application/json');
                    return response;
                };

                const overridesPostHandler = async (request, h) => {
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
                        let statupageComponent = self.statupageComponents[componentName];
                        if (statupageComponent) {
                            await self.spClient.updateComponentStatus(statupageComponent, override.new_status);
                        } else {
                            console.error('[overridesPostHandler] tried to set new status on undefined component:', componentName, override.new_status);
                        }

                    }

                    let response = h.response({
                        message: "Successfully added override",
                        component_name: override.component_name,
                        seconds: override.seconds,
                    });
                    response.type('application/json');
                    return response;
                };

                // routes
                // noinspection JSUnresolvedFunction
                const routes = [
                    {
                        method: 'GET',
                        path: '/ready',
                        handler: readyHandler,
                    },
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
                            auth: authScheme ? 'http-auth' : undefined,
                        }
                    },
                    {
                        method: 'POST',
                        path: '/api/overrides.json',
                        handler: overridesPostHandler,
                        config: {
                            auth: authScheme ? 'http-auth' : undefined,
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
        } else {
            console.error("Invalid API config. For help refer to the API documentation: https://github.com/redhataccess/statuspage-controller");
        }
    };


    /**
     *  Initializes the server
     */
    self.initialize = function () {
        self.initializeVariables();
        self.initializeApiServer();
        self.setupTerminationHandlers();
    };


    /**
     *  Start the server
     */
    self.start = async function () {
        if (!self.config.NR_API_KEYS || !self.config.SPIO_PAGE_ID || !self.config.SPIO_API_KEY) {
            console.error("You are missing required API keys, make sure the following environment variables are set:");
            console.error("NR_API_KEYS - Your New Relic API key");
            console.error("SPIO_PAGE_ID - Your Statuspage.io Page ID");
            console.error("SPIO_API_KEY - Your Statuspage.io API key");
            return;
        }

        console.log("Starting StatuspageController with the following config:");
        console.log("poll interval: ", self.config.POLL_INTERVAL);
        console.log("Port: ", self.config.PORT);
        let maskedNewRelicAPIKeys = '';
        for (let apiKey of self.config.NR_API_KEYS) {
            maskedNewRelicAPIKeys += self.maskString(apiKey) + ', ';
        }
        console.log("New Relic API keys: ", `[${maskedNewRelicAPIKeys}]`);
        console.log("StatusPage Page ID: ", self.maskString(self.config.SPIO_PAGE_ID));
        console.log("StatusPage API key: ", self.maskString(self.config.SPIO_API_KEY));

        // Start synchronizing
        // await main();
        // setInterval(main, self.config.POLL_INTERVAL);

        if (self.apiInitialized) {
            // Start the server
            self.server.start((err) => {
                if (err) {
                    console.error('There was an error starting the api server: ', err);
                } else {
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
