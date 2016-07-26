var NODEJS = typeof module !== 'undefined' && module.exports;

var Client = require('node-rest-client').Client;

/**
 * This module contains all of the app logic and state,
 * @constructor
 */
var AppServer = function () {
    //  Scope.
    var self = this;

    self.client = new Client();

    self.nr_api_key = "";
    self.spio_api_key = "";

    self.nr_args = {
        headers: { "X-Api-Key": self.nr_api_key } // request headers
    };

    self.spio_args = {
        headers: { "Authorization": self.spio_api_key }
    };

    self.spio_patch_args_down = {
        data: "component[status]=major_outage",
        headers: {
            "Authorization": self.spio_api_key,
            "Content-Type": "application/x-www-form-urlencoded"
        }
    };

    self.spio_patch_args_up = {
        data: "component[status]=operational",
        headers: {
            "Authorization": self.spio_api_key,
            "Content-Type": "application/x-www-form-urlencoded"
        }
    };

    self.violation_policy_names = {};

    setInterval(function() {

        // check for any open violations
        console.log("Checking for violations");

        self.client.get("https://api.newrelic.com/v2/alerts_violations.json?only_open=true", self.nr_args,
            function (data, response) {
                //console.log(data);
                //
                //console.log('data is: ');

                var violations = data.violations;

                // parsed response body as js object
                for (var i = 0; i < violations.length; i++) {
                    var violation = violations[i];
                    //console.log("policy: " + violation.policy_name);

                    self.violation_policy_names[violation.policy_name] = 1;
                }

                console.log(self.violation_policy_names);
            }
        );

        // now update the statuspage.io component based on any matching policy-components names
        self.client.get("https://api.statuspage.io/v1/pages/dn6mqn7xvzz3/components.json", self.spio_args,
            function (data, response) {
                //console.log(data);

                for (var i = 0; i < data.length; i++) {
                    var component = data[i];

                    if (self.violation_policy_names[component.name]) {
                        console.log("Found component matching policy violation");

                        // update status of component
                        self.client.patch("https://api.statuspage.io/v1/pages/dn6mqn7xvzz3/components/hdlfsfbq84lc.json" , self.spio_patch_args_down,
                            function (data, response) {
                                console.log(data);
                            }
                        );
                    }
                    else {
                        // update status of component
                        self.client.patch("https://api.statuspage.io/v1/pages/dn6mqn7xvzz3/components/hdlfsfbq84lc.json" , self.spio_patch_args_up,
                            function (data, response) {
                                console.log(data);
                            }
                        );
                    }
                }
            }
        );

    }, 3000);

};

if (NODEJS) module.exports = AppServer;
