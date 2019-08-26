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
     * @param apiKey
     * @returns {boolean}
     */
    async healthCheck(apiKey) {
        //TODO: Implement
        return true;
    }

    /**
     * Returns the list of alert policies for a given api key
     */
    async getAlertPolicies(apiKey) {
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
                }
                else {
                    hadResponse = false;
                }
            } catch (error) {
                console.error(error);
            }
        } while (hadResponse);

        console.log('[NR Client] Total alert policies:', Object.keys(alertPolicies).length);

        return alertPolicies;
    }
}

module.exports = NewRelicClient;
