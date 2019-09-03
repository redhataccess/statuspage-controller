'use strict';

const axios = require('axios');

/**
 * Stateless New Relic rest client
 */
class NewRelicClient {
    constructor() {
        this.NR_API_URL = "https://api.newrelic.com/v2";
    }

    setApiKey(apiKey) {
        this.config = {
            headers: {"X-Api-Key": apiKey} // request headers
        };
    }

    /**
     * Returns true if the client can talk to New Relic API
     * @param apiKey Can be a single api key string or an array of keys
     * @returns {boolean}
     */
    async checkNewRelicAPI(apiKey) {
        // see if this is an array or a string
        if (Array.isArray(apiKey)) {
            return this._checkNewRelicAPIMulti(apiKey);
        }
        else {
            return this._checkNewRelicAPISingle(apiKey);
        }
    }

    async _checkNewRelicAPIMulti(apiKeysArray) {
        let isNRSuccess = false;

        for(let apiKey of apiKeysArray) {
            isNRSuccess = await this._checkNewRelicAPISingle(apiKey.trim());
            if (!isNRSuccess) break;
        }

        return isNRSuccess;
    }

    async _checkNewRelicAPISingle(apiKey) {
        this.setApiKey(apiKey);
        const url = this.NR_API_URL + "/alerts_policies.json?page=1";

        try {
            await axios.get(url, this.config);
            console.log('[NR Client] New Relic API health check successful');
            return true;
        } catch (e) {
            console.error('[NR Client] New Relic API check failed, response code:', e.response.status, e.response.statusText);
            return false
        }
    }

    async getAlertPolicies(apiKey) {
        let alertPolicies = {};

        // see if this is an array or a string
        if (Array.isArray(apiKey)) {
            alertPolicies = await this._getAlertPoliciesMulti(apiKey);
        }
        else {
            alertPolicies = await this._getAlertPoliciesSingle(apiKey);
        }

        console.log('[NR Client] Total alert policies:', Object.keys(alertPolicies).length);

        return alertPolicies;
    }

    async _getAlertPoliciesMulti(apiKeysArray) {
        let alertPolicies = {};

        // Union all the policies together for each api key
        for(let apiKey of apiKeysArray) {
            let policies = await this._getAlertPoliciesSingle(apiKey.trim());
            Object.assign(alertPolicies, policies);
        }

        return alertPolicies;
    }

    /**
     * Returns the list of alert policies for a given api key
     */
    async _getAlertPoliciesSingle(apiKey) {
        let currentPage = 1;
        let alertPolicies = {};
        let hadResponse;

        this.setApiKey(apiKey);

        // Iterate over the alert policy pages and collect all policies into an object to return
        do {
            try {
                console.log('[NR Client] getAlertPolicies page', currentPage);

                const url = this.NR_API_URL + "/alerts_policies.json?page=" + currentPage;
                const response = await axios.get(url, this.config);

                if (response.data.policies.length > 0) {
                    let policies = response.data.policies;

                    // parsed response body as js object
                    for (let i = 0; i < policies.length; i++) {
                        const policy = policies[i];
                        const policy_name = policy.name.toLowerCase();
                        alertPolicies[policy_name] = policy;
                    }

                    // Try the next page
                    currentPage++;
                    hadResponse = true;
                } else {
                    hadResponse = false;
                }
            } catch (e) {
                console.error('[NR Client] Failed to get New Relic alert polices, response code:', e.response.status, e.response.statusText);
                return false
            }
        } while (hadResponse);

        console.log('[NR Client] policies:', Object.keys(alertPolicies).length);

        return alertPolicies;
    }

    async getOldestViolationsPerPolicy(apiKey) {
        let oldestViolationPerPolicy = {};

        // see if this is an array or a string
        if (Array.isArray(apiKey)) {
            oldestViolationPerPolicy = await this._getOldestViolationsPerPolicyMulti(apiKey);
        }
        else {
            oldestViolationPerPolicy = await this._getOldestViolationsPerPolicySingle(apiKey);
        }

        console.log("[NR Client] Total incidents:", Object.keys(oldestViolationPerPolicy).length);

        return oldestViolationPerPolicy;
    }

    async _getOldestViolationsPerPolicyMulti(apiKeysArray) {
        let oldestViolationPerPolicy = {};

        // Union all the policies together for each api key
        for(let apiKey of apiKeysArray) {
            let violations = await this._getOldestViolationsPerPolicySingle(apiKey.trim());
            Object.assign(oldestViolationPerPolicy, violations);
        }

        return oldestViolationPerPolicy;
    }

    /**
     * Returns a list of the oldest violation per alert policy
     * @param apiKey
     * @returns {Object} List of violations
     */
    async _getOldestViolationsPerPolicySingle(apiKey) {
        let currentPage = 1;
        let oldestViolationPerPolicy = {};
        let hadResponse;

        this.setApiKey(apiKey);

        // Iterate over the alert policy pages and collect all policies into an object to return
        do {
            try {
                console.log('[NR Client] getOldestViolationsPerPolicy page', currentPage);

                const url = this.NR_API_URL + "/alerts_violations.json?only_open=true&page=" + currentPage;
                const response = await axios.get(url, this.config);
                const violations = response.data.violations;
                console.log("[NR Client] Violations on page: ", violations.length);

                if (violations.length > 0) {
                    // parsed response body as js object
                    for (let i = 0; i < violations.length; i++) {
                        const violation = violations[i];
                        //console.log("violation: ", violation);
                        const policy_name = violation.policy_name.toLowerCase();

                        // Save the oldest violation for this policy
                        if (oldestViolationPerPolicy[policy_name]) {
                            const oldest = oldestViolationPerPolicy[policy_name];

                            if (violation.duration > oldest.duration) {
                                oldestViolationPerPolicy[policy_name] = violation;
                            }
                        } else {
                            oldestViolationPerPolicy[policy_name] = violation;
                        }
                    }

                    console.log("[NR Client] Policies with open violations: ", Object.getOwnPropertyNames(oldestViolationPerPolicy));

                    // had data on this page so get and parse the next page
                    currentPage++;
                    hadResponse = true;
                } else {
                    hadResponse = false;
                }

            } catch (e) {
                console.error('[NR Client] Failed to get New Relic open violations, response code:', e.response.status, e.response.statusText);
                return false
            }
        } while (hadResponse);

        console.log("[NR Client] Incident count:", Object.keys(oldestViolationPerPolicy).length);

        return oldestViolationPerPolicy;
    }
}

module.exports = NewRelicClient;
